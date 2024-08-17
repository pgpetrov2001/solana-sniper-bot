import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, Token } from '@raydium-io/raydium-sdk';
import { gql, GraphQLClient } from 'graphql-request';
import { redisClient } from '../db';
import {
	zip,
	logger,
	LiquidityStateV4JSON,
	Raydium_LiquidityPoolv4_query,
	Raydium_LiquidityPoolv4_Response,
	standardizeRaydium_LiquidityPoolv4_Response
} from '../helpers';

function poolDatabaseKey(mint: string) {
	return `pool-from-mint/${mint}`;
}
type SavedPool = { id: string; state: LiquidityStateV4JSON };

export class PoolCache {
	constructor(
		private readonly connection: Connection|null = null,
		private readonly solanaIndexer: GraphQLClient|null = null,
		private readonly config: { quoteToken: Token }|null = null
	) {}

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

	public async getMultiple(mints: string[]): Promise<SavedPool[]> {
		const results = new Array(mints.length) as SavedPool[];
		const mintsToFetch = [] as string[];
		const mintsToFetchOriginalIndices = [] as number[];
		for (let i = 0; i < mints.length; i++) {
			const mint = mints[i];
			const val = await redisClient.get(poolDatabaseKey(mint));
			if (val) {
				results[i] = JSON.parse(val) as SavedPool;
			} else {
				mintsToFetch.push(mint);
				mintsToFetchOriginalIndices.push(i);
			}
		}
		if (mintsToFetch.length) {
			const poolsToSave = await this.fetchMultiple(mintsToFetch);
			const resps = await Promise.all(poolsToSave.map(({ id, state }) => this.save(id, state, false)));
			logger.debug({}, `Cached ${resps.filter((x) => x).length} new pools`);
			for (const [poolToSave, index] of zip(poolsToSave, mintsToFetchOriginalIndices)) {
				results[index] = poolToSave;
			}
		}
		return results;
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

	private async fetchMultiple(mints: string[]): Promise<SavedPool[]> {
		if (!this.solanaIndexer) {
			throw new Error(`Cannot fetch multiple liquidity pools, because solana indexer was not specified, and fetching many pools one by one is too cost-prohibitive.`);
		}
		logger.trace({}, `Querying raydium pools with quote ${this.config.quoteToken.symbol} and base one out of ${mints.length} mints...`);
		const { Raydium_LiquidityPoolv4: resp } = await this.solanaIndexer.request(
			Raydium_LiquidityPoolv4_query,
			{
				where: {
					_and: [
						{ baseMint: { _in: mints } },
						{ quoteMint: { _eq: this.config.quoteToken.mint.toBase58() } },  
					]
				}
			}
		) as { Raydium_LiquidityPoolv4: Raydium_LiquidityPoolv4_Response[] };
		const poolsToSave = resp.map((pool) => ({
			id: pool.pubkey,
			state: standardizeRaydium_LiquidityPoolv4_Response(pool)
		}));
		return poolsToSave;
	}
}
