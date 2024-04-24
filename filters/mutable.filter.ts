import { Filter, FilterResult } from './pool-filters';
import { Connection, PublicKey } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { getPdaMetadataKey } from '@raydium-io/raydium-sdk';
import {
	getMetadataAccountDataSerializer,
	MetadataAccountData,
	MetadataAccountDataArgs,
} from '@metaplex-foundation/mpl-token-metadata';
import { Serializer } from '@metaplex-foundation/umi/serializers';
import { logger, Deferred } from '../helpers';

export class MutableFilter implements Filter {
	private poolKeys: LiquidityPoolKeysV4 | null = null;
	private retrieveDeferred = new Deferred();
	private subscription: number | null = null;

	constructor(
		private readonly connection: Connection,
		private readonly metadataSerializer: Serializer<MetadataAccountDataArgs, MetadataAccountData>,
	) {}

	private resolve(metadataAccountData: MetadataAccountData): FilterResult {
		const mutable = metadataAccountData.isMutable;
		return {
			ok: !mutable,
			message: !mutable ? 'Mutable -> Creator can no longer change metadata' : 'Mutable -> Creator can change metadata',
		};
	}

	private reject(error: any, poolKeys: LiquidityPoolKeysV4): FilterResult {
		return {
			ok: false,
			message: 'Mutable -> Failed to check if metadata are mutable',
			listenerStopped: error.listenerStopped,
		};
	}

	async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
		try {
			const metadataPDA = getPdaMetadataKey(poolKeys.baseMint);
			const metadataAccount = await this.connection.getAccountInfo(metadataPDA.publicKey);
			if (!metadataAccount?.data) {
				return { ok: false, message: 'Mutable -> Failed to fetch account data' };
			}
			const [metadataAccountData] = this.metadataSerializer.deserialize(metadataAccount.data);
			return this.resolve(metadataAccountData);
		} catch (e: any) {
			return this.reject(e, poolKeys);
		}
	}

	async retrieve(): Promise<FilterResult> {
		let metadataAccountData;
		try {
			metadataAccountData = await this.recv();
		} catch (e: any) {
			e.listenerStopped = true;
			return this.reject(e, this.poolKeys!);
		}
		return this.resolve(metadataAccountData);
	}

	listen(poolKeys: LiquidityPoolKeysV4) {
		const { publicKey: metadataPK } = getPdaMetadataKey(poolKeys.baseMint);
		this.poolKeys = poolKeys;
		this.retrieveDeferred = new Deferred();
		this.subscription = this.connection.onAccountChange(
			metadataPK,
			async (updatedAccountInfo) => {
				const [metadataAccountData] = this.metadataSerializer.deserialize(updatedAccountInfo.data);
				this.retrieveDeferred.resolve(metadataAccountData);
			},
			this.connection.commitment,
		);
		logger.trace({ mint: poolKeys.baseMint }, `Listening for changes of metadata mutability.`);
	}

	async stop() {
		const subscription = this.subscription;
		this.subscription = null;
		if (subscription != null) {
			await this.connection.removeAccountChangeListener(subscription);
		}
		this.retrieveDeferred.reject(
			new Error(
				`Attempted to retrieve update on filter but listener for mutable metadata filter for token with mint ${this.poolKeys!.baseMint} has been stopped`,
			),
		);
	}

	private async recv(): Promise<MetadataAccountData> {
		const ret = (await this.retrieveDeferred.promise) as MetadataAccountData;
		this.retrieveDeferred = new Deferred();
		return ret;
	}
}
