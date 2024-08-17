import { gql, GraphQLClient } from 'graphql-request';
import { LiquidityStateV4JSON } from './liquidity.ts';

export const Raydium_LiquidityPoolv4_query = gql`
query MyQuery($where: Raydium_LiquidityPoolv4_bool_exp) {
	Raydium_LiquidityPoolv4(
	where: $where
	) {
		_updatedAt
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

export type Raydium_LiquidityPoolv4_Response = {
	_updatedAt: Date;
	amountWaveRatio: number|null;
	baseDecimal: number|null;
	baseLotSize: number|null;
	baseMint: string|null;
	baseNeedTakePnl: number|null;
	baseTotalPnl: number|null;
	baseVault: string|null;
	depth: number|null;
	lamports: number;
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
};

export const standardizeRaydium_LiquidityPoolv4_Response = (resp: Raydium_LiquidityPoolv4_Response): LiquidityStateV4JSON => {
	return Object.fromEntries(
		Object.entries(resp)
		  .filter(([ key, _ ]) => !['_updatedAt', 'lamports', 'pubkey'].includes(key))
		  .map(([ key, val ]) => [
			  key,
			  val == null? '': (Array.isArray(val)? val.map((x) => x.toString()): val.toString())
		  ])
	) as LiquidityStateV4JSON;
};
