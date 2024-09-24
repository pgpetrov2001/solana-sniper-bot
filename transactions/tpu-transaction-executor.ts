import {
    BlockhashWithExpiryBlockHeight,
    Connection,
    Keypair,
    Transaction,
    VersionedTransaction,
} from '@solana/web3.js';
import { TransactionExecutor } from './transaction-executor.interface.ts';
import { logger } from '../helpers/index.ts';

import { spawn } from 'child_process';

export class TpuTransactionExecutor implements TransactionExecutor {
    constructor(private readonly connection: Connection) {}

    public async executeAndConfirm(
        transaction: VersionedTransaction,
        payer: Keypair,
        latestBlockhash: BlockhashWithExpiryBlockHeight,
        skipPreflight: boolean,
    ): Promise<{ confirmed: boolean; signature?: string }> {
        logger.debug('Executing transaction...');
        const signature = await this.execute(transaction, skipPreflight);

        logger.debug({ signature }, 'Confirming transaction...');
        return this.confirm(signature, latestBlockhash);
    }

    private async execute(transaction: Transaction | VersionedTransaction, skipPreflight: boolean) {
        return await new Promise<string>((resolve, reject) => {
            const serializedTransaction = Buffer.from(transaction.serialize()).toString('base64');
            logger.debug(
                `Executing transaction by calling ./transactions/tpu-transaction-executor/target/release/tpu-transaction-executor --versioned ${serializedTransaction}...`,
            );
            const tpuTransactionSender = spawn(
                './transactions/tpu-transaction-executor/target/release/tpu-transaction-executor',
                ['--versioned', serializedTransaction],
            );

            let dataBuffer = '';
            tpuTransactionSender.stdout.on('data', (data) => {
                dataBuffer += data.toString();
            });

            //stderr will be used for logging
            tpuTransactionSender.stderr.on('data', (data) => {
                logger.trace(`[tpu-transaction-executor]: ${data.toString()}`);
            });

            tpuTransactionSender.on('error', (err) => {
                reject(
                    new Error(
                        `tpu-transaction-executor could not be loaded: ${err}.\nMake sure you have built the subproject.`,
                    ),
                );
            });

            tpuTransactionSender.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`tpu-transaction-executor exited with code ${code}`));
                }
                resolve(dataBuffer.trim());
            });
        });
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
