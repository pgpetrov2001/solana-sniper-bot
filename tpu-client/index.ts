import {
	Commitment,
	ConfirmOptions,
	Connection,
	ConnectionConfig,
	PublicKey,
	Signer,
	Transaction,
	TransactionSignature,
	SendOptions,
	VersionedTransaction,
} from '@solana/web3.js';
import { default as Denque } from 'denque';
import dgram from 'dgram';
import bs58 from 'bs58';

export class LeaderTpuCache {
	leaderTpuMap!: Map<string, string | null>;
	connection: Connection;
	first_slot: number;
	slots_in_epoch!: number;
	last_epoch_info_slot!: number;
	leaders!: Array<PublicKey>;
	private constructor(connection: Connection, startSlot: number) {
		this.connection = connection;
		this.first_slot = startSlot;
	}
	static load(connection: Connection, startSlot: number): Promise<LeaderTpuCache> {
		return new Promise((resolve) => {
			const leaderTpuCache = new LeaderTpuCache(connection, startSlot);
			leaderTpuCache.connection.getEpochInfo().then((epochInfo) => {
				leaderTpuCache.slots_in_epoch = epochInfo.slotsInEpoch;
				leaderTpuCache.fetchSlotLeaders(leaderTpuCache.first_slot, leaderTpuCache.slots_in_epoch).then((leaders) => {
					leaderTpuCache.leaders = leaders;
					leaderTpuCache.fetchClusterTpuSockets().then((leaderTpuMap) => {
						leaderTpuCache.leaderTpuMap = leaderTpuMap;
						resolve(leaderTpuCache);
					});
				});
			});
		});
	}
	fetchClusterTpuSockets(): Promise<Map<string, string | null>> {
		return new Promise((resolve, reject) => {
			const map = new Map<string, string | null>();
			this.connection
				.getClusterNodes()
				.then((contactInfo) => {
					contactInfo.forEach((contactInfo) => {
						map.set(contactInfo.pubkey, contactInfo.tpu);
					});
					resolve(map);
				})
				.catch((error) => {
					reject(error);
				});
		});
	}
	fetchSlotLeaders(start_slot: number, slots_in_epoch: number): Promise<Array<PublicKey>> {
		const fanout = Math.min(2 * MAX_FANOUT_SLOTS, slots_in_epoch);
		return this.connection.getSlotLeaders(start_slot, fanout);
	}
	lastSlot(): number {
		return this.first_slot + this.leaders.length - 1;
	}
	getSlotLeader(slot: number): PublicKey | null {
		if (slot >= this.first_slot) {
			const index = slot - this.first_slot;
			return this.leaders[index];
		} else {
			return null;
		}
	}
	getLeaderSockets(fanout_slots: number): Promise<Array<string>> {
		return new Promise((resolve) => {
			const leaderSet = new Set<string>();
			const leaderSockets = new Array<string>();
			let checkedSlots = 0;
			this.leaders.forEach((leader) => {
				const tpu_socket = this.leaderTpuMap.get(leader.toBase58());
				if (tpu_socket !== undefined && tpu_socket !== null) {
					if (!leaderSet.has(leader.toBase58())) {
						leaderSet.add(leader.toBase58());
						leaderSockets.push(tpu_socket);
					}
				} else {
					console.log('TPU not available for leader: ', leader.toBase58());
				}
				checkedSlots++;
				if (checkedSlots === fanout_slots) {
					resolve(leaderSockets);
				}
			});
		});
	}
}

export const MAX_SLOT_SKIP_DISTANCE = 48;
export const DEFAULT_FANOUT_SLOTS = 12;
export const MAX_FANOUT_SLOTS = 100;

export class RecentLeaderSlots {
	recent_slots: Denque;

	//@ts-check
	/**
	 *
	 * @param current_slot {number}
	 */
	constructor(current_slot: number) {
		this.recent_slots = new Denque();
		this.recent_slots.push(current_slot);
	}

