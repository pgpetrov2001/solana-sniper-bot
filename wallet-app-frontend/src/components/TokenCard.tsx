import { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardMedia from '@mui/material/CardMedia';
import Typography from '@mui/material/Typography';
import { Button, CardActionArea, CardActions } from '@mui/material';

import { JsonMetadata } from '@metaplex-foundation/mpl-token-metadata';

import { SellExecutionInfoJSON, SwapExecutionInfoJSON } from '../../../wallet';

import { TokensAuxiliaryDataContext } from '../App';
import { TokenAccount } from '../../../helpers/blockchain-operations';
import { zip } from '../../../helpers/common';

const disableCacheHeaders = {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Expires: '0',
};

type SwapTransaction = {
    signature: string;
    balanceChanges: { [key: string]: string };
};

/**
 * Info about token trading history and current state
 */
type TradingHistory = {
    /** sum of all sells in token */
    tokenSold: string;
    /** sum of all txs in quote */
    quoteBalance: string;
    /** sum of all txs in token */
    tokenHeld: string;
    /** quote_would_receive_now */
    unrealizedReturn: string;
    /** sum of amount_quote_returned - cum_avg_price_bought * amount_token_sold */
    realizedPnl: string;
    /** unrealized_return - quote_invested */
    unrealizedPnl: string;
    /** min_quote_would_receive_now - quote_invested, could receive less due to slippage */
    minUnrealizedPnl: string;
    /** sum of all buys in quote */
    totalInvested: string;
};

const WSOL = 'So11111111111111111111111111111111111111112';

export default function TokenCard({ tokenAccountData, index }: { tokenAccountData: TokenAccount; index: number }) {
    const { mint, address, owner, tokenAmount } = tokenAccountData;

    const [tokensAuxiliaryDatas, setTokensAuxiliaryDatas] = useContext(TokensAuxiliaryDataContext);

    const [swapExecutionInfo, setSwapExecutionInfo] = useState({} as Partial<SwapExecutionInfoJSON>);
    const [tokenJsonMetadata, setTokenJsonMetadata] = useState({} as Partial<JsonMetadata>);
    const [buyAndSellTransactions, setBuyAndSellTransactions] = useState([] as SwapTransaction[]);
    const [tradingHistory, setTradingHistory] = useState(null as TradingHistory | null);

    const refreshSwapExecutionInfo = async () => {
        const direction = tokenAccountData.closed ? 'buy' : 'sell';
        try {
            const { data } = (await axios.get(
                `http://localhost:8000/api/get-mint-${direction}-execution-info/${mint}`,
                {
                    params: { amountToSell: tokenAmount.amount },
                    headers: disableCacheHeaders,
                },
            )) as { data: SwapExecutionInfoJSON };
            setSwapExecutionInfo(data);
        } catch (err: unknown) {
            alert(`Fetching token sell execution info failed with: ${(err as Error).message}`);
        }
    };
    const refreshBuyAndSellTransactions = async () => {
        try {
            const { data } = await axios.get(`http://localhost:8000/api/ata-buynsell-transactions/${mint}/${address}`, {
                headers: disableCacheHeaders,
            });
            setBuyAndSellTransactions(data);
        } catch (err: unknown) {
            console.error(`Fetching buy&sell transactions failed with: ${(err as Error).message}`);
        }
    };
    const sellAll = async () => {
        try {
            const { data } = await axios.post(
                `http://localhost:8000/api/sell-all/${mint}/${address}`,
                {},
                {
                    headers: disableCacheHeaders,
                },
            );
            console.log(data);
        } catch (err: unknown) {
            alert(`Selling failed with: ${(err as Error).message}`);
            return;
        }
        refreshBuyAndSellTransactions();
        //refreshSellExecutionInfo();
    };

    const { symbol, uri, isMutable, updateAuthority, tokenStandard } = tokensAuxiliaryDatas[index]?.metadata ?? {};

    useEffect(() => {
        setSwapExecutionInfo(tokensAuxiliaryDatas[index]?.swapExecutionInfo ?? {});
    }, [tokensAuxiliaryDatas, index]);

    useEffect(() => {
        setBuyAndSellTransactions(tokensAuxiliaryDatas[index]?.buyAndSellTransactions ?? []);
    }, [tokensAuxiliaryDatas, index]);

    useEffect(() => {
        const tokenBalanceChanges = buyAndSellTransactions.map((tx) => Number(tx.balanceChanges[mint] ?? 0));
        const quoteBalanceChanges = buyAndSellTransactions.map((tx) => Number(tx.balanceChanges[WSOL] ?? 0));
        const buyBalanceChanges = zip(tokenBalanceChanges, quoteBalanceChanges).filter(([token]) => token > 0);
        const sellBalanceChanges = zip(tokenBalanceChanges, quoteBalanceChanges).filter(([token]) => token < 0);
        const buyPrices = buyBalanceChanges.map(([token, quote]) => -quote / token);
        const cumTokenHeld = tokenBalanceChanges.reduce(
            (res, balanceChange) => res.concat([res[res.length - 1] + balanceChange]),
            [] as number[],
        );
        const cumAvgPriceBought = zip(cumTokenHeld, buyPrices, buyBalanceChanges).reduce(
            (cumPrices, [held, price, [token]]) =>
                cumPrices.concat([(cumPrices[cumPrices.length - 1] * held + token * price) / (held + token)]),
            [] as number[],
        );

        const tradingHistory: TradingHistory = {
            tokenSold: tokenBalanceChanges
                .filter((balance) => balance < 0)
                .reduce((sum, balance) => sum - balance, 0)
                .toString(),
            quoteBalance: quoteBalanceChanges.reduce((sum, balance) => sum - balance, 0).toString(),
            tokenHeld: tokenBalanceChanges.reduce((sum, balance) => sum + balance, 0).toString(),
            unrealizedReturn: (swapExecutionInfo as SellExecutionInfoJSON).amountOut
                ? Number((swapExecutionInfo as SellExecutionInfoJSON).amountOut).toString()
                : '0',
            realizedPnl: zip(sellBalanceChanges, cumAvgPriceBought)
                .map(([[token, quote], price]) => quote - token * price)
                .reduce((sum, pnl) => sum + pnl, 0)
                .toString(),
            unrealizedPnl: '0',
            minUnrealizedPnl: '0',
            totalInvested: quoteBalanceChanges
                .filter((balance) => balance < 0)
                .reduce((sum, balance) => sum - balance, 0)
                .toString(),
        };
        tradingHistory.unrealizedPnl = (
            Number(tradingHistory.unrealizedReturn) + Number(tradingHistory.quoteBalance)
        ).toString();
        tradingHistory.minUnrealizedPnl = (swapExecutionInfo as SellExecutionInfoJSON).minAmountOut
            ? (
                  Number((swapExecutionInfo as SellExecutionInfoJSON).minAmountOut) +
                  Number(tradingHistory.quoteBalance)
              ).toString()
            : '0';

        setTradingHistory(tradingHistory);
    }, [mint, buyAndSellTransactions, swapExecutionInfo]);

    useEffect(() => {
        if (!uri) return;
        axios
            .get(`http://localhost:8000/proxy/json`, { params: { url: uri } })
            .then(({ data }) => {
                setTokenJsonMetadata(data);
            })
            .catch((err) => {
                console.error(`Fetching digital asset metadata failed with: ${err.message}`);
            });
    }, [uri]);

    return (
        <Card sx={{ maxWidth: 360 }}>
            <CardActionArea>
                <CardContent>
                    <CardMedia component="img" height="280" image={tokenJsonMetadata.image} alt="token logo" />
                    <Typography gutterBottom variant="h5" component="div">
                        <>{symbol}</>
                    </Typography>
                    <>
                        Held amount: {tokenAmount.uiAmountString} {symbol}{' '}
                        {tradingHistory && !tokenAccountData.closed
                            ? `/ ${-tradingHistory.quoteBalance} WSOL currently invested, worth ${tradingHistory.unrealizedReturn} WSOL `
                            : ''}
                        <br />
                        Trading history:
                        <br />
                        Unrealized PnL:
                        <br />
                        {tradingHistory
                            ? `Between ${tradingHistory.minUnrealizedPnl} and ${tradingHistory.unrealizedPnl} WSOL`
                            : 'N/A'}
                        <br />
                        Realized PnL:
                        <br />
                        {tradingHistory ? `${tradingHistory.realizedPnl} WSOL` : 'N/A'}
                        <br />
                        Total invested:
                        <br />
                        {tradingHistory ? `${tradingHistory.totalInvested} WSOL` : 'N/A'}
                        <br />
                        <br />
                        Total amount {symbol} sold:
                        <br />
                        {tradingHistory ? `${tradingHistory.tokenSold} ${symbol}` : 'N/A'}
                        <br />
                        {/* <a */}
                        {/*     href={tradingHistory ? `https://solscan.io/tx/${tradingHistory.signature}` : '#'} */}
                        {/*     target="_blank" */}
                        {/*     rel="noreferrer" */}
                        {/* > */}
                        {/*     View on Solscan */}
                        {/* </a> */}
                        <br />
                        Average buy price:{' '}
                        {tradingHistory
                            ? `${Number(tradingHistory.quoteBalance) / Number(tradingHistory.tokenHeld)} WSOL`
                            : 'N/A'}
                        <br />
                        Price: {swapExecutionInfo.currentPrice ?? 'N/A'}
                        <br />
                    </>
                    {/* <Typography variant="body2" color="text.secondary"> */}
                    {/* <>Mint: {mint}</> */}
                    {/* </Typography> */}
                    {/* <Typography variant="body2" color="text.secondary"> */}
                    {/* <>Associated Token Address (ATA): {address}</> */}
                    {/* </Typography> */}
                </CardContent>
            </CardActionArea>
            <CardActions>
                <table>
                    <tbody>
                        <tr>
                            <td>
                                <Button size="small" color="primary">
                                    <a
                                        className="buttonlink"
                                        href={`https://solscan.io/token/${mint}`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        View Mint on Solscan
                                    </a>
                                </Button>
                            </td>
                            <td>
                                <Button size="small" color="primary">
                                    <a
                                        className="buttonlink"
                                        href={`https://solscan.io/account/${address}`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        View ATA on Solscan
                                    </a>
                                </Button>
                            </td>
                        </tr>
                        <tr>
                            <td colSpan={2}>
                                <Button size="small" color="primary">
                                    <a
                                        className="buttonlink"
                                        href={`https://dexscreener.com/solana/${mint}?maker=${owner}`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        View Mint on DexScreener
                                    </a>
                                </Button>
                            </td>
                        </tr>
                        <tr>
                            <td colSpan={2}>
                                <Button size="small" color="primary" onClick={() => refreshSwapExecutionInfo()}>
                                    Refresh price
                                </Button>
                            </td>
                        </tr>
                        <tr>
                            <td colSpan={2}>
                                <Button size="small" color="primary" onClick={() => refreshBuyAndSellTransactions()}>
                                    Refresh txs
                                </Button>
                            </td>
                        </tr>
                        {!tokenAccountData.closed ? (
                            <tr>
                                <td colSpan={2}>
                                    <Button size="medium" color="primary" onClick={() => sellAll()}>
                                        Sell all tokens and close ATA
                                    </Button>
                                </td>
                            </tr>
                        ) : (
                            <></>
                        )}
                    </tbody>
                </table>
            </CardActions>
        </Card>
    );
}
