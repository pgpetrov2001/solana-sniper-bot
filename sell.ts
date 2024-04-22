import { MarketCache, PoolCache } from './cache';
import { Listeners } from './listeners';
import { Connection, PublicKey, KeyedAccountInfo, Keypair } from '@solana/web3.js';
import {
	LIQUIDITY_STATE_LAYOUT_V4,
	MAINNET_PROGRAM_ID,
	MARKET_STATE_LAYOUT_V3,
	LiquidityStateV4,
	Token,
	TokenAmount,
} from '@raydium-io/raydium-sdk';
import { AccountLayout, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Bot, BotConfig } from './bot';
import { DefaultTransactionExecutor, TransactionExecutor } from './transactions';
import {
	getToken,
	getWallet,
	logger,
	COMMITMENT_LEVEL,
	RPC_ENDPOINT,
	RPC_WEBSOCKET_ENDPOINT,
	PRE_LOAD_EXISTING_MARKETS,
	LOG_LEVEL,
	CHECK_IF_MINT_IS_RENOUNCED,
	CHECK_IF_BURNED,
	QUOTE_MINT,
	MAX_POOL_SIZE,
	MIN_POOL_SIZE,
	QUOTE_AMOUNT,
	PRIVATE_KEY,
	USE_SNIPE_LIST,
	ONE_TOKEN_AT_A_TIME,
	AUTO_SELL_DELAY,
	MAX_SELL_RETRIES,
	AUTO_SELL,
	MAX_BUY_RETRIES,
	AUTO_BUY_DELAY,
	COMPUTE_UNIT_LIMIT,
	COMPUTE_UNIT_PRICE,
	CACHE_NEW_MARKETS,
	TAKE_PROFIT,
	STOP_LOSS,
	BUY_SLIPPAGE,
	SELL_SLIPPAGE,
	PRICE_CHECK_DURATION,
	PRICE_CHECK_INTERVAL,
	SNIPE_LIST_REFRESH_INTERVAL,
	TRANSACTION_EXECUTOR,
	WARP_FEE,
	FILTER_CHECK_INTERVAL,
	FILTER_CHECK_DURATION,
	CONSECUTIVE_FILTER_MATCHES,
} from './helpers';
import { version } from './package.json';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { ArgumentParser } from 'argparse';

const connection = new Connection(RPC_ENDPOINT, {
	wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
	commitment: COMMITMENT_LEVEL,
});

logger.level = LOG_LEVEL;
logger.info('Bot is starting...');

const marketCache = new MarketCache(connection);
const poolCache = new PoolCache();
let txExecutor: TransactionExecutor;

switch (TRANSACTION_EXECUTOR) {
	case 'warp': {
		txExecutor = new WarpTransactionExecutor(WARP_FEE);
		break;
	}
	default: {
		txExecutor = new DefaultTransactionExecutor(connection);
		break;
	}
}

const wallet = getWallet(PRIVATE_KEY.trim());
const quoteToken = getToken(QUOTE_MINT);
const botConfig = <BotConfig>{
	wallet,
	quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet.publicKey),
	checkRenounced: CHECK_IF_MINT_IS_RENOUNCED,
	checkBurned: CHECK_IF_BURNED,
	minPoolSize: new TokenAmount(quoteToken, MIN_POOL_SIZE, false),
	maxPoolSize: new TokenAmount(quoteToken, MAX_POOL_SIZE, false),
	quoteToken,
	quoteAmount: new TokenAmount(quoteToken, QUOTE_AMOUNT, false),
	oneTokenAtATime: ONE_TOKEN_AT_A_TIME,
	useSnipeList: USE_SNIPE_LIST,
	autoSell: AUTO_SELL,
	autoSellDelay: AUTO_SELL_DELAY,
	maxSellRetries: MAX_SELL_RETRIES,
	autoBuyDelay: AUTO_BUY_DELAY,
	maxBuyRetries: MAX_BUY_RETRIES,
	unitLimit: COMPUTE_UNIT_LIMIT,
	unitPrice: COMPUTE_UNIT_PRICE,
	takeProfit: TAKE_PROFIT,
	stopLoss: STOP_LOSS,
	buySlippage: BUY_SLIPPAGE,
	sellSlippage: SELL_SLIPPAGE,
	priceCheckInterval: PRICE_CHECK_INTERVAL,
	priceCheckDuration: PRICE_CHECK_DURATION,
	filterCheckInterval: FILTER_CHECK_INTERVAL,
	filterCheckDuration: FILTER_CHECK_DURATION,
	consecutiveMatchCount: CONSECUTIVE_FILTER_MATCHES,
};

const bot = new Bot(connection, marketCache, poolCache, txExecutor, botConfig);

const parser = new ArgumentParser({
	description: `
Sell your token by specifying mint or address of liquidity pool.
If you don't have the liquidity pool address, this script can find it from the mint but
you need to set in .env the addresses of some private RPC node that supports the RPC call getProgramAccounts.
Public RPC nodes are usually heavily rate limited and do not support this call.
`,
});
parser.add_argument('mode', { type: 'string', choices: ['mint', 'pool'] });
parser.add_argument('pubkey', { type: 'string', help: 'Base58 public key of mint or pool' });
const args = parser.parse_args();

const addLiquidityPool = async (): Promise<LiquidityStateV4> => {
	let poolAccount, poolAddress;

	if (args.mode === 'pool') {
		poolAddress = new PublicKey(args.pubkey);
		poolAccount = await connection.getAccountInfo(poolAddress, connection.commitment);
	} else if (args.mode === 'mint') {
		logger.info(`Fetching raydium program accounts...`);
		const baseMint = new PublicKey(args.pubkey);
		const poolsAccounts = await connection.getProgramAccounts(MAINNET_PROGRAM_ID.AmmV4, {
			commitment: connection.commitment,
			filters: [
				{ dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
				{
					memcmp: {
						offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
						bytes: baseMint.toBase58(),
					},
				},
				{
					memcmp: {
						offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
						bytes: quoteToken.mint.toBase58(),
					},
				},
			],
		});

		logger.trace(`Number of liquidity pool accounts fetched: ${poolsAccounts.length}`);

		[{ account: poolAccount, pubkey: poolAddress }] = poolsAccounts;
	}

	if (!poolAccount) {
		throw Error(`Could not find liquidity pool from ${args.mode} address: ${args.pubkey}`);
	}

	logger.info(`Liquidity pool address (save this): ${poolAddress}`);

	const poolData = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);
	poolCache.save(poolAddress!.toString(), poolData);

	logger.trace(`Market ID: ${poolData.marketId}`);
	await marketCache.get(poolData.marketId.toString()); // side effect: saves the fetched market data

	return poolData;
};

(async () => {
	const valid = await bot.validate();

	if (!valid) {
		logger.info('Bot is exiting...');
		process.exit(1);
	}

	logger.info(`Quote: ${QUOTE_MINT}`);

	try {
		const pool = await addLiquidityPool();
		const mint = pool.baseMint;

		logger.info(`Mint: ${mint}`);

		const ataa = getAssociatedTokenAddressSync(mint, wallet.publicKey);
		const tokenAccountInfo = await connection.getAccountInfo(ataa, connection.commitment);

		if (tokenAccountInfo == null) {
			logger.error('No ATA exists for this token mint, exiting...');
			process.exit(1);
		}

		const tokenAccountData = AccountLayout.decode(tokenAccountInfo.data);

		await bot.sell(ataa, tokenAccountData);
	} catch (err: any) {
		logger.debug(`An error occurred while selling: ${err}\n${err.stack}`);
	}
})();
