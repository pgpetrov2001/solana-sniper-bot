import { createContext, useState, useEffect, Dispatch, SetStateAction } from 'react';
import axios from 'axios';
import { Grid } from '@material-ui/core';

import TokenCard from './components/TokenCard';
import './App.css';

import { MetadataAccountData } from '@metaplex-foundation/mpl-token-metadata';
import { SwapExecutionInfoJSON } from '../../wallet';
import { TokenAccount, TransformedTransaction } from '../../helpers/blockchain-operations';
import { zip } from '../../helpers/common';

type TokenAuxiliaryData = {
    metadata: MetadataAccountData;
    swapExecutionInfo: SwapExecutionInfoJSON;
    buyAndSellTransactions: TransformedTransaction[];
};

export const TokensAuxiliaryDataContext = createContext([
    [] as TokenAuxiliaryData[],
    (() => {}) as Dispatch<SetStateAction<TokenAuxiliaryData[]>>,
] as [TokenAuxiliaryData[], Dispatch<SetStateAction<TokenAuxiliaryData[]>>]);

const WSOL = 'So11111111111111111111111111111111111111112';

function App() {
    const [tokens, setTokens] = useState([] as TokenAccount[]);
    const [tokensAuxiliaryDatas, setTokensAuxiliaryDatas] = useState([] as TokenAuxiliaryData[]);

    const fetchTokensAuxiliaryDatas = async () => {
        if (!tokens.length) return;
        const mints = tokens.map(({ mint }) => mint);
        const atas = tokens.map(({ address }) => address);
        const { data: buyAndSellTransactions } = await axios.post(
            `http://localhost:8000/api/get-mints-buynsell-transactions`,
            { mints, atas },
        );
        const { data: metadatas } = await axios.post(`http://localhost:8000/api/get-mints-metadatas`, { mints });
        // I think below code didn't work for some reason, even though it is faster
        // const [{ data: buyAndSellTransactions }, { data: metadatas }] = await Promise.all(zip([
        // 	axios.get(
        // 		`http://localhost:8000/api/get-mints-buynsell-transactions`,
        // 		{ mints, atas },
        // 	).then((asd) => {
        // 		console.log(asd);
        // 		return asd;
        // 	}),
        // 	axios.post(
        // 		`http://localhost:8000/api/get-mints-metadatas`, { mints }
        // 	).then((asd) => {
        // 		console.log(asd);
        // 		return asd;
        // 	})
        // ], ['sell transaction execution infos', 'metadatas']).map(([ promise, resourceName ]) => promise.catch((err) => {
        // 	alert(`Error getting ${resourceName} of openTokens on server: ${err}`);
        // 	return { data: [] };
        // })));
        const totalBalances = zip(buyAndSellTransactions as TransformedTransaction[][], mints as string[]).map(
            ([txs, mint]) => {
                const uiBalance = txs
                    .map((tx) => Number(tx.balanceChanges[mint] ?? 0))
                    .filter((balance) => balance > 0)
                    .reduce((sum: number, balance: number) => sum + balance, 0);
                const rawBalance = txs
                    .map((tx) => BigInt(tx.bigintBalanceChanges[mint] ?? 0))
                    .filter((balance) => balance > 0)
                    .reduce((sum: bigint, balance: bigint) => sum + balance, 0n);
                return { uiBalance, rawBalance };
            },
        );
        type Balance = { uiBalance: number; rawBalance: bigint };

        const WSOL_Index = mints.indexOf(WSOL);

        const openTokensWithBalances = zip(tokens, totalBalances)
            .map(([token, balance], idx) => [token, balance, idx] as [TokenAccount, Balance, number])
            .filter(([token, _, idx]) => !token.closed && idx !== WSOL_Index);
        const openTokensMints = openTokensWithBalances.map(([{ mint }]) => mint);
        const openTokensBalances = openTokensWithBalances.map(([, { rawBalance }]) => rawBalance.toString());
        const openTokensIdxs = openTokensWithBalances.map(([, , idx]) => idx);
        const { data: sellExecutionInfos } = await axios.post(
            `http://localhost:8000/api/get-mints-sell-execution-infos`,
            { mints: openTokensMints, amountsToSell: openTokensBalances },
        );

        const closedTokensWithBalances = zip(tokens, totalBalances)
            .map(([token, balance], idx) => [token, balance, idx] as [TokenAccount, Balance, number])
            .filter(([token, _, idx]) => token.closed && idx !== WSOL_Index);
        const closedTokensMints = closedTokensWithBalances.map(([{ mint }]) => mint);
        const closedTokensBalances = closedTokensWithBalances.map(([, { rawBalance }]) => rawBalance.toString());
        const closedTokensIdxs = closedTokensWithBalances.map(([, , idx]) => idx);
        const { data: buyExecutionInfos } = await axios.post(
            `http://localhost:8000/api/get-mints-buy-execution-infos`,
            { mints: closedTokensMints, amountsToBuy: closedTokensBalances },
        );
        // setTokensAuxiliaryDatas(
        //     zip(
        //         buyAndSellTransactions as TransformedTransaction[][],
        //         metadatas as MetadataAccountData[],
        //         sellExecutionInfos as SwapExecutionInfoJSON[],
        //     ).map(([buyAndSellTransactions, metadata, sellExecutionInfo]) => ({
        //         buyAndSellTransactions,
        //         metadata,
        //         sellExecutionInfo,
        //     })),
        // );
        setTokensAuxiliaryDatas(
            zip(openTokensIdxs, sellExecutionInfos)
                .map(([idx, sellExecutionInfo]) => ({
                    buyAndSellTransactions: buyAndSellTransactions[idx] as TransformedTransaction[],
                    metadata: metadatas[idx] as MetadataAccountData,
                    swapExecutionInfo: sellExecutionInfo as SwapExecutionInfoJSON,
                }))
                .concat(
                    zip(closedTokensIdxs, buyExecutionInfos).map(([idx, buyExecutionInfo]) => ({
                        buyAndSellTransactions: buyAndSellTransactions[idx] as TransformedTransaction[],
                        metadata: metadatas[idx] as MetadataAccountData,
                        swapExecutionInfo: buyExecutionInfo as SwapExecutionInfoJSON,
                    })),
                ),
        );
    };

    useEffect(() => {
        axios.get('http://localhost:8000/api/all-spl-token-accounts').then(({ data }: { data: TokenAccount[] }) => {
            setTokens(data.filter(({ mint }) => ![WSOL].includes(mint.toString())));
        });
    }, []);
    useEffect(() => {
        fetchTokensAuxiliaryDatas();
    }, [tokens]);

    const tokenCards = tokens.map((tokenAccount: TokenAccount, i: number) => (
        <TokensAuxiliaryDataContext.Provider value={[tokensAuxiliaryDatas, setTokensAuxiliaryDatas]}>
            <Grid item xs={3}>
                <TokenCard index={i} tokenAccountData={tokenAccount} />
            </Grid>
        </TokensAuxiliaryDataContext.Provider>
    ));
    return (
        <div className="App">
            <header className="App-header"></header>
            <main>
                <Grid container spacing={1} direction="row" justify="center" alignItems="center">
                    {tokenCards}
                </Grid>
            </main>
        </div>
    );
}

export default App;