	//@ts-check
	/**
	 *
	 * @param current_slot {number}
	 */
	recordSlot(current_slot: number) {
		this.recent_slots.push(current_slot);
		while (this.recent_slots.length > 12) {
			this.recent_slots.pop();
		}
	}

	//@ts-check
	/**
	 *
	 * @returns {number}
	 */
	estimatedCurrentSlot(): number {
		if (this.recent_slots.isEmpty()) {
			throw new Error('recent slots is empty');
		}
		const sortedRecentSlots = this.recent_slots.toArray().sort((a, b) => a - b);
		const max_index = sortedRecentSlots.length - 1;
		const median_index = max_index / 2;
		const median_recent_slot = sortedRecentSlots[median_index];
		const expected_current_slot = median_recent_slot + (max_index - median_index);
		const max_reasonable_current_slot = expected_current_slot + MAX_SLOT_SKIP_DISTANCE;
		return sortedRecentSlots.reverse().find((slot) => slot <= max_reasonable_current_slot);
	}
}

export interface TpuClientConfig {
	fanoutSlots: number;
}

export class TpuClient {
	sendSocket: dgram.Socket;
	fanoutSlots: number;
	leaderTpuService!: LeaderTpuService;
	exit: boolean;
	connection: Connection;

	//@ts-check
	/**
	 *
	 * @param connection {Connection}
	 * @param config {TpuClientConfig}
	 */
	private constructor(connection: Connection, config: TpuClientConfig = { fanoutSlots: DEFAULT_FANOUT_SLOTS }) {
		this.connection = connection;
		this.exit = false;
		this.sendSocket = dgram.createSocket('udp4');
		this.fanoutSlots = Math.max(Math.min(config.fanoutSlots, MAX_FANOUT_SLOTS), 1);
		console.log('started tpu client');
	}

	//@ts-check
	/**
	 *
	 * @param connection {Connection}
	 * @param websocketUrl {string}
	 * @param config {TpuClientConfig}
	 * @returns {Promise<TpuClient>}
	 */
	static load(
		connection: Connection,
		websocketUrl = '',
		config: TpuClientConfig = { fanoutSlots: DEFAULT_FANOUT_SLOTS },
	): Promise<TpuClient> {
		return new Promise((resolve) => {
			const tpuClient = new TpuClient(connection, config);
			LeaderTpuService.load(tpuClient.connection, websocketUrl).then((leaderTpuService) => {
				tpuClient.leaderTpuService = leaderTpuService;
				resolve(tpuClient);
			});
		});
	}

	//@ts-check
	/**
	 *
	 * @param transaction {Transaction}
	 * @param signers {Array<Signer>}
	 * @returns {Promise<string>}
	 */
	async sendTransaction(
		transaction: VersionedTransaction | Transaction,
		signersOrOptions?: Array<Signer> | SendOptions,
		options?: SendOptions,
	): Promise<TransactionSignature> {
		if ('version' in transaction) {
			if (signersOrOptions && Array.isArray(signersOrOptions)) {
				throw new Error('Invalid arguments');
			}

			const wireTransaction = transaction.serialize();
			return await this.sendRawTransaction(wireTransaction);
		}

		if (signersOrOptions === undefined || !Array.isArray(signersOrOptions)) {
			throw new Error('Invalid arguments');
		}

		const signers = signersOrOptions;

		if (transaction.nonceInfo) {
			transaction.sign(...signers);
		} else {
			transaction.recentBlockhash = (await this.connection.getRecentBlockhash()).blockhash;
			transaction.sign(...signers);
		}
		const rawTransaction = transaction.serialize();
		return this.sendRawTransaction(rawTransaction);
	}

