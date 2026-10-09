import {
  VaultInfoResponse,
  VaultBalanceResponse,
  VaultApyResponse,
} from '@defindex/sdk';
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
      // Both of these used to be dropped here. The configuration record the
      // deliverable requires cannot be filled from chain without them, and the
      // fee is one of the risks the disclosure has to state.
      roles: raw.roles
        ? {
            manager: raw.roles.manager,
            emergencyManager: raw.roles.emergencyManager,
            rebalanceManager: raw.roles.rebalanceManager,
            feeReceiver: raw.roles.feeReceiver,
          }
        : null,
      fees: raw.feesBps
        ? {
            vaultFeeBps: raw.feesBps.vaultFee,
            defindexFeeBps: raw.feesBps.defindexFee,
          }
        : null,
      assets:
        raw.assets?.map((a) => ({
          address: a.address,
          name: a.name,
          symbol: a.symbol,
          strategies:
            a.strategies?.map((s) => ({
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
