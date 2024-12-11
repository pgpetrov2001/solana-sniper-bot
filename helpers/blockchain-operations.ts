import {
    AccountInfo,
    ConfirmedSignatureInfo,
    Connection,
    ParsedAccountData,
    ParsedTransactionWithMeta,
    PublicKey,
    TokenBalance,
} from '@solana/web3.js';
import { logger } from './logger.ts';
import { CurrencyAmount, Percent, Price } from '@raydium-io/raydium-sdk';
import { bigintToDecimal } from './common.ts';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Token } from 'graphql';

export function safeFractionToFixed(fraction: Price | CurrencyAmount | Percent): string {
    try {
        return fraction.toFixed();
    } catch (err: unknown) {
        return '0';
    }
}

type BalanceMap = { [key: string]: { [key: string]: bigint } };

export function getBalanceChanges(preMap: BalanceMap, postMap: BalanceMap) {
    const allOwners = Object.keys(preMap).concat(Object.keys(postMap));
    const allMints = Object.values(preMap)
        .concat(Object.values(postMap))
        .reduce((result, mintMap) => result.concat(Object.keys(mintMap)), [] as string[]);

    const result = {} as BalanceMap;

    for (const owner of allOwners) {
        result[owner] = result[owner] ?? {};
        for (const mint of allMints) {
            const pre = preMap[owner]?.[mint] ?? BigInt(0);
            const post = postMap[owner]?.[mint] ?? BigInt(0);
            if (pre !== post) {
                result[owner][mint] = post - pre;
            }
        }
    }

    return result;
}

export type TransformedTransaction = {
    signature: string;
    balanceChanges: { [key: string]: string };
    bigintBalanceChanges: { [key: string]: string };
};

export function transformTransactions(
    txsWithMeta: ParsedTransactionWithMeta[],
    mint: string,
    owner: string,
): TransformedTransaction[] {
    return txsWithMeta
        .map((txWithMeta) => {
            const tx = txWithMeta!.transaction;
            const meta = txWithMeta!.meta!;

            const tokenDecimals = {} as { [key: string]: number };
            const createMap = (arr: TokenBalance[]) => {
                const map = {} as BalanceMap;
                for (const { mint, owner, uiTokenAmount } of arr) {
                    if (!owner) continue;
                    map[owner] = map[owner] ?? {};
                    map[owner][mint] = BigInt(uiTokenAmount.amount);
                    tokenDecimals[mint] = uiTokenAmount.decimals;
                }
                return map;
            };

            if (!meta.preTokenBalances || !meta.postTokenBalances) {
                return { signature: tx.signatures[0], balanceChanges: {}, bigintBalanceChanges: {} };
            }

            const preMap = createMap(meta.preTokenBalances);
            const postMap = createMap(meta.postTokenBalances);
            const ownerBalanceChanges = getBalanceChanges(preMap, postMap)[owner] ?? {};
            const jsonOwnerBalanceChanges = Object.fromEntries(
                Object.entries(ownerBalanceChanges).map(([mint, balance]) => [
                    mint,
                    bigintToDecimal(balance, tokenDecimals[mint]),
                ]),
            );
            const jsonBigintOwnerBalanceChanges = Object.fromEntries(
                Object.entries(ownerBalanceChanges).map(([mint, balance]) => [mint, balance.toString()]),
            );

            return {
                signature: tx.signatures[0],
                balanceChanges: jsonOwnerBalanceChanges,
                bigintBalanceChanges: jsonBigintOwnerBalanceChanges,
            };
        })
        .filter(({ balanceChanges }) => mint in balanceChanges);
}

export async function confirmedTxSignaturesForAccount(
    connection: Connection,
    accountAddress: PublicKey,
    newestSignature?: string,
) {
    const responseSignaturesLimit = 1000;
    const allSignatureInfos: ConfirmedSignatureInfo[] = [];
    let signatureInfos: ConfirmedSignatureInfo[] = [];
    let oldestSignature: string | null = null;
    do {
        signatureInfos = await connection.getSignaturesForAddress(accountAddress, {
            limit: responseSignaturesLimit,
            ...(oldestSignature ? { before: oldestSignature } : {}),
            ...(newestSignature ? { until: newestSignature } : {}),
        });
        oldestSignature = signatureInfos.length ? signatureInfos[signatureInfos.length - 1].signature : null;
        allSignatureInfos.push(...signatureInfos);
        logger.trace(
            { account: accountAddress.toString() },
            `Fetched ${signatureInfos.length} signatures, that happened after ${newestSignature}. Oldest signature fetched ${oldestSignature}. Adding to results...`,
        );
    } while (signatureInfos.length === responseSignaturesLimit);
    return allSignatureInfos
        .filter(
            (signatureInfo) =>
                signatureInfo.err == null &&
                signatureInfo.confirmationStatus &&
                ['confirmed', 'finalized'].includes(signatureInfo.confirmationStatus),
        )
        .map(({ signature }) => signature);
}

export type ParsedTokenAccountInfo = {
    mint: string;
    owner: string;
    tokenAmount: {
        amount: bigint;
        decimals: number;
        uiAmount: number;
        uiAmountString: string;
    };
};

export type TokenAccount = {
    closed: boolean;
    address: string;
    mint: string;
    owner: string;
    tokenAmount: {
        amount: string;
        decimals: number;
        uiAmount: number;
        uiAmountString: string;
    };
};

export async function getParsedTokenAccountsByOwner(connection: Connection, owner: PublicKey): Promise<TokenAccount[]> {
    const { value: resp } = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID });
    return resp.map(({ account, pubkey }: { account: AccountInfo<ParsedAccountData>; pubkey: PublicKey }) => {
        const accountData = account.data.parsed.info as ParsedTokenAccountInfo;
        const { tokenAmount } = accountData;
        return {
            closed: false,
            address: pubkey.toString(),
            mint: accountData.mint,
            owner: accountData.owner,
            tokenAmount: {
                amount: tokenAmount.amount.toString(),
                decimals: tokenAmount.decimals,
                uiAmount: tokenAmount.uiAmount,
                uiAmountString: tokenAmount.uiAmountString,
            },
        };
    });
}
