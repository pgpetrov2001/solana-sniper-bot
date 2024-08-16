import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'path';
import helmet from 'helmet';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

import 'express-async-errors';

import { logger } from '../helpers';
import apiRoute from './routes/api';
import proxyRoute from './routes/proxy';

const app = express();

// Basic middleware
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// Show routes called in console during development
if (process.env.NODE_ENVIRONMENT !== 'test') {
	app.use(morgan('dev'));
}

// Security
if (process.env.NODE_ENVIRONMENT === 'production') {
	app.use(helmet());
}

// Set views directory (html)
const viewsDir = path.join(__dirname, 'views');
app.set('views', viewsDir);

// Set static directory (js and css).
const staticDir = path.join(__dirname, 'public');
app.use(express.static(staticDir));

app.use('/api/', apiRoute);
app.use('/proxy/', proxyRoute);

app.listen(process.env.WALLET_SERVER_PORT, () => {
	logger.info(`Server started on port ${process.env.WALLET_SERVER_PORT}`);
});

export default app;
