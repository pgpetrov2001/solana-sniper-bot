import { PublicKey } from '@solana/web3.js';
import { Liquidity, LiquidityPoolKeys, MAINNET_PROGRAM_ID, Market } from '@raydium-io/raydium-sdk';
import { gql } from 'graphql-request';

import { MinimalMarketLayoutV3JSON } from './market.ts';
import { parseGraphqlResponse } from './graphql-solana-indexer.ts';

// running JSON.stringify on LiquidityStateV4 converts BN type (big number) from the 'bn.js' lib, to a string type
// i.e. the value is written in hex format, same for PublicKey
// that's why we need this type for consistency and compatibility
export type LiquidityStateV4JSON = {
    nonce: string; //BN
    owner: string; //PublicKey
    status: string; //BN
    maxOrder: string; //BN
    depth: string; //BN
    baseDecimal: string; //BN
    quoteDecimal: string; //BN
    state: string; //BN
    resetFlag: string; //BN
    minSize: string; //BN
    volMaxCutRatio: string; //BN
    amountWaveRatio: string; //BN
    baseLotSize: string; //BN
    quoteLotSize: string; //BN
    minPriceMultiplier: string; //BN
    maxPriceMultiplier: string; //BN
    systemDecimalValue: string; //BN
    minSeparateNumerator: string; //BN
    minSeparateDenominator: string; //BN
    tradeFeeNumerator: string; //BN
    tradeFeeDenominator: string; //BN
    pnlNumerator: string; //BN
    pnlDenominator: string; //BN
    swapFeeNumerator: string; //BN
    swapFeeDenominator: string; //BN
    baseNeedTakePnl: string; //BN
    quoteNeedTakePnl: string; //BN
    quoteTotalPnl: string; //BN
    baseTotalPnl: string; //BN
    poolOpenTime: string; //BN
    punishPcAmount: string; //BN
    punishCoinAmount: string; //BN
    orderbookToInitTime: string; //BN
    swapBaseInAmount: string; //BN
    swapQuoteOutAmount: string; //BN
    swapBase2QuoteFee: string; //BN
    swapQuoteInAmount: string; //BN
    swapBaseOutAmount: string; //BN
    swapQuote2BaseFee: string; //BN
    baseVault: string; //PublicKey
    quoteVault: string; //PublicKey
    baseMint: string; //PublicKey
    quoteMint: string; //PublicKey
    lpMint: string; //PublicKey
    openOrders: string; //PublicKey
    marketId: string; //PublicKey
    marketProgramId: string; //PublicKey
    targetOrders: string; //PublicKey
    withdrawQueue: string; //PublicKey
    lpVault: string; //PublicKey
    lpReserve: string; //BN
    padding: string[]; //BN[]
};

export const LiquidityStateV4GraphqlQuery = gql`
query MyQuery($where: Raydium_LiquidityPoolv4_bool_exp) {
	Raydium_LiquidityPoolv4(
	where: $where
	) {
		amountWaveRatio
		baseDecimal
		baseLotSize
		baseMint
		baseNeedTakePnl
		baseTotalPnl
		baseVault
		depth
		lpMint
		lpReserve
		lpVault
		marketId
		marketProgramId
		maxOrder
		maxPriceMultiplier
		minPriceMultiplier
		minSeparateDenominator
		minSeparateNumerator
		minSize
		nonce
		openOrders
		orderbookToInitTime
		owner
		pnlDenominator
		pnlNumerator
		poolOpenTime
		punishCoinAmount
		punishPcAmount
		quoteDecimal
		quoteLotSize
		quoteMint
		quoteNeedTakePnl
		quoteTotalPnl
		quoteVault
		resetFlag
		state
		status
		swapBase2QuoteFee
		swapBaseInAmount
		swapBaseOutAmount
		swapFeeDenominator
		swapFeeNumerator
		swapQuote2BaseFee
		swapQuoteInAmount
		swapQuoteOutAmount
		systemDecimalValue
		targetOrders
		tradeFeeDenominator
		tradeFeeNumerator
		volMaxCutRatio
		withdrawQueue
		pubkey
	}
}`;

