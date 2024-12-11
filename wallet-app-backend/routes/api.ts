import { Router } from 'express';
import { wallet } from '../../load-wallet.ts';
import { logger } from '../../helpers/index.ts';

const router = Router();

router.get('/active-spl-token-accounts', async (req, res) => {
    return res.json(await wallet.getTokenAccounts());
});

router.get('/all-spl-token-accounts', async (req, res) => {
    return res.json(await wallet.getAllTokenAccounts());
});

// TODO: add endpoint for previously closed atas

router.get('/mint-data/:mint', async (req, res) => {
    return res.json(await wallet.getMintData(req.params.mint));
});

router.post('/get-mints-metadatas', async (req, res) => {
    return res.json(await wallet.getMintsMetadata(req.body.mints as string[]));
});

router.post('/get-mints-pools', async (req, res) => {
    return res.json(await wallet.getAndCacheMintsPools(req.body.mints as string[]));
});

router.post('/get-mints-sell-execution-infos', async (req, res) => {
    const mints = req.body.mints as string[];
    const amountsToSell = req.body.amountsToSell as string[];
    if (!mints) return res.status(400).send(`Mints were not specified`);
    if (!amountsToSell) return res.status(400).send(`Amounts to sell were not specified`);
    return res.json(await wallet.getMultipleTokenSellExecutionInfo(mints, amountsToSell));
});

router.post('/get-mints-buy-execution-infos', async (req, res) => {
    const mints = req.body.mints as string[];
    const amountsToBuy = req.body.amountsToBuy as string[];
    if (!mints) return res.status(400).send(`Mints were not specified`);
    if (!amountsToBuy) return res.status(400).send(`Amounts to buy were not specified`);
    return res.json(await wallet.getMultipleTokenBuyExecutionInfo(mints, amountsToBuy));
});

router.post('/get-mints-buynsell-transactions', async (req, res) => {
    const mints = req.body.mints as string[];
    const atas = req.body.atas as string[];
    if (!mints) return res.status(400).send(`Mints were not specified`);
    if (!atas) return res.status(400).send(`ATAs were not specified`);
    return res.json(await wallet.getMultipleAtaBuyAndSellTransactions(mints, atas));
});

router.get('/get-mint-sell-execution-info/:mint', async (req, res) => {
    const amountToSell = req.query.amountToSell as string;
    return res.json(await wallet.getTokenSellExecutionInfo(req.params.mint, amountToSell));
});

router.get('/get-mint-buy-execution-info/:mint', async (req, res) => {
    const amountToBuy = req.query.amountToBuy as string;
    return res.json(await wallet.getTokenBuyExecutionInfo(req.params.mint, amountToBuy));
});

router.get('/ata-buynsell-transactions/:mint/:ata', async (req, res) => {
    const { mint, ata } = req.params;
    const result = await wallet.getAtaBuyAndSellTransactions(mint, ata);
    return res.json(result);
});

router.post('/sell-all/:mint/:ata', async (req, res) => {
    const { mint, ata } = req.params;
    return res.json(await wallet.sellAll(mint, ata));
});

export default router;
