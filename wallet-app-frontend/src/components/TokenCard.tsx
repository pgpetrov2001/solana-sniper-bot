import { useState, useEffect } from 'react';
import React from 'react';
import axios from 'axios';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardMedia from '@mui/material/CardMedia';
import Typography from '@mui/material/Typography';
import { Button, CardActionArea, CardActions } from '@mui/material';

import { PublicKey } from '@solana/web3.js';
import { MetadataAccountData, JsonMetadata } from '@metaplex-foundation/mpl-token-metadata';

import { MintAccount, TokenAccount, SwapExecutionInfoJSON } from '../../../wallet';

const disableCacheHeaders = {
	'Cache-Control': 'no-cache',
	'Pragma': 'no-cache',
	'Expires': '0',
};

type SwapTransaction = {
	signature: string,
	balanceChanges: { [key: string]: string },
};

export default function TokenCard({ tokenMetadata, mintMetadata }: { tokenMetadata: Partial<MetadataAccountData>, mintMetadata: TokenAccount }) {
	const { mint, address, owner, tokenAmount } = mintMetadata;
	const { symbol, uri, isMutable, updateAuthority, tokenStandard } = tokenMetadata;

	const [ sellExecutionInfo, setSellExecutionInfo ] = useState({} as Partial<SwapExecutionInfoJSON>);
	const [ tokenJsonMetadata, setTokenJsonMetadata ] = useState({} as Partial<JsonMetadata>);
	const [ buyAndSellTransactions, setBuyAndSellTransactions ] = useState([] as SwapTransaction[]);
	const [ buyTransaction, setBuyTransaction ] = useState(null as SwapTransaction|null);

	const refreshPrice = async () => {
		try {
			const { data } = await axios.get(
				`http://localhost:8000/api/spl-token-sell-execution-info/${mint}`,
				{
					params: { amountToSell: tokenAmount.amount },
					headers: disableCacheHeaders,
				},
			) as { data: SwapExecutionInfoJSON };
			setSellExecutionInfo(data);
		} catch(err: any) {
			alert(`Fetching token sell execution info failed with: ${err.message}`);
		}
	};
	const refreshBuyAndSellTransactions = async () => {
		try {
			const { data } = await axios.get(
				`http://localhost:8000/api/ata-buynsell-transactions/${mint}/${address}`,
				{ headers: disableCacheHeaders }
			);
			setBuyAndSellTransactions(data);
		} catch(err: any) {
			console.error(`Fetching buy&sell transactions failed with: ${err.message}`);
		}
	};
	const sellAll = async () => {};

	useEffect(() => {
		refreshBuyAndSellTransactions();
	}, [mint, address]);

	useEffect(() => {
		setBuyTransaction(
			buyAndSellTransactions.find((tx) => Number(tx.balanceChanges[mint.toString()] ?? 0) > 0) ?? null
		);
	}, [mint, buyAndSellTransactions])

	useEffect(() => {
		if (!uri) return;
		axios.get(`http://localhost:8000/proxy/json`, { params: { url: uri } }).then(({ data }) => {
			setTokenJsonMetadata(data);
		}).catch((err) => {
			console.error(`Fetching digital asset metadata failed with: ${err.message}`);
		});
	}, [uri]);

  return (
    <Card sx={{ maxWidth: 360 }}>
      <CardActionArea>
        <CardContent>
		<CardMedia
          component="img"
          height="280"
          image={tokenJsonMetadata.image}
          alt="token logo"
        />
          <Typography gutterBottom variant="h5" component="div">
			  <>{symbol}</>
		  </Typography>
			<>
				Held amount: {tokenAmount.uiAmountString}
				<br/>
				Buy transaction:<br/>
				{buyTransaction? `${buyTransaction.balanceChanges[mint.toString()]} ${symbol}` : 'N/A'}<br/>
				{buyTransaction? `${buyTransaction.balanceChanges['So11111111111111111111111111111111111111112']} WSOL` : 'N/A'}<br/>
				<a href={buyTransaction? `https://solscan.io/tx/${buyTransaction.signature}` : 'N/A'} target="_blank" rel="noreferrer">View on Solscan</a><br/>
				Price: {sellExecutionInfo.currentPrice ?? 'N/A'}<br/>
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
					  <td><Button size="small" color="primary"><a className="buttonlink" href={`https://solscan.io/token/${mint}`} target="_blank" rel="noreferrer">View Mint on Solscan</a></Button></td>
					  <td><Button size="small" color="primary"><a className="buttonlink" href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer">View ATA on Solscan</a></Button></td>
				  </tr>
				  <tr>
					  <td colSpan={2}><Button size="small" color="primary"><a className="buttonlink" href={`https://dexscreener.com/solana/${mint}?maker=${owner}`} target="_blank" rel="noreferrer">View Mint on DexScreener</a></Button></td>
				  </tr>
				  <tr>
					  <td colSpan={2}><Button size="small" color="primary" onClick={() => refreshPrice()}>Refresh price</Button></td>
				  </tr>
				  <tr>
					  <td colSpan={2}><Button size="small" color="primary" onClick={() => refreshBuyAndSellTransactions()}>Refresh txs</Button></td>
				  </tr>
				  <tr>
					  <td colSpan={2}><Button size="medium" color="primary" onClick={() => sellAll()}>Sell all tokens and close ATA</Button></td>
				  </tr>
			  </tbody>
		  </table>
      </CardActions>
    </Card>
  );
}
