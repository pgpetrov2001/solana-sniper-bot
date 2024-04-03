import { Logger } from 'pino';
import { access, constants } from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

export const retrieveEnvVariable = (variableName: string, logger: Logger) => {
  const variable = process.env[variableName] || '';
  if (!variable) {
    logger.error(`${variableName} is not set`);
    process.exit(1);
  }
  return variable;
};

export async function fileExists(filename: string) {
	try {
		await access(filename, constants.F_OK);
		return true;
	} catch (err) {
		return false;
	}
}

export class Mutex {
	queue: ((value?: unknown) => void)[] = [];
	locked: boolean = false;
	constructor() {}

	async lock(callback: (lastInQueue: boolean) => Promise<any>) {
		try {
			if (this.locked) {
				await new Promise(res => this.queue.push(res));
			}

			this.locked = true;

			await callback(this.queue.length == 0);
		} finally {
			const res = this.queue.shift();
			if (res) res();
			else this.locked = false;
		}
	}
}
