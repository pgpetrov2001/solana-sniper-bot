import { Connection, PublicKey } from '@solana/web3.js';
import { MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import { gql, GraphQLClient } from 'graphql-request';

import { redisClient } from '../db.ts';
import {
	zip,
	logger,
	MINIMAL_MARKET_STATE_LAYOUT_V3,
	MinimalMarketLayoutV3,
	MinimalMarketLayoutV3JSON,
	MinimalMarketLayoutV3Query,
	MinimalMarketLayoutV3Response,
	parseMinimalMarketLayoutV3GraphqlResponse,
} from '../helpers/index.ts';

function marketDatabaseKey(marketId: string) {
	return `market-from-id/${marketId}`;
}

export class MarketCache {
	constructor(
		private readonly connection: Connection|null = null,
		private readonly solanaIndexer: GraphQLClient|null = null,
		private readonly config: { quoteToken: Token }|null = null
	) {}

	async init() {
		if (!this.connection || !this.config) {
			throw new Error(`Cannot fetch markets, because no connection to an RPC was provided for the market cache.`);
		}
		logger.debug({}, `Fetching all existing ${this.config.quoteToken.symbol} markets...`);

		const accounts = await this.connection.getProgramAccounts(MAINNET_PROGRAM_ID.OPENBOOK_MARKET, {
			commitment: this.connection.commitment,
			dataSlice: {
				offset: MARKET_STATE_LAYOUT_V3.offsetOf('eventQueue'),
				length: MINIMAL_MARKET_STATE_LAYOUT_V3.span,
			},
			filters: [
				{ dataSize: MARKET_STATE_LAYOUT_V3.span },
				{
					memcmp: {
						offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
						bytes: this.config.quoteToken.mint.toBase58(),
					},
				},
			],
		});

		const resps = await Promise.all(accounts.map((account) => {
			const market = MINIMAL_MARKET_STATE_LAYOUT_V3.decode(account.account.data);
			return this.save(account.pubkey.toString(), market, false);
		}));

		logger.debug({}, `Cached ${resps.filter((x) => x).length} markets`);
	}

	public async save(marketId: string, market: MinimalMarketLayoutV3JSON|MinimalMarketLayoutV3, logging = true): Promise<number> {
		const exists = await redisClient.exists(marketDatabaseKey(marketId));
		if (!exists) {
			if (logging) {
				logger.trace({}, `Caching new market: ${marketId}`);
			}
			await redisClient.set(marketDatabaseKey(marketId), JSON.stringify(market))
			return 1;
		}
		return 0;
	}

	public async get(marketId: string): Promise<MinimalMarketLayoutV3JSON> {
		{
			const val = await redisClient.get(marketDatabaseKey(marketId));
			if (val) {
				return JSON.parse(val) as MinimalMarketLayoutV3JSON;
			}
		}

		logger.trace({}, `Fetching new market keys for ${marketId}`);
		const market = await this.fetch(marketId);
		this.save(marketId, market, false);
		return market;
	}

	public async has(marketId: string): Promise<number> {
		return await redisClient.exists(marketDatabaseKey(marketId));
	}

	public async getMultiple(marketsIds: string[]): Promise<MinimalMarketLayoutV3JSON[]> {
		const results = new Array(marketsIds.length) as MinimalMarketLayoutV3JSON[];
		const marketsIdsToFetch = [] as string[];
		const marketsToFetchOriginalIndices = [] as number[];
		for (let i = 0; i < marketsIds.length; i++) {
			const marketId = marketsIds[i];
			const val = await redisClient.get(marketDatabaseKey(marketId));
			if (val) {
				results[i] = JSON.parse(val) as MinimalMarketLayoutV3JSON;
			} else {
				marketsIdsToFetch.push(marketId);
				marketsToFetchOriginalIndices.push(i);
			}
		}
		if (marketsIdsToFetch.length) {
			logger.debug(`Fetching markets for ${marketsIdsToFetch.length} market ids`);
			const marketsToSave = await this.fetchMultiple(marketsIdsToFetch);
			const resps = await Promise.all(zip(marketsIdsToFetch, marketsToSave).map(
				([ marketId, market ]) => this.save(marketId, market, false)
			));
			logger.debug({}, `Cached ${resps.filter((x) => x).length} new markets`);
			for (const [marketToSave, index] of zip(marketsToSave, marketsToFetchOriginalIndices)) {
				results[index] = marketToSave;
			}
		}
		return results;
	}

	private async fetch(rawMarketId: string): Promise<MinimalMarketLayoutV3JSON> {
		const marketId = new PublicKey(rawMarketId);
		if (!this.connection) {
			throw new Error(`Failed to find market data for marketId ${marketId}, because no connection to an RPC was provided for the market cache.`);
		}
		const marketInfo = await this.connection.getAccountInfo(marketId, {
			commitment: this.connection.commitment,
			dataSlice: {
				offset: MARKET_STATE_LAYOUT_V3.offsetOf('eventQueue'),
				length: 32 * 3,
			},
		});

		return JSON.parse(JSON.stringify(
			MINIMAL_MARKET_STATE_LAYOUT_V3.decode(marketInfo!.data)
		)) as MinimalMarketLayoutV3JSON;
	}

	private async fetchMultiple(rawMarketsIds: string[]): Promise<MinimalMarketLayoutV3JSON[]> {
		const marketsIds = rawMarketsIds.map((rawMarketId) => new PublicKey(rawMarketId));
		if (this.solanaIndexer && false) { // currently the Shyft API somehow doesn't have all OpenbookV1_Markets
			const resp = await this.solanaIndexer!.request(
				MinimalMarketLayoutV3Query,
				{
					where: { pubkey: { _in: marketsIds } }
				}
			) as MinimalMarketLayoutV3Response;
			const indexOfMarketId = Object.fromEntries(
				rawMarketsIds.map((marketId: string, i: number) => [marketId, i])
			);
			const result = parseMinimalMarketLayoutV3GraphqlResponse(resp);
			return result
				.sort(([ marketId1, _1 ], [ marketId2, _2 ]) => indexOfMarketId[marketId1] - indexOfMarketId[marketId2])
				.map(([ _, market ]) => market);
		} else if (this.connection) {
			const marketsInfo = await this.connection.getMultipleAccountsInfo(marketsIds, {
				commitment: this.connection.commitment,
				dataSlice: {
					offset: MARKET_STATE_LAYOUT_V3.offsetOf('eventQueue'),
					length: 32 * 3,
				},
			});

			return marketsInfo.map((marketInfo) => JSON.parse(JSON.stringify(
				MINIMAL_MARKET_STATE_LAYOUT_V3.decode(marketInfo!.data)
			))) as MinimalMarketLayoutV3JSON[];
		} else {
			throw new Error(`Failed to find market data for ${marketsIds.length} market ids, because no connection to an RPC, or GraphQL client to a solana indexer was provided for the market cache.`);
		}
	}
}
