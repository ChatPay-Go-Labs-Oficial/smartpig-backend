import { VaultInfoResponse, VaultBalanceResponse, VaultApyResponse } from '@defindex/sdk';
import { VaultInfoDto, VaultBalanceDto, VaultApyDto } from './dto/defindex.dto';

export class DefindexMapper {
  static toVaultInfo(
    defindexVaultId: string,
    raw: VaultInfoResponse,
  ): VaultInfoDto {
    const primaryAsset = raw.assets?.[0];
    const primaryFunds = raw.totalManagedFunds?.[0];

    return {
      defindexVaultId,
      name: raw.name,
      symbol: raw.symbol,
      assetSymbol: primaryAsset?.symbol ?? null,
      tvl: primaryFunds?.total_amount ?? null,
      apy: raw.apy,
      assets: raw.assets?.map((a) => ({
        address: a.address,
        name: a.name,
        symbol: a.symbol,
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