	//@ts-check
	/**
	 *
	 * @param rawTransaction {Buffer | number[] | Uint8ARray}
	 * @returns {Promise<string>}
	 */
	async sendRawTransaction(rawTransaction: Buffer | number[] | Uint8Array): Promise<string> {
		return new Promise((resolve, reject) => {
			this.leaderTpuService.leaderTpuSockets(this.fanoutSlots).then((tpu_addresses) => {
				tpu_addresses.forEach((tpu_address) => {
					console.log(`sending to tpu address ${tpu_address}`);
					this.sendSocket.send(
						rawTransaction,
						parseInt(tpu_address.split(':')[1]),
						tpu_address.split(':')[0],
						(error) => {
							if (!error) {
								//const version = VersionedMessage.deserializeMessageVersion(rawTransaction);
								let signature: Uint8Array | Buffer;
								try {
									const transaction = Transaction.from(rawTransaction);
									signature = transaction.signature!;
								} catch (e: any) {
									const transaction = VersionedTransaction.deserialize(new Uint8Array(rawTransaction));
									[signature] = transaction.signatures;
								}
								resolve(bs58.encode(signature));
								console.log('sent raw transaction successfully.');
								console.log(bs58.encode(signature));
							} else {
								console.error(error);
								reject(error);
							}
						},
					);
				});
			});
		});
	}
}

export class LeaderTpuService {
	recentSlots!: RecentLeaderSlots;
	leaderTpuCache!: LeaderTpuCache;
	subscription: number | null = null;
	connection: Connection;

	//@ts-check
	/**
	 *
	 * @param connection {Connection}
	 */
	private constructor(connection: Connection) {
		this.connection = connection;
	}

	//@ts-check
	/**
	 *
	 * @param connection {Connection}
	 * @param websocket_url {string}
	 * @returns {Promise<LeaderTpuService}
	 */
	static load(connection: Connection, websocket_url = ''): Promise<LeaderTpuService> {
		return new Promise((resolve) => {
			const leaderTpuService = new LeaderTpuService(connection);
			leaderTpuService.connection.getSlot('processed').then((start_slot) => {
				leaderTpuService.recentSlots = new RecentLeaderSlots(start_slot);
				LeaderTpuCache.load(connection, start_slot).then((leaderTpuCache) => {
					leaderTpuService.leaderTpuCache = leaderTpuCache;
					if (websocket_url !== '') {
						leaderTpuService.subscription = connection.onSlotUpdate((slotUpdate) => {
							if (slotUpdate.type === 'completed') {
								slotUpdate.slot++;
							}
							leaderTpuService.recentSlots.recordSlot(slotUpdate.slot);
						});
					}
					leaderTpuService.run();
					resolve(leaderTpuService);
				});
			});
		});
	}

	//@ts-check
	/**
	 *
	 * @param fanout_slots {number}
	 * @returns {Promise<string[]>}
	 */
	leaderTpuSockets(fanout_slots: number): Promise<string[]> {
		console.log(`getting leader sockets with fanout slots ${fanout_slots}`);
		return this.leaderTpuCache.getLeaderSockets(fanout_slots);
	}

	//@ts-check
	/**
	 * @returns {void}
	 */
	async run() {
		const last_cluster_refresh = Date.now();
		let sleep_ms = 1000;
		setTimeout(async () => {
			sleep_ms = 1000;
			if (Date.now() - last_cluster_refresh > 1000 * 5 * 60) {
				try {
					this.leaderTpuCache.leaderTpuMap = await this.leaderTpuCache.fetchClusterTpuSockets();
				} catch (error) {
					console.warn('Failed to fetch cluster tpu sockets', error);
					sleep_ms = 1000;
				}
			}
			const estimatedCurrentSlot = this.recentSlots.estimatedCurrentSlot();
			if (estimatedCurrentSlot >= this.leaderTpuCache.last_epoch_info_slot - this.leaderTpuCache.slots_in_epoch) {
				try {
					const epochInfo = await this.connection.getEpochInfo('recent');
					this.leaderTpuCache.slots_in_epoch = epochInfo.slotsInEpoch;
					this.leaderTpuCache.last_epoch_info_slot = estimatedCurrentSlot;
				} catch (error) {
					console.warn('failed to get epoch info');
				}
			}
			if (estimatedCurrentSlot >= this.leaderTpuCache.lastSlot() - MAX_FANOUT_SLOTS) {
				try {
					const slot_leaders = await this.leaderTpuCache.fetchSlotLeaders(
						estimatedCurrentSlot,
						this.leaderTpuCache.slots_in_epoch,
					);
					this.leaderTpuCache.first_slot = estimatedCurrentSlot;
					this.leaderTpuCache.leaders = slot_leaders;
				} catch (error) {
					console.warn(`Failed to fetch slot leaders (current estimated slot: ${estimatedCurrentSlot})`, error);
					sleep_ms = 1000;
				}
			}
			this.run();
		}, sleep_ms);
	}
}

