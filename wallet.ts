import {
    Connection,
    Keypair,
    ParsedTransactionWithMeta,
    PublicKey,
    ComputeBudgetProgram,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import {
    AccountLayout,
    createAssociatedTokenAccountIdempotentInstruction,
    createCloseAccountInstruction,
    getAccount,
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
    Liquidity,
    LiquidityPoolKeysV4,
    getPdaMetadataKey,
    Percent,
    Token,
    TokenAmount,
    LiquidityPoolInfo,
} from '@raydium-io/raydium-sdk';
import { getMetadataAccountDataSerializer, MetadataAccountData } from '@metaplex-foundation/mpl-token-metadata';

import { redisClient } from './db.ts';
import { MarketCache, PoolCache, SavedPool } from './cache/index.ts';
import { TransactionExecutor } from './transactions/index.ts';
import { createPoolKeys, logger, zip, NETWORK } from './helpers/index.ts';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor.ts';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor.ts';
import {
    confirmedTxSignaturesForAccount,
    getParsedTokenAccountsByOwner,
    safeFractionToFixed,
    TokenAccount,
    transformTransactions,
} from './helpers/blockchain-operations.ts';

export interface MintAccount {}

export interface WalletConfig {
    account: Keypair;
    quoteToken: Token;
    quoteAmount: TokenAmount;
    quoteAta: PublicKey;
    autoSell: boolean;
    autoSellDelay: number;
    maxSellRetries: number;
    unitLimit: number;
    unitPrice: number;
    takeProfit: number;
    stopLoss: number;
    sellSlippage: number;
    buySlippage: number;
    sellSkipPreflight: boolean;
    buySkipPreflight: boolean;
}

export type SellExecutionInfoJSON = {
    amountOut: string;
    minAmountOut: string;
    currentPrice: string;
    executionPrice: string | null;
    fee: string; // fee is in the input currency
};

export type BuyExecutionInfoJSON = {
    amountIn: string;
    maxAmountIn: string;
    currentPrice: string;
    executionPrice: string | null;
};

export type SwapExecutionInfoJSON = SellExecutionInfoJSON | BuyExecutionInfoJSON;

function txSignatureDatabaseKey(signature: string) {
    return `tx-signature/${signature}`;
}

async function transactionsWithMetaFromSignatures(
    connection: Connection,
    signatures: string[],
): Promise<ParsedTransactionWithMeta[]> {
    let txsWithMeta: Record<string, ParsedTransactionWithMeta> = {};
    const idxOfSig: Record<string, number> = {};
    const unfetchedSignatures = [];
    let idx = 0;
    for (const sig of signatures) {
        idxOfSig[sig] = idx++;
        const val = await redisClient.get(txSignatureDatabaseKey(sig));
        if (val) {
            txsWithMeta[sig] = JSON.parse(val) as ParsedTransactionWithMeta;
        } else {
            unfetchedSignatures.push(sig);
        }
    }
    if (unfetchedSignatures.length) {
        logger.debug(`Fetching transactions with metadata for ${unfetchedSignatures.length} signatures`);

        const resp = await connection.getParsedTransactions(unfetchedSignatures, { maxSupportedTransactionVersion: 0 });
        const parsedTxs: ParsedTransactionWithMeta[] = resp.filter(
            (tx) => tx && tx.meta,
        ) as ParsedTransactionWithMeta[];
        if (parsedTxs.length < resp.length) {
            const msg = `${resp.length - parsedTxs.length} transactions had no metadata in the response from getParsedTransactions`;
            logger.error(msg);
            throw new Error(msg);
        }
        // save fetched results in redis
        await Promise.all(
            parsedTxs.map(async (txWithMeta) => {
                const signature = txWithMeta.transaction.signatures[0];
                await redisClient.set(txSignatureDatabaseKey(signature), JSON.stringify(txWithMeta));
            }),
        );
        txsWithMeta = {
            ...txsWithMeta,
            ...Object.fromEntries(parsedTxs.map((txWithMeta) => [txWithMeta.transaction.signatures[0], txWithMeta])),
        };
    }
    // preserve original order in signatures parameter
    return Object.entries(txsWithMeta)
        .sort(([siga], [sigb]) => idxOfSig[siga] - idxOfSig[sigb])
        .map(([, txWithMeta]) => txWithMeta);
}

export class Wallet {
    public readonly isWarp: boolean = false;
    public readonly isJito: boolean = false;
    public readonly metadataSerializer = getMetadataAccountDataSerializer();
    private walletTxSignatures: string[] | null = null;
    private walletTxs: ParsedTransactionWithMeta[] | null = null;

    constructor(
        public readonly connection: Connection, //TODO: implement ConnectionManager that is a wrapper on top of connection, to avoid 429 with to many concurrent requests (can also utilize multiple RPCs)
        public readonly privateConnection: Connection | null,
        public readonly marketStorage: MarketCache,
        public readonly poolStorage: PoolCache,
        public readonly txExecutor: TransactionExecutor,
        readonly config: WalletConfig,
    ) {
        this.isWarp = txExecutor instanceof WarpTransactionExecutor;
        this.isJito = txExecutor instanceof JitoTransactionExecutor;
    }

    async init() {
        try {
            await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
        } catch (err: unknown) {
            throw new Error(
                `Could not verify whether ${this.config.quoteToken.symbol} token account is present in wallet ${this.config.account.publicKey.toString()} due to error: ${err}`,
            );
        }
        (async () => {
            try {
                console.time('Fetching transaction signatures');
                await this.fetchWalletTxSigs();
                console.timeEnd('Fetching transaction signatures');
            } catch (err: unknown) {
                logger.error(
                    {
                        wallet: this.config.account.publicKey,
                    },
                    `Could not pre-fetch transaction signatures for wallet: ${err}`,
                );
                return;
            }
            try {
                console.time('Fetching transactions with metas');
                await this.fetchWalletTxMetas();
                console.timeEnd('Fetching transactions with metas');
            } catch (err: unknown) {
                logger.error(
                    {
                        wallet: this.config.account.publicKey,
                        signaturesCount: this.walletTxSignatures!.length,
                    },
                    `Could not pre-fetch transaction data from signatures: ${err}`,
                );
            }
        })();
    }

    private async fetchWalletTxSigs() {
        this.walletTxSignatures = await confirmedTxSignaturesForAccount(
            this.privateConnection ?? this.connection,
            this.config.account.publicKey,
        );
        logger.trace(
            {
                wallet: this.config.account.publicKey,
                count: this.walletTxSignatures.length,
            },
            `Fetched wallet transaction signatures.`,
        );
    }

    private async fetchWalletTxMetas() {
        this.walletTxs = await transactionsWithMetaFromSignatures(
            this.privateConnection ?? this.connection,
            this.walletTxSignatures!,
        );
        logger.trace(
            {
                wallet: this.config.account.publicKey,
                count: this.walletTxs.length,
            },
            `Fetched wallet transactions with meta.`,
        );
    }

    //TODO: getMintData should be moved to a wrapper on top of ConnectionManager, that abstracts on top of the RPC calls of solana (sth like a DAO)
    async getMintData(rawMintAddress: string): Promise<MintAccount> {
        const mint = new PublicKey(rawMintAddress);
        const { value: resp } = await this.connection.getParsedAccountInfo(mint);
        if (!resp) {
            throw new Error(`Address ${mint} not found when trying to fetch mint metadata`);
        }
        const data = resp.data;
        if (data instanceof Buffer) {
            throw new Error(`Address ${mint} is probably not a valid mint address`);
        }
        return data.parsed.info;
    }

    async getMintsMetadata(rawMintAddresses: string[]): Promise<MetadataAccountData[]> {
        const allResults: MetadataAccountData[] = [];
        for (let i = 0; i < rawMintAddresses.length; i += 100) {
            const mints = rawMintAddresses.slice(i, i + 100).map((rawMintAddress) => new PublicKey(rawMintAddress));
            const metadataPDAs = mints.map((mint) => getPdaMetadataKey(mint).publicKey);
            const metadataAccounts = await this.connection.getMultipleAccountsInfo(metadataPDAs);
            if (metadataAccounts.find((x) => !x)) {
                throw new Error(`Failed to fetch metadata account data for at least one mint address`);
            }
            const metadataAccountsData = metadataAccounts.map((metadataAccount) => {
                const [metadataAccountData] = this.metadataSerializer.deserialize(metadataAccount!.data);
                return metadataAccountData;
            });
            allResults.push(...metadataAccountsData);
        }
        return allResults;
    }

    async getAndCacheMintsPools(rawMintAddresses: string[]): Promise<SavedPool[]> {
        return await this.poolStorage.getMultiple(rawMintAddresses);
    }

    async getTokenAccounts(): Promise<TokenAccount[]> {
        return getParsedTokenAccountsByOwner(this.connection, this.config.account.publicKey);
    }

    async getAllTokenAccounts(): Promise<TokenAccount[]> {
        if (!this.walletTxs) {
            throw new Error(`Cannot get closed token accounts, because no transactions were fetched from the storage`);
        }

        const accounts = await this.getTokenAccounts();
        logger.trace(`Fetched ${accounts.length} open token accounts`);
        const openAtaKeys = accounts.map(({ address }) => address);
        const openAtaMints = accounts.map(({ mint }) => mint);
        const computedAtas: Record<string, string> = Object.fromEntries(zip(openAtaKeys, openAtaMints));

        for (const tx of this.walletTxs) {
            const transactedMintsPre = tx.meta?.preTokenBalances?.map((tokenBalance) => tokenBalance.mint);
            const transactedMintsPost = tx.meta?.postTokenBalances?.map((tokenBalance) => tokenBalance.mint);
            const transactedMints = transactedMintsPre?.concat(transactedMintsPost ?? []) ?? transactedMintsPost ?? [];
            for (const mint of transactedMints) {
                if (!(mint in computedAtas)) {
                    computedAtas[mint] = getAssociatedTokenAddressSync(
                        new PublicKey(mint),
                        this.config.account.publicKey,
                    ).toString();
                    const ata = computedAtas[mint];
                    accounts.push({
                        closed: true,
                        address: ata,
                        mint,
                        owner: this.config.account.publicKey.toString(),
                        tokenAmount: {
                            amount: '0',
                            decimals: 0,
                            uiAmount: 0,
                            uiAmountString: '0',
                        },
                    });
                }
            }
            // use the fact that associated token addresses for mints are listed here, to avoid calling getAssociatedTokenAddressSync too many times
            // const participatingAccountKeys = tx.transaction.message.accountKeys.map((accountKey) => accountKey.pubkey);
        }

        logger.trace(`Returning ${accounts.length} token accounts (including closed ones)`);

        return accounts;
    }

    private async prepareComputeAmountInput(
        rawMintAddress: string,
        rawAmount: string,
    ): Promise<{ poolKeys: LiquidityPoolKeysV4; poolInfo: LiquidityPoolInfo; amount: TokenAmount }> {
        const mint = new PublicKey(rawMintAddress);
        const poolData = await this.poolStorage.get(rawMintAddress);
        const market = await this.marketStorage.get(poolData.state.marketId);
        const poolKeys = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);
        const poolInfo = await Liquidity.fetchInfo({
            connection: this.connection,
            poolKeys,
        });
        const tokenToSell = new Token(TOKEN_PROGRAM_ID, mint, Number(poolData.state.baseDecimal));
        const amount = new TokenAmount(tokenToSell, BigInt(rawAmount), true);
        return { poolKeys, poolInfo, amount };
    }

    private async prepareMultipleComputeAmountInputs(
        rawMintAddresses: string[],
        rawAmounts: string[],
    ): Promise<{ poolsKeys: LiquidityPoolKeysV4[]; poolsInfos: LiquidityPoolInfo[]; amounts: TokenAmount[] }> {
        const mints = rawMintAddresses.map((rawMintAddress) => new PublicKey(rawMintAddress));
        const poolsDatas = await this.poolStorage.getMultiple(rawMintAddresses);
        const marketIds = poolsDatas.map(({ state: { marketId } }) => marketId);
        const markets = await this.marketStorage.getMultiple(marketIds);
        const poolsKeys = zip(poolsDatas, markets).map(([{ id, state }, market]) =>
            createPoolKeys(new PublicKey(id), state, market),
        );
        const poolsInfos = await Liquidity.fetchMultipleInfo({
            connection: this.connection,
            pools: poolsKeys,
        });
        logger.debug(`Fetched multiple infos ${poolsInfos.length}`);
        const tokensToSell = zip(mints, poolsDatas).map(
            ([mint, poolData]) => new Token(TOKEN_PROGRAM_ID, mint, Number(poolData.state.baseDecimal)),
        );
        const amounts = zip(tokensToSell, rawAmounts).map(
            ([tokenToSell, rawAmountToSell]) => new TokenAmount(tokenToSell, BigInt(rawAmountToSell), true),
        );
        return { poolsKeys, poolsInfos, amounts };
    }

    private executeComputeAmountOut(poolKeys: LiquidityPoolKeysV4, poolInfo: LiquidityPoolInfo, amount: TokenAmount) {
        const slippagePercent = new Percent(this.config.sellSlippage, 100);
        const resp = Liquidity.computeAmountOut({
            poolKeys,
            poolInfo,
            amountIn: amount,
            currencyOut: this.config.quoteToken,
            slippage: slippagePercent,
        });
        return {
            amountOut: safeFractionToFixed(resp.amountOut),
            minAmountOut: safeFractionToFixed(resp.minAmountOut),
            currentPrice: safeFractionToFixed(resp.currentPrice),
            executionPrice: resp.executionPrice ? safeFractionToFixed(resp.executionPrice) : null,
            fee: safeFractionToFixed(resp.fee),
        };
    }

    private executeComputeAmountIn(poolKeys: LiquidityPoolKeysV4, poolInfo: LiquidityPoolInfo, amount: TokenAmount) {
        const slippagePercent = new Percent(this.config.buySlippage, 100);
        const resp = Liquidity.computeAmountIn({
            poolKeys,
            poolInfo,
            amountOut: amount,
            currencyIn: this.config.quoteToken,
            slippage: slippagePercent,
        });
        return {
            amountIn: safeFractionToFixed(resp.amountIn),
            maxAmountIn: safeFractionToFixed(resp.maxAmountIn),
            currentPrice: safeFractionToFixed(resp.currentPrice),
            executionPrice: resp.executionPrice ? safeFractionToFixed(resp.executionPrice) : null,
        };
    }

    async getTokenSellExecutionInfo(rawMintAddress: string, rawAmountToSell: string): Promise<SellExecutionInfoJSON> {
        const { poolKeys, poolInfo, amount } = await this.prepareComputeAmountInput(rawMintAddress, rawAmountToSell);
        return this.executeComputeAmountOut(poolKeys, poolInfo, amount);
    }

    async getTokenBuyExecutionInfo(rawMintAddress: string, rawAmountToBuy: string): Promise<BuyExecutionInfoJSON> {
        const { poolKeys, poolInfo, amount } = await this.prepareComputeAmountInput(rawMintAddress, rawAmountToBuy);
        return this.executeComputeAmountIn(poolKeys, poolInfo, amount);
    }

    async getMultipleTokenSellExecutionInfo(
        rawMintAddresses: string[],
        rawAmountsToSell: string[],
    ): Promise<SellExecutionInfoJSON[]> {
        const { poolsKeys, poolsInfos, amounts } = await this.prepareMultipleComputeAmountInputs(
            rawMintAddresses,
            rawAmountsToSell,
        );
        return zip(poolsKeys, poolsInfos, amounts).map(([poolKeys, poolInfo, amount]) =>
            this.executeComputeAmountOut(poolKeys, poolInfo, amount),
        );
    }

    async getMultipleTokenBuyExecutionInfo(
        rawMintAddresses: string[],
        rawAmountsToBuy: string[],
    ): Promise<BuyExecutionInfoJSON[]> {
        const { poolsKeys, poolsInfos, amounts } = await this.prepareMultipleComputeAmountInputs(
            rawMintAddresses,
            rawAmountsToBuy,
        );
        return zip(poolsKeys, poolsInfos, amounts).map(([poolKeys, poolInfo, amount]) =>
            this.executeComputeAmountIn(poolKeys, poolInfo, amount),
        );
    }

    private getStoredAtaTransactions(ata: PublicKey): ParsedTransactionWithMeta[] {
        if (!this.walletTxs) {
            throw new Error(
                `Cannot get transaction for ata ${ata}, because no transactions were fetched for the storage`,
            );
        }
        return this.walletTxs.filter((txWithMeta) =>
            txWithMeta.transaction.message.accountKeys.map(({ pubkey }) => pubkey.toString()).includes(ata.toString()),
        );
    }

    private async getAtaTransactions(ata: PublicKey): Promise<ParsedTransactionWithMeta[]> {
        const connection = this.privateConnection ?? this.connection;
        if (this.walletTxs) {
            const storedAtaTransactionsWithMeta = this.getStoredAtaTransactions(ata);
            const newestTxSig = storedAtaTransactionsWithMeta[0].transaction.signatures[0];
            const newerAtaTransactions = await confirmedTxSignaturesForAccount(connection, ata, newestTxSig);
            const newerAtaTransactionsWithMeta = await transactionsWithMetaFromSignatures(
                connection,
                newerAtaTransactions,
            );
            return newerAtaTransactionsWithMeta.concat(storedAtaTransactionsWithMeta);
        }
        const confirmedSignatures = await confirmedTxSignaturesForAccount(connection, ata);
        return await transactionsWithMetaFromSignatures(connection, confirmedSignatures);
    }

    async getMultipleAtaBuyAndSellTransactions(rawMintAddresses: string[], rawAtaAddresses: string[]) {
        const mints = rawMintAddresses.map((rawMintAddress) => new PublicKey(rawMintAddress));
        const atas = rawAtaAddresses.map((rawAtaAddress) => new PublicKey(rawAtaAddress));

        const owner = this.config.account.publicKey;

        return zip(mints, atas).map(([mint, ata]) => {
            const txsWithMeta = this.getStoredAtaTransactions(ata);
            return transformTransactions(txsWithMeta, mint.toString(), owner.toString());
        });
    }

    async getAtaBuyAndSellTransactions(rawMintAddress: string, rawAtaAddress: string) {
        const ata = new PublicKey(rawAtaAddress);

        const owner = this.config.account.publicKey;
        const rawOwnerAddress = owner.toString();

        const txsWithMeta = await this.getAtaTransactions(ata);
        return transformTransactions(txsWithMeta, rawMintAddress, rawOwnerAddress);
    }

    // TODO: after confirming, update this.walletTxs and this.walletTxSignatures
    async sellAll(rawMintAddress: string, rawAtaAddress: string) {
        const ata = new PublicKey(rawAtaAddress);

        const tokenAccountInfo = await this.connection.getAccountInfo(ata, this.connection.commitment);

        if (tokenAccountInfo == null) {
            logger.error('No ATA exists for this token mint, exiting...');
            process.exit(1);
        }

        const tokenAccountData = AccountLayout.decode(tokenAccountInfo.data);

        const poolData = await this.poolStorage.get(rawMintAddress);
        const market = await this.marketStorage.get(poolData.state.marketId);
        const poolKeys = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);

        const token = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
        const tokenAmount = new TokenAmount(token, tokenAccountData.amount, true);

        const result = await this.swap(poolKeys, token, ata, tokenAmount, 'sell');

        if (result.confirmed) {
            logger.info(
                {
                    mint: rawMintAddress,
                    signature: result.signature,
                    url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
                },
                `Confirmed sell tx`,
            );

            return;
        }

        logger.info(
            {
                mint: rawMintAddress,
                signature: result.signature,
                error: result.error,
            },
            `Error confirming sell tx`,
        );

        throw new Error(`Error confirming sell tx: ${result.error}`);
    }

    private async swap(
        poolKeys: LiquidityPoolKeysV4,
        token: Token,
        tokenAta: PublicKey,
        amountIn: TokenAmount,
        direction: 'buy' | 'sell',
    ) {
        const ataDonor = direction === 'buy' ? this.config.quoteAta : tokenAta;
        const ataRecipient = direction === 'buy' ? tokenAta : this.config.quoteAta;
        const tokenReceiving = direction === 'buy' ? token : this.config.quoteToken;
        const slippage = direction === 'buy' ? this.config.buySlippage : this.config.sellSlippage;
        const slippagePercent = new Percent(slippage, 100);
        const poolInfo = await Liquidity.fetchInfo({
            connection: this.connection,
            poolKeys,
        });

        const computedAmountOut = Liquidity.computeAmountOut({
            poolKeys,
            poolInfo,
            amountIn,
            currencyOut: tokenReceiving,
            slippage: slippagePercent,
        });

        const latestBlockhash = await this.connection.getLatestBlockhash();
        const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
            {
                poolKeys: poolKeys,
                userKeys: {
                    tokenAccountIn: ataDonor,
                    tokenAccountOut: ataRecipient,
                    owner: this.config.account.publicKey,
                },
                amountIn: amountIn.raw,
                minAmountOut: computedAmountOut.minAmountOut.raw,
            },
            poolKeys.version,
        );

        const messageV0 = new TransactionMessage({
            payerKey: this.config.account.publicKey,
            recentBlockhash: latestBlockhash.blockhash,

            instructions: [
                ...(this.isWarp || this.isJito
                    ? []
                    : [
                          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
                          ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
                      ]),
                ...(direction === 'buy'
                    ? [
                          createAssociatedTokenAccountIdempotentInstruction(
                              this.config.account.publicKey,
                              tokenAta,
                              this.config.account.publicKey,
                              token.mint,
                          ),
                      ]
                    : []),
                ...innerTransaction.instructions,
                ...(direction === 'sell'
                    ? [
                          createCloseAccountInstruction(
                              tokenAta,
                              this.config.account.publicKey,
                              this.config.account.publicKey,
                          ),
                      ]
                    : []),
            ],
        }).compileToV0Message();
        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([this.config.account, ...innerTransaction.signers]);
        const skipPreflight = { buy: this.config.buySkipPreflight, sell: this.config.sellSkipPreflight }[direction];
        return this.txExecutor.executeAndConfirm(transaction, this.config.account, latestBlockhash, skipPreflight);
    }
}
//TODO: cache all account transactions in a database
