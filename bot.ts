import {
	ComputeBudgetProgram,
	Connection,
	Keypair,
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import {
	createAssociatedTokenAccountIdempotentInstruction,
	createCloseAccountInstruction,
	getAccount,
	getAssociatedTokenAddress,
	RawAccount,
	TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Percent, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { MarketCache, PoolCache, SnipeListCache } from './cache';
import { PoolFilters } from './filters';
import { TransactionExecutor } from './transactions';
import { createPoolKeys, logger, NETWORK, sleep } from './helpers';
import { Mutex } from 'async-mutex';
import BN from 'bn.js';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';

export interface BotConfig {
	wallet: Keypair;
	checkRenounced: boolean;
	checkFreezable: boolean;
	checkBurned: boolean;
	minPoolSize: TokenAmount;
	maxPoolSize: TokenAmount;
	quoteToken: Token;
	quoteAmount: TokenAmount;
	quoteAta: PublicKey;
	oneTokenAtATime: boolean;
	useSnipeList: boolean;
	autoSell: boolean;
	autoBuyDelay: number;
	autoSellDelay: number;
	maxBuyRetries: number;
	maxSellRetries: number;
	unitLimit: number;
	unitPrice: number;
	takeProfit: number;
	stopLoss: number;
	buySlippage: number;
	sellSlippage: number;
	priceCheckInterval: number;
	priceCheckDuration: number;
	filterCheckInterval: number;
	filterCheckDuration: number;
	consecutiveMatchCount: number;
	sellSkipPreflight: boolean;
	buySkipPreflight: boolean;
}

export class Bot {
	private readonly poolFilters: PoolFilters;

	// snipe list
	private readonly snipeListCache?: SnipeListCache;

	// one token at the time
	private readonly buyMutex: Mutex;
	private readonly sellMutex: Mutex;
	private sellExecutionCount = 0;
	public readonly isWarp: boolean = false;

	constructor(
		private readonly connection: Connection,
		private readonly marketStorage: MarketCache,
		private readonly poolStorage: PoolCache,
		private readonly txExecutor: TransactionExecutor,
		readonly config: BotConfig,
	) {
		this.isWarp = txExecutor instanceof WarpTransactionExecutor;

		this.buyMutex = new Mutex();
		this.sellMutex = new Mutex();
		this.poolFilters = new PoolFilters(connection, {
			quoteToken: this.config.quoteToken,
			minPoolSize: this.config.minPoolSize,
			maxPoolSize: this.config.maxPoolSize,
		});

		if (this.config.useSnipeList) {
			this.snipeListCache = new SnipeListCache();
			this.snipeListCache.init();
		}
	}

	async validate() {
		try {
			await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
		} catch (error) {
			logger.error(
				`${this.config.quoteToken.symbol} token account not found in wallet: ${this.config.wallet.publicKey.toString()}`,
			);
			return false;
		}

		return true;
	}

	public async approveToken(poolKeys: LiquidityPoolKeysV4) {
		if (!this.config.useSnipeList) {
			const match = await this.filterMatch(poolKeys);

			if (!match) {
				logger.trace({ mint: poolKeys.baseMint.toString() }, `Skipping buy because pool doesn't match filters`);
				return false;
			}
		}
		return true;
	}

	public async proposeBuy(accountId: PublicKey, poolState: LiquidityStateV4): Promise<boolean> {
		try {
			logger.trace({ mint: poolState.baseMint }, `Processing new pool...`);

			if (this.config.useSnipeList && !this.snipeListCache?.isInList(poolState.baseMint.toString())) {
				logger.debug({ mint: poolState.baseMint.toString() }, `Skipping buy because token is not in a snipe list`);
				return false;
			}

			const market = await this.marketStorage.get(poolState.marketId.toString());
			const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);

			let approved = false;
			if (this.config.autoBuyDelay > 0) {
				logger.debug({ mint: poolState.baseMint }, `Waiting for at least ${this.config.autoBuyDelay} ms before buy`);
				[ approved ] = await Promise.all([this.approveToken(poolKeys), sleep(this.config.autoBuyDelay)]);
			} else {
				approved = await this.approveToken(poolKeys);
			}

			if (!approved) {
				return false;
			}

			if (this.config.oneTokenAtATime) {
				await this.buyMutex.acquire();
				await this.sellMutex.waitForUnlock();
			}

			await this.buy(accountId, poolState.baseMint, poolKeys);
		} catch (error) {
			logger.error({ mint: poolState.baseMint.toString(), error }, `Error while investigating pool.`);
		} finally {
			if (this.config.oneTokenAtATime) {
				this.buyMutex.release(); //TODO: check if releasing if not locked is ok, docs say release callback returned when doing acquire is idempotent
			}
			return true;
		}
	}

	public async buy(accountId: PublicKey, baseMint: PublicKey, poolKeys: LiquidityPoolKeysV4): Promise<boolean> {
		const mintAta = await getAssociatedTokenAddress(poolKeys.baseMint, this.config.wallet.publicKey);

		for (let i = 0; i < this.config.maxBuyRetries; i++) {
			try {
				logger.info(
					{ mint: baseMint.toString() },
					`Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
				);
				const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
				const result = await this.swap(
					poolKeys,
					this.config.quoteAta,
					mintAta,
					this.config.quoteToken,
					tokenOut,
					this.config.quoteAmount,
					this.config.buySlippage,
					this.config.wallet,
					'buy',
				);

				if (result.confirmed) {
					logger.info(
						{
							mint: baseMint.toString(),
							signature: result.signature,
							url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
						},
							`Confirmed buy tx`,
					);

					return true;
				}

				logger.info(
					{
						mint: baseMint.toString(),
						signature: result.signature,
						error: result.error,
					},
					`Error confirming buy tx`,
				);
			} catch (error) {
				logger.debug({ mint: baseMint.toString(), error }, `Error confirming buy transaction`);
			}
		}
		return false;
	}

	public async sell(accountId: PublicKey, rawAccount: RawAccount) {
		if (this.config.oneTokenAtATime) {
			await this.sellMutex.acquire();
		}

		try {
			logger.trace({ mint: rawAccount.mint }, `Processing new token...`);

			const poolData = await this.poolStorage.get(rawAccount.mint.toString());

			if (!poolData) {
				logger.trace({ mint: rawAccount.mint.toString() }, `Token pool data is not found, can't sell`);
				return;
			}

			const tokenIn = new Token(TOKEN_PROGRAM_ID, poolData.state.baseMint, poolData.state.baseDecimal.toNumber());
			const tokenAmountIn = new TokenAmount(tokenIn, rawAccount.amount, true);

			if (tokenAmountIn.isZero()) {
				logger.info({ mint: rawAccount.mint.toString() }, `Empty balance, can't sell`);
				return;
			}

			if (this.config.autoSellDelay > 0) {
				logger.debug({ mint: rawAccount.mint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
				await sleep(this.config.autoSellDelay);
			}

			const market = await this.marketStorage.get(poolData.state.marketId.toString());
			const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);

			await this.priceMatch(tokenAmountIn, poolKeys);

			for (let i = 0; i < this.config.maxSellRetries; i++) {
				try {
					logger.info(
						{ mint: rawAccount.mint },
						`Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries}`,
					);

					const result = await this.swap(
						poolKeys,
						accountId,
						this.config.quoteAta,
						tokenIn,
						this.config.quoteToken,
						tokenAmountIn,
						this.config.sellSlippage,
						this.config.wallet,
						'sell',
					);

					if (result.confirmed) {
						logger.info(
							{
								dex: `https://dexscreener.com/solana/${rawAccount.mint.toString()}?maker=${this.config.wallet.publicKey}`,
								mint: rawAccount.mint.toString(),
								signature: result.signature,
								url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
							},
							`Confirmed sell tx`,
						);
						break;
					}

					logger.info(
						{
							mint: rawAccount.mint.toString(),
							signature: result.signature,
							error: result.error,
						},
						`Error confirming sell tx`,
					);
				} catch (error) {
					logger.debug({ mint: rawAccount.mint.toString(), error }, `Error confirming sell transaction`);
				}
			}
		} catch (error) {
			logger.error({ mint: rawAccount.mint.toString(), error }, `Failed to sell token`);
		} finally {
			if (this.config.oneTokenAtATime) {
				await this.sellMutex.release();
			}
		}
	}

	// noinspection JSUnusedLocalSymbols
	private async swap(
		poolKeys: LiquidityPoolKeysV4,
		ataIn: PublicKey,
		ataOut: PublicKey,
		tokenIn: Token,
		tokenOut: Token,
		amountIn: TokenAmount,
		slippage: number,
		wallet: Keypair,
		direction: 'buy' | 'sell',
	) {
		const slippagePercent = new Percent(slippage, 100);
		const poolInfo = await Liquidity.fetchInfo({
			connection: this.connection,
			poolKeys,
		});

		const computedAmountOut = Liquidity.computeAmountOut({
			poolKeys,
			poolInfo,
			amountIn,
			currencyOut: tokenOut,
			slippage: slippagePercent,
		});

		const latestBlockhash = await this.connection.getLatestBlockhash();
		const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
			{
				poolKeys: poolKeys,
				userKeys: {
					tokenAccountIn: ataIn,
					tokenAccountOut: ataOut,
					owner: wallet.publicKey,
				},
				amountIn: amountIn.raw,
				minAmountOut: computedAmountOut.minAmountOut.raw,
			},
			poolKeys.version,
		);

		const messageV0 = new TransactionMessage({
			payerKey: wallet.publicKey,
			recentBlockhash: latestBlockhash.blockhash,
			instructions: [
				...(this.isWarp
					? []
					: [
							ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
							ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
						]),
				...(direction === 'buy'
					? [
							createAssociatedTokenAccountIdempotentInstruction(
								wallet.publicKey,
								ataOut,
								wallet.publicKey,
								tokenOut.mint,
							),
						]
					: []),
				...innerTransaction.instructions,
				...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []),
			],
		}).compileToV0Message();

		const transaction = new VersionedTransaction(messageV0);
		transaction.sign([wallet, ...innerTransaction.signers]);

		const skipPreflight = { buy: this.config.buySkipPreflight, sell: this.config.sellSkipPreflight }[direction];
		return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash, skipPreflight);
	}

	private async filterMatch(poolKeys: LiquidityPoolKeysV4) {
		if (this.config.filterCheckInterval === 0 || this.config.filterCheckDuration === 0) {
			return true;
		}

		const timesToCheck = this.config.filterCheckDuration / this.config.filterCheckInterval;
		let timesChecked = 0;
		let matchCount = 0;

		do {
			try {
				const shouldBuy = await this.poolFilters.execute(poolKeys);

				if (shouldBuy) {
					matchCount++;

					if (this.config.consecutiveMatchCount <= matchCount) {
						logger.debug(
							{ mint: poolKeys.baseMint.toString() },
							`Filter match ${matchCount}/${this.config.consecutiveMatchCount}`,
						);
						return true;
					}
				} else {
					matchCount = 0;
				}

				await sleep(this.config.filterCheckInterval);
			} finally {
				timesChecked++;
			}
		} while (timesChecked < timesToCheck);

		return false;
	}

	private async priceMatch(amountIn: TokenAmount, poolKeys: LiquidityPoolKeysV4) {
		if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
			return;
		}

		const timesToCheck = this.config.priceCheckDuration / this.config.priceCheckInterval;
		const profitFraction = this.config.quoteAmount.mul(this.config.takeProfit).numerator.div(new BN(100));
		const profitAmount = new TokenAmount(this.config.quoteToken, profitFraction, true);
		const takeProfit = this.config.quoteAmount.add(profitAmount);

		const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
		const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
		const stopLoss = this.config.quoteAmount.subtract(lossAmount);
		const slippage = new Percent(this.config.sellSlippage, 100);
		let timesChecked = 0;

		do {
			try {
				const poolInfo = await Liquidity.fetchInfo({
					connection: this.connection,
					poolKeys,
				});

				const amountOut = Liquidity.computeAmountOut({
					poolKeys,
					poolInfo,
					amountIn: amountIn,
					currencyOut: this.config.quoteToken,
					slippage,
				}).amountOut;

				logger.debug(
					{ mint: poolKeys.baseMint.toString() },
					`Take profit: ${takeProfit.toFixed()} | Stop loss: ${stopLoss.toFixed()} | Current: ${amountOut.toFixed()}`,
				);

				if (amountOut.lt(stopLoss)) {
					break;
				}

				if (amountOut.gt(takeProfit)) {
					break;
				}

				await sleep(this.config.priceCheckInterval);
			} catch (e) {
				logger.trace({ mint: poolKeys.baseMint.toString(), e }, `Failed to check token price`);
			} finally {
				timesChecked++;
			}
		} while (timesChecked < timesToCheck);
	}
}
