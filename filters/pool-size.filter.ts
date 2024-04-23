import { Filter, FilterResult } from './pool-filters';
import { LiquidityPoolKeysV4, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { Connection } from '@solana/web3.js';
import { AccountLayout, RawAccount } from '@solana/spl-token';
import { logger, Deferred } from '../helpers';

export class PoolSizeFilter implements Filter {
	private poolKeys: LiquidityPoolKeysV4 | null = null;
	private retrieveDeferred = new Deferred();
	private subscription: number | null = null;

	constructor(
		private readonly connection: Connection,
		private readonly quoteToken: Token,
		private readonly minPoolSize: TokenAmount,
		private readonly maxPoolSize: TokenAmount,
	) {}

	private resolve(amount: string): FilterResult {
		const poolSize = new TokenAmount(this.quoteToken, amount, true);
		let inRange = true;

		if (!this.maxPoolSize?.isZero()) {
			inRange = poolSize.raw.lte(this.maxPoolSize.raw);

			if (!inRange) {
				return { ok: false, message: `PoolSize -> Pool size ${poolSize.toFixed()} > ${this.maxPoolSize.toFixed()}` };
			}
		}

		if (!this.minPoolSize?.isZero()) {
			inRange = poolSize.raw.gte(this.minPoolSize.raw);

			if (!inRange) {
				return { ok: false, message: `PoolSize -> Pool size ${poolSize.toFixed()} < ${this.minPoolSize.toFixed()}` };
			}
		}

		return { ok: inRange };
	}

	private reject(error: any, poolKeys: LiquidityPoolKeysV4): FilterResult {
		logger.error({ mint: poolKeys.baseMint, error }, `Failed to check pool size`);
		return { ok: false, message: 'PoolSize -> Failed to check pool size' };
	}

	async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
		try {
			//TODO: token account owned by token program change in amount field (= balance)
			const response = await this.connection.getTokenAccountBalance(poolKeys.quoteVault, this.connection.commitment);
			return this.resolve(response.value.amount);
		} catch (error) {
			return this.reject(error, poolKeys);
		}
	}

	async retrieve(): Promise<FilterResult> {
		try {
			const quoteVaultData = await this.recv();
			return this.resolve(String(quoteVaultData.amount));
		} catch (e: any) {
			return this.reject(e, this.poolKeys!);
		}
	}

	listen(poolKeys: LiquidityPoolKeysV4) {
		this.poolKeys = poolKeys;
		this.retrieveDeferred = new Deferred();
		this.subscription = this.connection.onAccountChange(
			poolKeys.quoteVault,
			async (updatedAccountInfo) => {
				const accountData = AccountLayout.decode(updatedAccountInfo.data);
				this.retrieveDeferred.resolve(accountData);
			},
			this.connection.commitment,
		);
		logger.trace(
			{ mint: poolKeys.baseMint },
			`Listening for changes of balance of the LP ${this.quoteToken} vault with address ${poolKeys.quoteVault}`,
		);
	}

	async stop() {
		const subscription = this.subscription!;
		this.subscription = null;
		await this.connection.removeAccountChangeListener(subscription);
		this.retrieveDeferred.reject(
			new Error(
				`Attempted to retrieve update on filter but listener for pool size filter for token with mint ${this.poolKeys!.baseMint} has been stopped`,
			),
		);
		this.poolKeys = null;
	}

	private async recv(): Promise<RawAccount> {
		const ret = (await this.retrieveDeferred.promise) as RawAccount;
		this.retrieveDeferred = new Deferred();
		return ret;
	}
}
