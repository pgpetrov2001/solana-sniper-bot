import { Connection, KeyedAccountInfo } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { MARKET_STATE_LAYOUT_V3, TokenAmount } from '@raydium-io/raydium-sdk';
import { GraphQLClient } from 'graphql-request';

import {
    getToken,
    getWallet,
    logger,
    COMMITMENT_LEVEL,
    RPC_ENDPOINT,
    RPC_WEBSOCKET_ENDPOINT,
    PRIVATE_RPC_ENDPOINT,
    PRIVATE_RPC_WEBSOCKET_ENDPOINT,
    PRE_LOAD_EXISTING_MARKETS,
    LOG_LEVEL,
    QUOTE_MINT,
    QUOTE_AMOUNT,
    PRIVATE_KEY,
    AUTO_SELL_DELAY,
    MAX_SELL_RETRIES,
    AUTO_SELL,
    COMPUTE_UNIT_LIMIT,
    COMPUTE_UNIT_PRICE,
    CUSTOM_FEE,
    CACHE_NEW_MARKETS,
    TAKE_PROFIT,
    STOP_LOSS,
    SELL_SLIPPAGE,
    TRANSACTION_EXECUTOR,
    SELL_SKIP_PREFLIGHT,
    DISABLE_RETRY_ON_RATE_LIMIT,
    SHYFT_GRAPHQL_API_URL,
    BUY_SKIP_PREFLIGHT,
    BUY_SLIPPAGE,
} from './helpers/index.ts';
import { MarketCache, PoolCache } from './cache/index.ts';
import { Listeners } from './listeners/index.ts';
import { DefaultTransactionExecutor, TransactionExecutor } from './transactions/index.ts';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor.ts';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor.ts';
import { TpuTransactionExecutor } from './transactions/tpu-transaction-executor.ts';
import { Wallet, WalletConfig } from './wallet.ts';

logger.level = LOG_LEVEL;
logger.info('Wallet is loading...');

const connection = new Connection(RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
    commitment: COMMITMENT_LEVEL,
    disableRetryOnRateLimit: DISABLE_RETRY_ON_RATE_LIMIT,
});

let privateConnection: Connection | null = null;
if (PRIVATE_RPC_ENDPOINT) {
    privateConnection = new Connection(PRIVATE_RPC_ENDPOINT, {
        wsEndpoint: PRIVATE_RPC_WEBSOCKET_ENDPOINT,
        commitment: COMMITMENT_LEVEL,
        disableRetryOnRateLimit: DISABLE_RETRY_ON_RATE_LIMIT,
    });
}

const graphQLClient = new GraphQLClient(SHYFT_GRAPHQL_API_URL, {
    method: 'POST',
    jsonSerializer: {
        parse: JSON.parse,
        stringify: JSON.stringify,
    },
});

const quoteToken = getToken(QUOTE_MINT);
const marketCache = new MarketCache(privateConnection ?? connection, graphQLClient, { quoteToken });
const poolCache = new PoolCache(privateConnection ?? connection, graphQLClient, { quoteToken });
let txExecutor: TransactionExecutor;

switch (TRANSACTION_EXECUTOR) {
    case 'warp': {
        txExecutor = new WarpTransactionExecutor(CUSTOM_FEE);
        break;
    }
    case 'jito': {
        txExecutor = new JitoTransactionExecutor(CUSTOM_FEE, connection);
        break;
    }
    case 'tpu': {
        txExecutor = new TpuTransactionExecutor(connection);
        break;
    }
    default: {
        txExecutor = new DefaultTransactionExecutor(connection);
        break;
    }
}

const wallet_account = getWallet(PRIVATE_KEY.trim());
const walletConfig: WalletConfig = {
    account: wallet_account,
    quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet_account.publicKey),
    quoteToken,
    quoteAmount: new TokenAmount(quoteToken, QUOTE_AMOUNT, false),
    autoSell: AUTO_SELL,
    autoSellDelay: AUTO_SELL_DELAY,
    maxSellRetries: MAX_SELL_RETRIES,
    unitLimit: COMPUTE_UNIT_LIMIT,
    unitPrice: COMPUTE_UNIT_PRICE,
    takeProfit: TAKE_PROFIT,
    stopLoss: STOP_LOSS,
    sellSlippage: SELL_SLIPPAGE,
    buySlippage: BUY_SLIPPAGE,
    sellSkipPreflight: SELL_SKIP_PREFLIGHT,
    buySkipPreflight: BUY_SKIP_PREFLIGHT,
};

export const wallet = new Wallet(connection, privateConnection, marketCache, poolCache, txExecutor, walletConfig);

export const listeners = new Listeners(connection);

(async () => {
    try {
        await wallet.init();
    } catch (err: any) {
        logger.error(err.message);
        process.exit(1);
    }

    if (PRE_LOAD_EXISTING_MARKETS) {
        await marketCache.init();
    }

    await listeners.start({
        walletPublicKey: wallet_account.publicKey,
        quoteToken,
        autoSell: AUTO_SELL,
        cacheNewMarkets: CACHE_NEW_MARKETS,
    });

    listeners.on('market', (updatedAccountInfo: KeyedAccountInfo) => {
        const marketState = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
        marketCache.save(updatedAccountInfo.accountId.toString(), marketState);
    });
})();
