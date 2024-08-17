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

router.get('/mints-metadata', async (req, res) => {
	res.json(await wallet.getMintsMetadata(req.query.mints as string[]));
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
