import { Router } from 'express';
import axios from 'axios';
import { logger } from '../../helpers/index.ts';

const router = Router();

router.get('/json/', async (req, res) => {
	//using query params here instead of post request and body ensures that caching can work
	const { data } = await axios.get(req.query.url as string);
	res.json(data);
});

export default router;
