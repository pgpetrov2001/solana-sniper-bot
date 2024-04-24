import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';
import { BurnFilter } from './burn.filter';
import { MutableFilter } from './mutable.filter';
import { RenouncedFreezeFilter } from './renounced.filter';
import { PoolSizeFilter } from './pool-size.filter';
import { CHECK_IF_BURNED, CHECK_IF_FREEZABLE, CHECK_IF_MINT_IS_RENOUNCED, CHECK_IF_MUTABLE, logger } from '../helpers';

export interface Filter {
	execute(poolKeysV4: LiquidityPoolKeysV4): Promise<FilterResult>;
	listen(poolKeys: LiquidityPoolKeysV4): void;
	stop(): Promise<void>;
	retrieve(): Promise<FilterResult>;
}

export interface FilterResult {
	ok: boolean;
	message?: string;
	listenerStopped?: boolean;
}

export interface PoolFilterArgs {
	minPoolSize: TokenAmount;
	maxPoolSize: TokenAmount;
	quoteToken: Token;
}

export class PoolFilters {
	private filters: Filter[] = [];
	private poolKeys: LiquidityPoolKeysV4 | null = null;

	constructor(
		readonly connection: Connection,
		readonly args: PoolFilterArgs,
	) {
		if (CHECK_IF_BURNED) {
			this.filters.push(new BurnFilter(connection));
		}

		if (CHECK_IF_MINT_IS_RENOUNCED || CHECK_IF_FREEZABLE) {
			this.filters.push(new RenouncedFreezeFilter(connection, CHECK_IF_MINT_IS_RENOUNCED, CHECK_IF_FREEZABLE));
		}

		if (CHECK_IF_MUTABLE) {
			this.filters.push(new MutableFilter(connection, getMetadataAccountDataSerializer()));
		}

		if (!args.minPoolSize.isZero() || !args.maxPoolSize.isZero()) {
			this.filters.push(new PoolSizeFilter(connection, args.quoteToken, args.minPoolSize, args.maxPoolSize));
		}
	}

	public async execute(poolKeys: LiquidityPoolKeysV4): Promise<boolean> {
		if (this.filters.length === 0) {
			return true;
		}

		const result = await Promise.all(this.filters.map((f) => f.execute(poolKeys)));
		const passed = result.map((r) => r.ok);
		this.filters = this.filters.filter((f, i) => !passed[i]);
		const pass = passed.every((p) => p);

		if (pass) {
			return true;
		}

		for (const filterResult of result) {
			logger.trace({ mint: poolKeys.baseMint }, filterResult.message);
		}
		logger.trace(`Filters remaining: ${this.filters.length}`);

		return false;
	}

	async retrieve(): Promise<{ pass: boolean, continueListening: boolean }> {
		let retire = false;
		const { result, index } = await Promise.any(
			this.filters.map(async (f, i) => {
				const filterResult = await f.retrieve();
				if (filterResult.listenerStopped) {
					retire = true;
				}
				return { result: filterResult, index: i };
			}),
		);
		if (retire) {
			return { pass: false, continueListening: false };
		}
		if (result.ok) {
			this.filters.splice(index, 1);
		}
		logger.trace({ mint: this.poolKeys!.baseMint }, result.message);
		const pass = this.filters.length === 0;
		logger.trace(`Filters remaining: ${this.filters.length}`);
		return { pass, continueListening: !pass };
	}

	public listen(poolKeys: LiquidityPoolKeysV4) {
		this.poolKeys = poolKeys;
		for (const filter of this.filters) {
			filter.listen(poolKeys);
		}
	}

	public async stop() {
		for (const filter of this.filters) {
			await filter.stop();
		}
		this.poolKeys = null;
	}
}