export type LiquidityStateV4GraphqlResponse = {
	Raydium_LiquidityPoolv4: {
		amountWaveRatio: number|null;
		baseDecimal: number|null;
		baseLotSize: number|null;
		baseMint: string|null;
		baseNeedTakePnl: number|null;
		baseTotalPnl: number|null;
		baseVault: string|null;
		depth: number|null;
		lpMint: string|null;
		lpReserve: number|null;
		lpVault: string|null;
		marketId: string|null;
		marketProgramId: string|null;
		maxOrder: number|null;
		maxPriceMultiplier: number|null;
		minPriceMultiplier: number|null;
		minSeparateDenominator: number|null;
		minSeparateNumerator: number|null;
		minSize: number|null;
		nonce: number|null;
		openOrders: string|null;
		orderbookToInitTime: number|null;
		owner: string|null;
		padding: number[];
		pnlDenominator: number|null;
		pnlNumerator: number|null;
		poolOpenTime: number|null;
		pubkey: string;
		punishCoinAmount: number|null;
		punishPcAmount: number|null;
		quoteDecimal: number|null;
		quoteLotSize: number|null;
		quoteMint: string|null;
		quoteNeedTakePnl: number|null;
		quoteTotalPnl: number|null;
		quoteVault: string|null;
		resetFlag: number|null;
		state: number|null;
		status: number|null;
		swapBase2QuoteFee: number|null;
		swapBaseInAmount: number|null;
		swapBaseOutAmount: number|null;
		swapFeeDenominator: number|null;
		swapFeeNumerator: number|null;
		swapQuote2BaseFee: number|null;
		swapQuoteInAmount: number|null;
		swapQuoteOutAmount: number|null;
		systemDecimalValue: number|null;
		targetOrders: string|null;
		tradeFeeDenominator: number|null;
		tradeFeeNumerator: number|null;
		volMaxCutRatio: number|null;
		withdrawQueue: string|null;
	}[]
};

export const parseLiquidityStateV4GraphqlResponse = ({ Raydium_LiquidityPoolv4: items }: LiquidityStateV4GraphqlResponse) => {
	return parseGraphqlResponse(items) as [string, LiquidityStateV4JSON][];
};

export function createPoolKeys(
	id: PublicKey,
	accountData: LiquidityStateV4JSON,
	minimalMarketLayoutV3: MinimalMarketLayoutV3JSON,
): LiquidityPoolKeys {
	return {
		id,
		baseMint: new PublicKey(accountData.baseMint),
		quoteMint: new PublicKey(accountData.quoteMint),
		lpMint: new PublicKey(accountData.lpMint),
		baseDecimals: parseInt(accountData.baseDecimal, 16),
		quoteDecimals: parseInt(accountData.quoteDecimal, 16),
		lpDecimals: 5,
		version: 4,
		programId: MAINNET_PROGRAM_ID.AmmV4,
		authority: Liquidity.getAssociatedAuthority({
			programId: MAINNET_PROGRAM_ID.AmmV4,
		}).publicKey,
		openOrders: new PublicKey(accountData.openOrders),
		targetOrders: new PublicKey(accountData.targetOrders),
		baseVault: new PublicKey(accountData.baseVault),
		quoteVault: new PublicKey(accountData.quoteVault),
		marketVersion: 3,
		marketProgramId: new PublicKey(accountData.marketProgramId),
		marketId: new PublicKey(accountData.marketId),
		marketAuthority: Market.getAssociatedAuthority({
			programId: new PublicKey(accountData.marketProgramId),
			marketId: new PublicKey(accountData.marketId),
		}).publicKey,
		marketBaseVault: new PublicKey(accountData.baseVault),
		marketQuoteVault: new PublicKey(accountData.quoteVault),
		marketBids: new PublicKey(minimalMarketLayoutV3.bids),
		marketAsks: new PublicKey(minimalMarketLayoutV3.asks),
		marketEventQueue: new PublicKey(minimalMarketLayoutV3.eventQueue),
		withdrawQueue: new PublicKey(accountData.withdrawQueue),
		lpVault: new PublicKey(accountData.lpVault),
		lookupTableAccount: PublicKey.default,
	};
}
