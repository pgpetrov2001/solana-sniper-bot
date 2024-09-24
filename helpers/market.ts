import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { GetStructureSchema, MARKET_STATE_LAYOUT_V3, publicKey, struct } from '@raydium-io/raydium-sdk';
import { gql } from 'graphql-request';

import { parseGraphqlResponse } from './graphql-solana-indexer.ts';

export const MINIMAL_MARKET_STATE_LAYOUT_V3 = struct([publicKey('eventQueue'), publicKey('bids'), publicKey('asks')]);
export type MinimalMarketStateLayoutV3 = typeof MINIMAL_MARKET_STATE_LAYOUT_V3;
export type MinimalMarketLayoutV3 = GetStructureSchema<MinimalMarketStateLayoutV3>;
export type MinimalMarketLayoutV3JSON = {
	eventQueue: string;
	bids: string;
	asks: string;
};

export const MinimalMarketLayoutV3Query = gql`
query MyQuery($where: OpenbookV1_Market_bool_exp) {
	OpenbookV1_Market(
		where: $where,
	) {
		asks
		bids
		eventQueue
		pubkey
	}
}`;

export type MinimalMarketLayoutV3Response = {
	OpenbookV1_Market: {
		asks: string|null;
		bids: string|null;
		eventQueue: string|null;
		pubkey: string;
	}[]
};

export const parseMinimalMarketLayoutV3GraphqlResponse = ({ OpenbookV1_Market: items }: MinimalMarketLayoutV3Response) => {
	return parseGraphqlResponse(items) as [string, MinimalMarketLayoutV3JSON][];
};
