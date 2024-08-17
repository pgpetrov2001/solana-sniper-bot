import fs from 'fs';
import { logger, SNIPE_LIST_REFRESH_INTERVAL } from '../helpers/index.ts';

//Solution to using __dirname in ES modules: https://iamwebwiz.medium.com/how-to-fix-dirname-is-not-defined-in-es-module-scope-34d94a86694d
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

export class SnipeListCache {
	private snipeList: string[] = [];
	private fileLocation = path.join(__dirname, '../snipe-list.txt');

	constructor() {
		setInterval(() => this.loadSnipeList(), SNIPE_LIST_REFRESH_INTERVAL);
	}

	public init() {
		this.loadSnipeList();
	}

	public isInList(mint: string) {
		return this.snipeList.includes(mint);
	}

	private loadSnipeList() {
		logger.trace(`Refreshing snipe list...`);

		const count = this.snipeList.length;
		const data = fs.readFileSync(this.fileLocation, 'utf-8');
		this.snipeList = data
			.split('\n')
			.map((a) => a.trim())
			.filter((a) => a);

		if (this.snipeList.length != count) {
			logger.info(`Loaded snipe list: ${this.snipeList.length}`);
		}
	}
}
