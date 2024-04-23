import { Filter, FilterResult } from './pool-filters';
import { Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, MintLayout, RawMint } from '@solana/spl-token';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { logger, Deferred } from '../helpers';

export class BurnFilter implements Filter {
	private poolKeys: LiquidityPoolKeysV4 | null = null;
	private retrieveDeferred = new Deferred();
	private subscription: number | null = null;

	constructor(private readonly connection: Connection) {}

	private resolve(burned: boolean): FilterResult {
		return { ok: burned, message: burned ? undefined : "Burned -> Creator didn't burn LP" };
	}

	private reject(error: any, poolKeys: LiquidityPoolKeysV4): FilterResult {
		if (error.code == -32602) {
			return { ok: true };
		}

		logger.error({ mint: poolKeys.baseMint }, `Failed to check if LP is burned`);

		return { ok: false, message: 'Failed to check if LP is burned' };
	}

	async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
		try {
			const amount = await this.connection.getTokenSupply(poolKeys.lpMint, this.connection.commitment);
			const burned = amount.value.uiAmount === 0;
			return this.resolve(burned);
		} catch (e: any) {
			return this.reject(e, poolKeys);
		}
	}

	async retrieve(): Promise<FilterResult> {
		try {
			const mintData = await this.recv();
			const burned = mintData.supply === BigInt(0);
			return this.resolve(burned);
		} catch (e: any) {
			return this.reject(e, this.poolKeys!);
		}
	}

	listen(poolKeys: LiquidityPoolKeysV4) {
		this.poolKeys = poolKeys;
		this.retrieveDeferred = new Deferred();
		this.subscription = this.connection.onAccountChange(
			poolKeys.lpMint,
			async (updatedAccountInfo) => {
				const mintData = MintLayout.decode(updatedAccountInfo.data);
				this.retrieveDeferred.resolve(mintData);
			},
			this.connection.commitment,
		);
		logger.trace({ mint: poolKeys.baseMint }, `Listening for changes of supply of LP token with mint ${poolKeys.lpMint}`);
	}

	async stop() {
		const subscription = this.subscription!;
		this.subscription = null;
		await this.connection.removeAccountChangeListener(subscription);
		this.retrieveDeferred.reject(new Error(`Attempted to retrieve update on filter but listener for burn filter for token with mint ${this.poolKeys!.baseMint} has been stopped`));
		this.poolKeys = null;
	}

	private async recv(): Promise<RawMint> {
		const ret = (await this.retrieveDeferred.promise) as RawMint;
		this.retrieveDeferred = new Deferred();
		return ret;
	}
}
