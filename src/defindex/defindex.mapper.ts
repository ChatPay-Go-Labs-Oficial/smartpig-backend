import { VaultInfoResponse, VaultBalanceResponse, VaultApyResponse } from '@defindex/sdk';
import { VaultInfoDto, VaultBalanceDto, VaultApyDto } from './dto/defindex.dto';

export class DefindexMapper {
  static toVaultInfo(
    defindexVaultId: string,
    raw: VaultInfoResponse,
  ): VaultInfoDto {
    return {
      defindexVaultId,
      name: raw.name,
      symbol: raw.symbol,
      apy: raw.apy,
      assets: raw.assets?.map((a) => ({
        address: a.address,
        strategies: a.strategies?.map((s) => ({
          address: s.address,
          name: s.name,
          paused: s.paused,
        })) ?? [],
      })) ?? [],
    };
  }

  static toVaultBalance(raw: VaultBalanceResponse): VaultBalanceDto {
    return {
      dfTokens: raw.dfTokens,
      underlyingBalance: raw.underlyingBalance,
    };
  }

  static toVaultApy(raw: VaultApyResponse): VaultApyDto {
    return { apy: raw.apy };
  }
}
