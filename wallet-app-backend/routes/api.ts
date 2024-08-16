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

router.get('/spl-token-price/:mint', async (req, res) => {
	res.json({ price: await wallet.getTokenPrice(req.params.mint) });
});

router.get('/ata-buynsell-transactions/:mint/:ata', async (req, res) => {
	const { mint, ata } = req.params;
	const result = await wallet.getAtaBuyAndSellTransactions(mint, ata);
	res.json(result);
});

export default router;
