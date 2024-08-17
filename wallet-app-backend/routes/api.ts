import { Router } from 'express';
import { wallet } from '../../load-wallet';
import { logger } from '../../helpers';

const router = Router();

router.get('/spl-token-accounts', async (req, res) => {
	res.json(await wallet.getTokenAccounts());
});

router.get('/mint-data/:mint', async (req, res) => {
	res.json(await wallet.getMintData(req.params.mint));
});

//TODO: using array query parameters for larger lengths (> 200K) of said arrays would result in 400 (Bad Request)

router.get('/mints-metadata', async (req, res) => {
	res.json(await wallet.getMintsMetadata(req.query.mints as string[]));
});

router.post('/cache-mints-pools', async (req, res) => {
	await wallet.getAndCacheMintsPools(req.body.mints);
	res.status(200).send();
});

router.get('/spl-token-sell-execution-info/:mint', async (req, res) => {
	const amountToSell = req.query.amountToSell as string;
	res.json(await wallet.getTokenSellExecutionInfo(req.params.mint, amountToSell));
});

router.get('/ata-buynsell-transactions/:mint/:ata', async (req, res) => {
	const { mint, ata } = req.params;
	const result = await wallet.getAtaBuyAndSellTransactions(mint, ata);
	res.json(result);
});

export default router;
