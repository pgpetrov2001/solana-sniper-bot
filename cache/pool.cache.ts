import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, Token } from '@raydium-io/raydium-sdk';
import { redisClient } from '../db';
import { logger, LiquidityStateV4JSON } from '../helpers';

function poolDatabaseKey(mint: string) {
	return `pool-from-mint/${mint}`;
}

type SavedPool = { id: string; state: LiquidityStateV4JSON };

export class PoolCache {
	constructor(private readonly connection: Connection|null = null,
				private readonly config: { quoteToken: Token }|null = null) {}

	async init() {
		//TODO: make this interoperable with redis cache
		if (!this.connection || !this.config) {
			throw new Error(`Cannot fetch pools, because no connection to an RPC was provided for the pool cache.`);
		}
		logger.debug({}, `Fetching all existing ${this.config.quoteToken.symbol} pools...`);

		console.time(`Fetching ${this.config.quoteToken.symbol} raydium liquidity pools`);
		const poolsAccounts = await this.connection.getProgramAccounts(MAINNET_PROGRAM_ID.AmmV4, {
			commitment: this.connection.commitment,
			filters: [
				{ dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
				{
					memcmp: {
						offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
						bytes: this.config.quoteToken.mint.toBase58(),
					},
				},
			],
		});
		console.timeEnd(`Fetching ${this.config.quoteToken.symbol} raydium liquidity pools`);

		const resps = await Promise.all(poolsAccounts.map(async (rawPoolAccount) => {
			const { account: poolAccount, pubkey: poolAddress } = rawPoolAccount;
			const poolData = JSON.parse(JSON.stringify(
				LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data)
			));
			return await this.save(poolAddress!.toString(), poolData, false);
		}));

		logger.debug({}, `Cached ${resps.filter((x) => x)} pools`);
	}

	public async save(id: string, state: LiquidityStateV4JSON, logging = true): Promise<number> {
		const mint = state.baseMint.toString();
		const exists = await redisClient.exists(poolDatabaseKey(mint));
		if (!exists) {
			if (logging) {
				logger.trace({ mint: state.baseMint.toString() }, `Caching new pool with account address ${id}`);
			}
			await redisClient.set(poolDatabaseKey(mint), JSON.stringify({ id, state }));
			return 1;
		}
		return 0;
	}

	public async get(mint: string): Promise<SavedPool> {
		{
			const val = await redisClient.get(poolDatabaseKey(mint));
			if (val) {
				return JSON.parse(val) as SavedPool;
			}
		}

		logger.trace({}, `Fetching pool address for mint ${mint}`);
		const { id, state } = await this.fetch(mint);
		this.save(id, state, false);
		return { id, state };
	}

	public async has(mint: string): Promise<number> {
		return await redisClient.exists(poolDatabaseKey(mint));
	}

	private async fetch(mint: string): Promise<SavedPool> {
		if (!this.connection || !this.config) {
			throw new Error(`Failed to find associated pool with mint ${mint}, because no connection to an RPC was provided for the pool cache.`);
		}
		const poolsAccounts = await this.connection.getProgramAccounts(MAINNET_PROGRAM_ID.AmmV4, {
			commitment: this.connection.commitment,
			filters: [
				{ dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
				{
					memcmp: {
						offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
						bytes: mint, // TODO: check if needed
					},
				},
				{
					memcmp: {
						offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
						bytes: this.config.quoteToken.mint.toBase58(),
					},
				},
			],
		});

		if (poolsAccounts.length === 0) {
			throw new Error(`Could not find liquidity pool from mint address: ${mint}`);
		}

		const [{ account: poolAccount, pubkey: poolAddress }] = poolsAccounts;
		const poolData = JSON.parse(JSON.stringify(
			LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data)
		));
		return {
			id: poolAddress!.toString(),
			state: poolData,
		};
	}
}
