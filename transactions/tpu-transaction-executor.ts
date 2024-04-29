import {
	BlockhashWithExpiryBlockHeight,
	Connection,
	Commitment,
	Keypair,
	Transaction,
	VersionedTransaction,
} from '@solana/web3.js';
import { TpuConnection } from 'tpu-client';
import { TransactionExecutor } from './transaction-executor.interface';
import { logger } from '../helpers';

export class TPUTransactionExecutor implements TransactionExecutor {
	private connection: Connection;

	constructor(connection: Connection) {
		this.connection = connection;
	}

	public async executeAndConfirm(
		transaction: VersionedTransaction,
		payer: Keypair,
		latestBlockhash: BlockhashWithExpiryBlockHeight,
		skipPreflight: boolean,
	): Promise<{ confirmed: boolean; signature?: string }> {
		logger.debug('Executing and confirming transaction...');

		const tpuConnection = await TpuConnection.load(this.connection.rpcEndpoint, this.connection.commitment!);
		const signature = await tpuConnection.sendRawTransaction(transaction.serialize());

		logger.debug({ signature }, 'Confirming transaction...');
		return this.confirm(signature, latestBlockhash);
	}

	private async confirm(signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
		const confirmation = await this.connection.confirmTransaction(
			{
				signature,
				lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
				blockhash: latestBlockhash.blockhash,
			},
			this.connection.commitment,
		);

		return { confirmed: !confirmation.value.err, signature };
	}
}
