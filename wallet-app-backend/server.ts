import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import helmet from 'helmet';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

import 'express-async-errors';

import { logger } from '../helpers/index.ts';
import apiRoute from './routes/api.ts';
import proxyRoute from './routes/proxy.ts';

//Solution to using __dirname in ES modules: https://iamwebwiz.medium.com/how-to-fix-dirname-is-not-defined-in-es-module-scope-34d94a86694d
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

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
