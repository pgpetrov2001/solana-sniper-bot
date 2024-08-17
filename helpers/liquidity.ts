import { PublicKey } from '@solana/web3.js';
import { Liquidity, LiquidityPoolKeys, MAINNET_PROGRAM_ID, Market } from '@raydium-io/raydium-sdk';
import { MinimalMarketLayoutV3 } from './market.ts';

// running JSON.stringify on LiquidityStateV4 converts BN type (big number) from the 'bn.js' lib, to a string type
// i.e. the value is written in hex format, same for PublicKey
// that's why we need this file for consistency and compatibility
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

export function createPoolKeys(
	id: PublicKey,
	accountData: LiquidityStateV4JSON,
	minimalMarketLayoutV3: MinimalMarketLayoutV3,
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
		marketBids: minimalMarketLayoutV3.bids,
		marketAsks: minimalMarketLayoutV3.asks,
		marketEventQueue: minimalMarketLayoutV3.eventQueue,
		withdrawQueue: new PublicKey(accountData.withdrawQueue),
		lpVault: new PublicKey(accountData.lpVault),
		lookupTableAccount: PublicKey.default,
	};
}
