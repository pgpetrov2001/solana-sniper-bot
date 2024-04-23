import { Filter, FilterResult } from './pool-filters';
import { TOKEN_PROGRAM_ID, MintLayout, RawMint } from '@solana/spl-token';
import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { logger, Deferred } from '../helpers';

export class RenouncedFreezeFilter implements Filter {
	private poolKeys: LiquidityPoolKeysV4 | null = null;
	private retrieveDeferred = new Deferred();
	private subscription: number | null = null;
	private messageKeywords: string[];

	constructor(
		private readonly connection: Connection,
		private readonly checkRenounced: boolean,
		private readonly checkFreezable: boolean,
	) {
		this.messageKeywords = [...(this.checkRenounced ? ['mint'] : []), ...(this.checkFreezable ? ['freeze'] : [])];
	}

	private resolve(mintData: RawMint): FilterResult {
		const renounced = !this.checkRenounced || mintData.mintAuthorityOption === 0;
		const freezable = !this.checkFreezable || mintData.freezeAuthorityOption !== 0;
		const ok = renounced && !freezable;

		const message = [...(renounced ? ['mint'] : []), ...(!freezable ? ['freeze'] : [])];

		return { ok: ok, message: ok ? undefined : `RenouncedFreeze -> Creator can ${message.join(' and ')} tokens` };
	}

	private reject(error: any, poolKeys: LiquidityPoolKeysV4): FilterResult {
		logger.error(
			{ mint: poolKeys.baseMint },
			`RenouncedFreeze -> Failed to check if creator can ${this.messageKeywords.join(' and ')} tokens`,
		);

		return {
			ok: false,
			message: `RenouncedFreeze -> Failed to check if creator can ${this.messageKeywords.join(' and ')} tokens`,
		};
	}

	async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
		try {
			const accountInfo = await this.connection.getAccountInfo(poolKeys.baseMint, this.connection.commitment);
			if (!accountInfo?.data) {
				return { ok: false, message: 'RenouncedFreeze -> Failed to fetch account data' };
			}
			const mintData = MintLayout.decode(accountInfo.data);

			return this.resolve(mintData);
		} catch (e) {
			return this.reject(e, poolKeys);
		}
	}

	async retrieve(): Promise<FilterResult> {
		try {
			const mintData = await this.recv();
			return this.resolve(mintData);
		} catch (e: any) {
			return this.reject(e, this.poolKeys!);
		}
	}

	listen(poolKeys: LiquidityPoolKeysV4) {
		this.poolKeys = poolKeys;
		this.retrieveDeferred = new Deferred();
		this.subscription = this.connection.onAccountChange(
			poolKeys.baseMint,
			async (updatedAccountInfo) => {
				const mintData = MintLayout.decode(updatedAccountInfo.data);
				this.retrieveDeferred.resolve(mintData);
			},
			this.connection.commitment,
		);
		logger.trace(
			{ mint: poolKeys.baseMint },
			`Listening for changes of ${this.messageKeywords.join(' and ')} of token.`,
		);
	}

	async stop() {
		const subscription = this.subscription!;
		this.subscription = null;
		await this.connection.removeAccountChangeListener(subscription);
		this.retrieveDeferred.reject(
			new Error(
				`Attempted to retrieve update on filter but listener for renounced filter for token with mint ${this.poolKeys!.baseMint} has been stopped`,
			),
		);
		this.poolKeys = null;
	}

	private async recv(): Promise<RawMint> {
		const ret = (await this.retrieveDeferred.promise) as RawMint;
		this.retrieveDeferred = new Deferred();
		return ret;
	}
}
