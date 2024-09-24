import { Router } from 'express';
import { wallet } from '../../load-wallet.ts';
import { logger } from '../../helpers/index.ts';

const router = Router();

router.get('/spl-token-accounts', async (req, res) => {
    res.json(await wallet.getTokenAccounts());
});

router.get('/mint-data/:mint', async (req, res) => {
    res.json(await wallet.getMintData(req.params.mint));
});

//TODO: using array query parameters for larger lengths (> 200K) of said arrays would result in 400 (Bad Request)

router.get('/get-mints-metadatas', async (req, res) => {
    res.json(await wallet.getMintsMetadata(req.query.mints as string[]));
});

router.get('/get-mints-pools', async (req, res) => {
    res.json(await wallet.getAndCacheMintsPools(req.query.mints as string[]));
});

router.get('/get-mints-sell-execution-infos', async (req, res) => {
    const mints = req.query.mints as string[];
    const amountsToSell = req.query.amountsToSell as string[];
    if (!mints) return res.status(400).send(`Mints were not specified`);
    if (!amountsToSell) return res.status(400).send(`Amounts to sell were not specified`);
    res.json(await wallet.getMultipleTokenSellExecutionInfo(mints, amountsToSell));
});

router.get('/get-mints-buynsell-transactions', async (req, res) => {
    const mints = req.query.mints as string[];
    const atas = req.query.atas as string[];
    if (!mints) return res.status(400).send(`Mints were not specified`);
    if (!atas) return res.status(400).send(`ATAs were not specified`);
    res.json(await wallet.getMultipleAtaBuyAndSellTransactions(mints, atas));
});

router.get('/get-mint-sell-execution-info/:mint', async (req, res) => {
    const amountToSell = req.query.amountToSell as string;
    res.json(await wallet.getTokenSellExecutionInfo(req.params.mint, amountToSell));
});

router.get('/ata-buynsell-transactions/:mint/:ata', async (req, res) => {
    const { mint, ata } = req.params;
    const result = await wallet.getAtaBuyAndSellTransactions(mint, ata);
    res.json(result);
});

export default router;
