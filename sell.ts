import {
  BigNumberish,
  Liquidity,
} from '@raydium-io/raydium-sdk';
import {
  createCloseAccountInstruction,
} from '@solana/spl-token';
import {
  Keypair,
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import { logger } from './utils';

import {
  COMMITMENT_LEVEL,
  MAX_SELL_RETRIES,
  NETWORK,
} from './constants';

import {
	MinimalTokenAccountData,
} from "./buy";

import { setTimeout } from "timers/promises";

export async function sell(solanaConnection: Connection, wallet: Keypair, quoteTokenAssociatedAddress: PublicKey, mint: PublicKey, tokenAccount: MinimalTokenAccountData, amount: BigNumberish): Promise<boolean> {
  if (!tokenAccount) {
	return false;
  }

  if (!tokenAccount.poolKeys) {
	logger.warn({ mint }, 'No pool keys found');
	return false;
  }

  if (amount === 0) {
	logger.info(
	  {
		mint: tokenAccount.mint,
	  },
	  `Empty balance, can't sell`,
	);
	return true;
  }

  let sold = false;
  let retries = 0;

  do {
    try {
      const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
        {
          poolKeys: tokenAccount.poolKeys!,
          userKeys: {
            tokenAccountOut: quoteTokenAssociatedAddress,
            tokenAccountIn: tokenAccount.address,
            owner: wallet.publicKey,
          },
          amountIn: amount,
          minAmountOut: 0,
        },
        tokenAccount.poolKeys!.version,
      );

      const latestBlockhash = await solanaConnection.getLatestBlockhash({
        commitment: COMMITMENT_LEVEL,
      });
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 421197 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 101337 }),
          ...innerTransaction.instructions,
          createCloseAccountInstruction(tokenAccount.address, wallet.publicKey, wallet.publicKey),
        ],
      }).compileToV0Message();
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([wallet, ...innerTransaction.signers]);
      const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), {
        preflightCommitment: COMMITMENT_LEVEL,
      });
      logger.info({ mint, signature }, `Sent sell tx`);
      const confirmation = await solanaConnection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        COMMITMENT_LEVEL,
      );
      if (confirmation.value.err) {
        logger.error(confirmation.value.err);
        logger.info({ mint, signature }, `Error confirming sell tx`);
        continue;
      }

      logger.info(
        {
          dex: `https://dexscreener.com/solana/${mint}?maker=${wallet.publicKey}`,
          mint,
          signature,
          url: `https://solscan.io/tx/${signature}?cluster=${NETWORK}`,
        },
        `Confirmed sell tx`,
      );
      sold = true;
    } catch (e: any) {
      // wait for a bit before retrying
	  await setTimeout(2000);
      retries++;
      logger.error(e);
      logger.error({ mint }, `Failed to sell token, retry: ${retries}/${MAX_SELL_RETRIES}`);
    }
  } while (!sold && retries < MAX_SELL_RETRIES);
  return sold;
}