export class TpuConnection extends Connection {
	tpuClient!: TpuClient;

	//@ts-check
	/**
	 *
	 * @param endpoint {string}
	 * @param commitmentOrConfig {Commitment | ConnectionConfig}
	 */
	private constructor(endpoint: string, commitmentOrConfig?: Commitment | ConnectionConfig) {
		super(endpoint, commitmentOrConfig);
	}

	//@ts-check
	/**
	 *
	 * @param transaction {Transaction}
	 * @param signers {Array<Signer> | SendOptions}
	 * @param options {SendOptions}
	 * @returns {Promise<string>}
	 */
	async sendTransaction(
		transaction: VersionedTransaction | Transaction,
		signersOrOptions?: Array<Signer> | SendOptions,
		options?: SendOptions,
	): Promise<TransactionSignature> {
		return this.tpuClient.sendTransaction(transaction, signersOrOptions, options);
	}

	//@ts-check
	/**
	 *
	 * @param rawTransaction {Buffer | Array<number> | Uint8Array}
	 * @returns {Promise<string>}
	 */
	sendRawTransaction(rawTransaction: Buffer | Array<number> | Uint8Array): Promise<string> {
		return this.tpuClient.sendRawTransaction(rawTransaction);
	}

	///@ts-check
	/**
	 *
	 * @param connection {TpuConnection}
	 * @param transaction {Transaction}
	 * @param signers {Array<Signer>}
	 * @param options {ConfirmOptions}
	 * @returns {Promise<TransactionSignature>}
	 */
	async sendAndConfirmTransaction(
		connection: TpuConnection,
		transaction: Transaction,
		signers: Array<Signer>,
		options?: ConfirmOptions,
	): Promise<TransactionSignature> {
		const signature = await this.sendTransaction(transaction, signers);
		const status = (await connection.confirmTransaction(signature, options?.commitment ?? 'confirmed')).value;
		if (status.err) {
			throw new Error(`Transaction ${signature} failed (${JSON.stringify(status)})`);
		}
		return signature;
	}

	//@ts-check
	/**
	 *
	 * @param connection {TpuConnection}
	 * @param rawTransaction {Buffer | Array<number> | Uint8Array}
	 * @param options {ConfirmOptions}
	 * @returns {Promise<string>}
	 */
	async sendAndConfirmRawTransaction(
		connection: TpuConnection,
		rawTransaction: Buffer | Array<number> | Uint8Array,
		options?: ConfirmOptions,
	): Promise<string> {
		const signature = await this.sendRawTransaction(rawTransaction);
		const status = (await connection.confirmTransaction(signature, options?.commitment ?? 'confirmed')).value;
		if (status.err) {
			throw new Error(`Transaction ${signature} failed (${JSON.stringify(status)})`);
		}
		return signature;
	}

	//@ts-check
	/**
	 *
	 * @param endpoint {string}
	 * @param commitmentOrConfig {Commitment | ConnectionConfig}
	 * @returns {Promise<TpuConnection>}
	 */
	static load(endpoint: string, commitmentOrConfig?: Commitment | ConnectionConfig): Promise<TpuConnection> {
		return new Promise((resolve) => {
			const tpuConnection = new TpuConnection(endpoint, commitmentOrConfig);
			TpuClient.load(tpuConnection).then((tpuClient) => {
				tpuConnection.tpuClient = tpuClient;
				resolve(tpuConnection);
			});
		});
	}
}
