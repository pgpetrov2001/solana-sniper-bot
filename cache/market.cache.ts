import { Connection, PublicKey } from '@solana/web3.js';
import { MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import { gql, GraphQLClient } from 'graphql-request/build/entrypoints/main.d.ts';

import { redisClient } from '../db';
import { getMinimalMarketV3, logger, MINIMAL_MARKET_STATE_LAYOUT_V3, MinimalMarketLayoutV3 } from '../helpers';

export class MarketCache {
	private readonly keys: Map<string, MinimalMarketLayoutV3> = new Map<string, MinimalMarketLayoutV3>();
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

		for (const account of accounts) {
			const market = MINIMAL_MARKET_STATE_LAYOUT_V3.decode(account.account.data);
			this.keys.set(account.pubkey.toString(), market);
		}

		logger.debug({}, `Cached ${this.keys.size} markets`);
	}

	public save(marketId: string, keys: MinimalMarketLayoutV3, logging = true) {
		if (!this.keys.has(marketId)) {
			if (logging) {
				logger.trace({}, `Caching new market: ${marketId}`);
			}
			this.keys.set(marketId, keys);
		}
	}

	public async get(marketId: string): Promise<MinimalMarketLayoutV3> {
		if (this.keys.has(marketId)) {
			return this.keys.get(marketId)!;
		}

		logger.trace({}, `Fetching new market keys for ${marketId}`);
		const market = await this.fetch(marketId);
		this.keys.set(marketId, market);
		return market;
	}

	public async has(mint: string): Promise<boolean> {
		return this.keys.has(mint);
	}

	private fetch(marketId: string): Promise<MinimalMarketLayoutV3> {
		if (!this.connection) {
			throw new Error(`Failed to find market data for marketId ${marketId}, because no connection to an RPC was provided for the market cache.`);
		}
		return getMinimalMarketV3(this.connection, new PublicKey(marketId), this.connection.commitment);
	}
}
