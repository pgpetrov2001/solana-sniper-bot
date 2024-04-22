import { Filter, FilterResult } from './pool-filters';
import { MintLayout } from '@solana/spl-token';
import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { logger } from '../helpers';

export class RenouncedFilter implements Filter {
  constructor(private readonly connection: Connection) {}

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      const accountInfo = await this.connection.getAccountInfo(poolKeys.baseMint, this.connection.commitment);
      if (!accountInfo?.data) {
        return { ok: false, message: 'Authorities Renounced -> Failed to fetch account data' };
      }

      const deserialize = MintLayout.decode(accountInfo.data);
      const authorities = [];
      if (deserialize.mintAuthorityOption !== 0) {
        authorities.push('mint');
      }
      if (deserialize.freezeAuthorityOption !== 0) {
        authorities.push('freeze');
      }
      const renounced = authorities.length === 0;
      return {
        ok: renounced,
        message: renounced
          ? undefined
          : `Authorities Renounced -> Creator can ${authorities.join(' and ')} more tokens`,
      };
    } catch (e) {
      logger.error({ mint: poolKeys.baseMint }, `Failed to check if authorities for token are renounced`);
    }

    return { ok: false, message: 'Authorities Renounced -> Failed to check if authorities for token are renounced' };
  }
}
