import {
	Connection,
	Keypair,
	AccountInfo,
	TransactionResponse,
	ParsedAccountData,
	ParsedTransactionWithMeta,
	TokenBalance,
	PublicKey,
} from '@solana/web3.js';
import { getAccount, TOKEN_PROGRAM_ID, } from '@solana/spl-token';
import { MAINNET_PROGRAM_ID, Liquidity, LiquidityPoolKeysV4, getPdaMetadataKey,  Percent, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import {
	mplTokenMetadata,
	getMetadataAccountDataSerializer,
	MetadataAccountData,
	MetadataAccountDataArgs,
} from '@metaplex-foundation/mpl-token-metadata';

import { redisClient } from './db';
import { MarketCache, PoolCache, SnipeListCache } from './cache';
import { TransactionExecutor } from './transactions';
import { createPoolKeys, LiquidityStateV4JSON, logger } from './helpers';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';

export interface MintAccount {
}

export interface TokenAccount {
	address: PublicKey;
	mint: PublicKey;
	owner: PublicKey;
	tokenAmount: {
		amount: string;
		decimals: number;
		uiAmount: number;
		uiAmountString: string;
	}
}

export interface WalletConfig {
	account: Keypair;
	quoteToken: Token;
	quoteAmount: TokenAmount;
	quoteAta: PublicKey;
	autoSell: boolean;
	autoSellDelay: number;
	maxSellRetries: number;
	unitLimit: number;
	unitPrice: number;
	takeProfit: number;
	stopLoss: number;
	sellSlippage: number;
	sellSkipPreflight: boolean;
}

type BalanceMap = { [key: string]: { [key: string]: bigint } };

function getBalanceChanges(preMap: BalanceMap, postMap: BalanceMap) {
	const allOwners = Object.keys(preMap).concat(Object.keys(postMap));
	const allMints = Object.values(preMap).concat(Object.values(postMap))
		.reduce(
			(result, mintMap) => result.concat(Object.keys(mintMap)),
			[] as string[]
		);

	const result = {} as BalanceMap;

	for (const owner of allOwners) {
		result[owner] = result[owner] ?? {};
		for (const mint of allMints) {
			const pre = preMap[owner]?.[mint] ?? BigInt(0);
			const post = postMap[owner]?.[mint] ?? BigInt(0);
			if (pre !== post) {
				result[owner][mint] = post - pre;
			}
		}
	}

	return result;
}

function bigintToDecimal(x: bigint, decimals: number) {
	let y = x.toString();
	let numLength = y.length;
	if (x < 0) numLength--;
	if (decimals >= numLength) {
		const sign = x < 0? '-' : '';
		if (x < 0) y = y.slice(1);
		const zeros = '0'.repeat(decimals - numLength);
		return `${sign}0.${zeros}${y}`;
	}
	const decPointIndex = y.length - decimals;
	return `${y.slice(0, decPointIndex)}.${y.slice(decPointIndex)}`;
}

async function confirmedTxSignaturesForAccount(connection: Connection, accountAddress: PublicKey) {
	const signatureInfos = await connection.getSignaturesForAddress(accountAddress);
	return signatureInfos
		.filter((signatureInfo) => signatureInfo.err == null && signatureInfo.confirmationStatus && ['confirmed', 'finalized'].includes(signatureInfo.confirmationStatus))
		.map(({ signature }) => signature);
}

function txSignatureDatabaseKey(signature: string) {
	return `tx-signature/${signature}`;
}

async function transactionsWithMetaFromSignatures(connection: Connection, signatures: string[]): Promise<ParsedTransactionWithMeta[]> {
	const txsWithMeta = [];
	const unfetchedSignatures = [];
	for (const sig of signatures) {
		const val = await redisClient.get(txSignatureDatabaseKey(sig));
		if (val) {
			txsWithMeta.push(
				JSON.parse(val) as ParsedTransactionWithMeta
			);
		} else {
			unfetchedSignatures.push(sig);
		}
	}
	if (unfetchedSignatures.length) {
		logger.debug(`Fetching transactions with metadata for ${unfetchedSignatures.length} signatures`);
		const resp = await connection.getParsedTransactions(unfetchedSignatures, { maxSupportedTransactionVersion: 0 });
		logger.debug(`Fetched null result for ${resp.filter((t) => !t).length} signatures.`);
		await Promise.all(resp.map(async (txWithMeta) => {
			if (txWithMeta) {
				const signature = txWithMeta.transaction.signatures[0];
				await redisClient.set(
					txSignatureDatabaseKey(signature),
					JSON.stringify(txWithMeta)
				);
			}
		}));
		txsWithMeta.push(...resp);
	}
	return txsWithMeta.filter(
		(txWithMeta) => txWithMeta && txWithMeta.meta
	) as ParsedTransactionWithMeta[];
}

export class Wallet {
	public readonly isWarp: boolean = false;
	public readonly isJito: boolean = false;
	public readonly metadataSerializer = getMetadataAccountDataSerializer();
	private walletTxSignatures: string[] | null = null;
	private walletTxs: ParsedTransactionWithMeta[] | null = null;

	constructor(
		public readonly connection: Connection, //TODO: implement ConnectionManager that is a wrapper on top of connection, to avoid 429 with to many concurrent requests (can also utilize multiple RPCs)
		public readonly privateConnection: Connection | null,
		public readonly marketStorage: MarketCache,
		public readonly poolStorage: PoolCache,
		public readonly txExecutor: TransactionExecutor,
		readonly config: WalletConfig,
	) {
		this.isWarp = txExecutor instanceof WarpTransactionExecutor;
		this.isJito = txExecutor instanceof JitoTransactionExecutor;
	}

	async init() {
		try {
			await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
		} catch(err: any) {
			throw new Error(
				`Could not verify whether ${this.config.quoteToken.symbol} token account is present in wallet ${this.config.account.publicKey.toString()} due to error: ${err}`,
			);
		}
		(async () => {
			try {
				console.time('Fetching transaction signatures');
				await this.fetchWalletTxSigs();
				console.timeEnd('Fetching transaction signatures');
			} catch(err: any) {
				logger.error({
					wallet: this.config.account.publicKey
				}, `Could not pre-fetch transaction signatures for wallet: ${err}`);
				return;
			}
			try {
				console.time('Fetching transactions with metas');
				await this.fetchWalletTxMetas();
				console.timeEnd('Fetching transactions with metas');
			} catch(err: any) {
				logger.error({
					wallet: this.config.account.publicKey,
					signaturesCount: this.walletTxSignatures!.length,
				}, `Could not pre-fetch transaction data from signatures: ${err}`);
			}
		})();
	}

	private async fetchWalletTxSigs() {
		this.walletTxSignatures = await confirmedTxSignaturesForAccount(this.privateConnection ?? this.connection, this.config.account.publicKey);
		logger.trace({
			wallet: this.config.account.publicKey,
			count: this.walletTxSignatures.length
		}, `Fetched wallet transaction signatures.`);
	}

	private async fetchWalletTxMetas() {
		this.walletTxs = await transactionsWithMetaFromSignatures(this.privateConnection ?? this.connection, this.walletTxSignatures!);
		logger.trace({
			wallet: this.config.account.publicKey,
			count: this.walletTxs.length
		}, `Fetched wallet transactions with meta.`);
	}

	//TODO: getMintData should be moved to a wrapper on top of ConnectionManager, that abstracts on top of the RPC calls of solana (sth like a DAO)
	async getMintData(rawMintAddress: string): Promise<MintAccount> {
		const mint = new PublicKey(rawMintAddress);
		const { value: resp } = await this.connection.getParsedAccountInfo(mint);
		if (!resp) {
			throw new Error(`Address ${mint} not found when trying to fetch mint metadata`);
		}
		const data = resp.data;
		if (data instanceof Buffer) {
			throw new Error(`Address ${mint} is probably not a valid mint address`);
		}
		return data.parsed.info;
	}

	async getMintsMetadata(rawMintAddresses: string[]): Promise<MetadataAccountData[]> {
		const mints = rawMintAddresses.map((rawMintAddress) => new PublicKey(rawMintAddress));
		const metadataPDAs = mints.map((mint) => getPdaMetadataKey(mint).publicKey);
		const metadataAccounts = await this.connection.getMultipleAccountsInfo(metadataPDAs);
		if (metadataAccounts.find((x) => !x)) {
			throw new Error(`Failed to fetch metadata account data for at least one mint address`);
		}
		const metadataAccountsData = metadataAccounts.map((metadataAccount) => {
			const [ metadataAccountData ] = this.metadataSerializer.deserialize(metadataAccount!.data);
			return metadataAccountData;
		});
		return metadataAccountsData;
	}

	async getTokenAccounts(): Promise<TokenAccount[]> {
		const { value: resp } = await this.connection.getParsedTokenAccountsByOwner(
			this.config.account.publicKey,
			{ programId: TOKEN_PROGRAM_ID }
		);
		const accounts = await Promise.all(resp.map(async ({ account, pubkey }: {
			account: AccountInfo<ParsedAccountData>,
			pubkey: PublicKey,
		}) => {
			const accountData = account.data.parsed.info;
			return {
				address: pubkey,
				...accountData,
			};
		}));
		return JSON.parse(JSON.stringify(
			accounts,
			(key, value) => (typeof value === 'bigint'? value.toString() : value),
		));
	}

	async getTokenPrice(rawMintAddress: string): Promise<string> {
		const mint = new PublicKey(rawMintAddress);
		const poolData = await this.poolStorage.get(mint.toString());
		const market = await this.marketStorage.get(poolData.state.marketId.toString());
		const poolKeys = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);
		const poolInfo = await Liquidity.fetchInfo({
			connection: this.connection,
			poolKeys,
		});
		const slippagePercent = new Percent(this.config.sellSlippage, 100);
		const { amountOut } = Liquidity.computeAmountOut({
			poolKeys,
			poolInfo,
			amountIn: this.config.quoteAmount, //TODO: change this to the actual amount the user would want to sell
			currencyOut: this.config.quoteToken,
			slippage: slippagePercent,
		});
		return amountOut.toFixed();
	}

	private async getAtaTransactions(ata: PublicKey): Promise<ParsedTransactionWithMeta[]> {
		if (this.walletTxs) {
			return this.walletTxs.filter(
				(txWithMeta) => txWithMeta.transaction.message.accountKeys.map(({ pubkey }) => pubkey.toString()).includes(ata.toString())
			);
		}
		const connection = this.privateConnection ?? this.connection;
		const confirmedSignatures = await confirmedTxSignaturesForAccount(connection, ata);
		return await transactionsWithMetaFromSignatures(connection, confirmedSignatures);
	}

	async getAtaBuyAndSellTransactions(rawMintAddress: string, rawAtaAddress: string) {
		const mint = new PublicKey(rawMintAddress);
		const ata = new PublicKey(rawAtaAddress);

		const owner = this.config.account.publicKey;
		const rawOwnerAddress = owner.toString();

		const txsWithMeta = await this.getAtaTransactions(ata);

		const relevantTransactions = txsWithMeta
			.map((txWithMeta) => {
				const tx = txWithMeta!.transaction;
				const meta = txWithMeta!.meta!;

				const tokenDecimals = {} as { [key: string]: number };
				const createMap = (arr: TokenBalance[]) => {
					const map = {} as BalanceMap;
					for (const { mint, owner, uiTokenAmount } of arr) {
						if (!owner) continue;
						map[owner] = map[owner] ?? {};
						map[owner][mint] = BigInt(uiTokenAmount.amount);
						tokenDecimals[mint] = uiTokenAmount.decimals;
					}
					return map;
				};

				if (!meta.preTokenBalances || !meta.postTokenBalances) {
					return { signature: tx.signatures[0], balanceChanges: {} };
				}

				const preMap = createMap(meta.preTokenBalances);
				const postMap = createMap(meta.postTokenBalances);
				const ownerBalanceChanges = getBalanceChanges(preMap, postMap)[rawOwnerAddress];
				const jsonOwnerBalanceChanges = Object.fromEntries(Object.entries(ownerBalanceChanges).map(
					([ mint, balance ]) => [ mint, bigintToDecimal(balance, tokenDecimals[mint]) ]
				));

				return {
					signature: tx.signatures[0],
					balanceChanges: jsonOwnerBalanceChanges,
				};
			})
			.filter(({ balanceChanges }) => rawMintAddress in balanceChanges);
		return relevantTransactions;
	}
}
//TODO: cache all account transactions in a database
