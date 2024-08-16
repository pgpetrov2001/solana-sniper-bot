import { createClient } from 'redis';
import { logger } from './helpers';

export const redisClient = createClient({
	socket: { 
		host: 'localhost',
		port: 6379,
	},
});

redisClient.on('error', (err: any) => {
	logger.error(`Redis error: ${err}`);
});

redisClient.connect();
