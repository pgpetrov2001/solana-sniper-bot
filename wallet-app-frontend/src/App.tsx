import { createContext, useState, useEffect, Dispatch, SetStateAction } from 'react';
import axios from 'axios';
import { Grid } from '@material-ui/core';

import TokenCard from './components/TokenCard';
import './App.css';

import { MetadataAccountData } from '@metaplex-foundation/mpl-token-metadata';
import { TokenAccount, SwapExecutionInfoJSON, TransformedTransaction } from '../../wallet';
import { range, zip } from '../../helpers/common';

type TokenAuxiliaryData = {
	metadata: MetadataAccountData;
	sellExecutionInfo: SwapExecutionInfoJSON;
	buyAndSellTransactions: TransformedTransaction[];
};

export const TokensAuxiliaryDataContext = createContext([
	[] as TokenAuxiliaryData[],
	(() => {}) as Dispatch<SetStateAction<TokenAuxiliaryData[]>>
] as [
	TokenAuxiliaryData[],
	Dispatch<SetStateAction<TokenAuxiliaryData[]>>
]);

const WSOL = 'So11111111111111111111111111111111111111112';

function App() {
	const [ tokens, setTokens ] = useState([] as TokenAccount[]);
	const [ tokensAuxiliaryDatas, setTokensAuxiliaryDatas ] = useState([] as TokenAuxiliaryData[]);

	const fetchTokensAuxiliaryDatas = async () => {
		if (!tokens.length) return;
		const mints = tokens.map(({ mint }) => mint);
		const atas = tokens.map(({ address }) => address);
		const { data: buyAndSellTransactions } = await axios.get(
			`http://localhost:8000/api/get-mints-buynsell-transactions`,
			{ params: { mints, atas } }
		);
		const { data: metadatas } = await axios.get(
			`http://localhost:8000/api/get-mints-metadatas`,
			{ params: { mints } }
		);
		// const [{ data: buyAndSellTransactions }, { data: metadatas }] = await Promise.all(zip([
		// 	axios.get(
		// 		`http://localhost:8000/api/get-mints-buynsell-transactions`,
		// 		{ params: { mints, atas } }
		// 	).then((asd) => {
		// 		console.log(asd);
		// 		return asd;
		// 	}),
		// 	axios.get(
		// 		`http://localhost:8000/api/get-mints-metadatas`,
		// 		{ params: { mints } }
		// 	).then((asd) => {
		// 		console.log(asd);
		// 		return asd;
		// 	})
		// ], ['sell transaction execution infos', 'metadatas']).map(([ promise, resourceName ]) => promise.catch((err) => {
		// 	alert(`Error getting ${resourceName} of tokens on server: ${err}`);
		// 	return { data: [] };
		// })));
		const totalBalances = zip(
			buyAndSellTransactions as TransformedTransaction[][],
			mints as string[],
		).map(([ txs, mint ]) => {
			const uiBalance = txs
				.map((tx) => Number(tx.balanceChanges[mint] ?? 0))
				.filter((balance) => balance > 0)
				.reduce((sum: number, balance: number) => sum + balance, 0);
			const rawBalance = txs
				.map((tx) => BigInt(tx.bigintBalanceChanges[mint] ?? 0))
				.filter((balance) => balance > 0)
				.reduce((sum: bigint, balance: bigint) => sum + balance, 0n);
			return { uiBalance, rawBalance };
		});
		const WSOL_Index = mints.indexOf(WSOL);
		const mintsWithoutWSOL = mints.filter((_, i) => i !== WSOL_Index);
		const amountsToSell = totalBalances.filter((_, i) => i !== WSOL_Index).map(({ rawBalance }) => rawBalance.toString());
		const { data: sellExecutionInfos } = await axios.get(
			`http://localhost:8000/api/get-mints-sell-execution-infos`,
			{ params: { mints: mintsWithoutWSOL, amountsToSell } }
		);
		setTokensAuxiliaryDatas(zip(
			buyAndSellTransactions as TransformedTransaction[][],
			metadatas as MetadataAccountData[],
			sellExecutionInfos as SwapExecutionInfoJSON[],
		).map(
			([ buyAndSellTransactions, metadata, sellExecutionInfo ]) => ({ buyAndSellTransactions, metadata, sellExecutionInfo })
		));
	};

	useEffect(() => {
		axios.get('http://localhost:8000/api/spl-token-accounts').then(({ data }: { data: TokenAccount[] }) => {
			setTokens(data.filter(({ mint }) => ![WSOL].includes(mint.toString())));
		});
	}, []);
	useEffect(() => {
		fetchTokensAuxiliaryDatas();
	}, [tokens]);

	const tokenCards = tokens.map((tokenAccount: TokenAccount, i: number) =>
		<TokensAuxiliaryDataContext.Provider value={[ tokensAuxiliaryDatas, setTokensAuxiliaryDatas ]}>
			<Grid item xs={3}>
				<TokenCard
					index={i}
					tokenAccountData={tokenAccount}
				/>
			</Grid>
		</TokensAuxiliaryDataContext.Provider>
	);
  return (
    <div className="App">
      <header className="App-header">
      </header>
		<main>
			<Grid
				container
				spacing={1}
				direction="row"
				justify="center"
				alignItems="center">
				{tokenCards}
			</Grid>
		</main>
    </div>
  );
}

export default App;
