import { SupportedNetworks } from '@defindex/sdk';

export interface DiscoveredVaultDto {
  address: string;
  apy: number | null;
  /** null when the on-chain simulation for this vault failed */
  totalManagedFunds: {
    /** Asset contract address (not a human-readable symbol) */
    asset: string;
    total_amount: string;
  }[] | null;
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

export interface VaultInfoDto {
  defindexVaultId: string;
  name: string;
  symbol: string;
  /** Symbol of the primary underlying asset (e.g. "USDC", "XLM") */
  assetSymbol: string | null;
  /** TVL of the primary asset as a raw string (stroops or token decimals), null if unavailable */
  tvl: string | null;
  apy: number;
  assets: {
    address: string;
    name: string;
    symbol: string;
    strategies: { address: string; name: string; paused: boolean }[];
  }[];
}

export interface VaultBalanceDto {
  dfTokens: number;
  underlyingBalance: number[];
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
}
