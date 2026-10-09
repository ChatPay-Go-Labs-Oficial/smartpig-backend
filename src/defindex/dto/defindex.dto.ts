import { SupportedNetworks } from '@defindex/sdk';

export interface DiscoveredVaultDto {
  address: string;
  apy: number | null;
  /** null when the on-chain simulation for this vault failed */
  totalManagedFunds:
    | {
        /** Asset contract address (not a human-readable symbol) */
        asset: string;
        total_amount: string;
      }[]
    | null;
}

export interface DiscoverVaultsResponseDto {
  totalVaults: number;
  vaults: DiscoveredVaultDto[];
}

export interface StrategyDto {
  address: string;
  name: string;
  network: string;
  asset: string;
  tvl: number;
  apy7d: number;
  apy30d: number;
  apyAllTime: number;
}

/** The four privileged addresses of a vault. */
export interface VaultRolesDto {
  manager: string;
  emergencyManager: string;
  rebalanceManager: string;
  feeReceiver: string;
}

/** Both fees are in basis points: 1000 = 10%. */
export interface VaultFeesDto {
  vaultFeeBps: number;
  defindexFeeBps: number;
}

export interface VaultInfoDto {
  defindexVaultId: string;
  name: string;
  symbol: string;
  /** Symbol of the primary underlying asset (e.g. "USDC", "XLM") */
  assetSymbol: string | null;
  /** TVL of the primary asset as a raw string (stroops or token decimals), null if unavailable */
  tvl: string | null;
  apy: number;
  /**
   * Who can manage, pause, rebalance and collect fees.
   *
   * Kept rather than dropped because the deliverable requires roles recorded per
   * vault, and because they are a real risk the disclosure declares: whoever holds
   * these can pause a strategy or rebalance user funds.
   */
  roles: VaultRolesDto | null;
  /** Also required by the configuration record, and disclosed as the FEES risk. */
  fees: VaultFeesDto | null;
  assets: {
    address: string;
    name: string;
    symbol: string;
    strategies: { address: string; name: string; paused: boolean }[];
  }[];
}

/**
 * A holder's position, in raw contract units.
 *
 * Typed as `number | string` because the DeFindex API returns these as JSON
 * strings (`"19999000"`), not numbers — the previous `number` type was a lie that
 * happened to work only because nothing did arithmetic on them. Normalize through
 * `fromAssetUnits`, which accepts either and keeps precision.
 */
export interface VaultBalanceDto {
  dfTokens: number | string;
  underlyingBalance: (number | string)[];
}

export interface VaultApyDto {
  apy: number;
}

export interface GenerateDepositXdrDto {
  vaultAddress: string;
  callerAddress: string;
  amounts: number[];
  slippageBps?: number;
  invest?: boolean;
  network?: SupportedNetworks;
}

export interface GenerateWithdrawXdrDto {
  vaultAddress: string;
  callerAddress: string;
  shareAmount: number;
  slippageBps?: number;
  network?: SupportedNetworks;
}

export interface XdrResponseDto {
  xdr: string | null;
  operationXdr?: string;
  isSmartWallet?: boolean;
}

export interface SubmitTransactionDto {
  xdr: string;
  network?: SupportedNetworks;
}

export interface SubmitTransactionResultDto {
  txHash: string;
  success: boolean;
  ledger: number;
  result?: unknown;
}

export interface CreateVaultRolesDto {
  manager: string;
  emergencyManager: string;
  feeReceiver: string;
  rebalanceManager: string;
}

export interface CreateVaultAssetStrategyDto {
  address: string;
  name: string;
  amount: number;
}

export interface CreateVaultAssetDto {
  address: string;
  symbol: string;
  amount: number;
  strategies: CreateVaultAssetStrategyDto[];
}

export interface CreateVaultParamsDto {
  caller: string;
  roles: CreateVaultRolesDto;
  name: string;
  symbol: string;
  vaultFee: number;
  upgradable: boolean;
  assets: CreateVaultAssetDto[];
}

export interface CreateVaultResultDto {
  xdr: string | null;
  predictedVaultAddress: string | null;
}
