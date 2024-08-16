import { useState, useEffect } from 'react';
import axios from 'axios';
import { Grid } from '@material-ui/core';

import TokenCard from './components/TokenCard';
import './App.css';

import { MetadataAccountData } from '@metaplex-foundation/mpl-token-metadata';
import { TokenAccount } from '../../wallet';

function App() {
	const [ tokens, setTokens ] = useState([] as TokenAccount[]);
	const [ metadatas, setMetadatas ] = useState([] as Partial<MetadataAccountData>[]);
	useEffect(() => {
		axios.get('http://localhost:8000/api/spl-token-accounts').then(async ({ data }: { data: TokenAccount[] }) => {
			const mints = data.map(({ mint }) => mint);
			const { data: metadatasValues } = await axios.get(
				`http://localhost:8000/api/mints-metadata`,
				{ params: { mints } }
			);
			setMetadatas(metadatasValues);
			setTokens(data);
		});
	}, []);
	const tokenCards = tokens.map((tokenAccount: TokenAccount, i: number) =>
		<Grid item xs={3}>
			<TokenCard
				tokenMetadata={metadatas[i]}
				mintMetadata={tokenAccount}
			/>
		</Grid>
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
