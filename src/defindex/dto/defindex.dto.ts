import { SupportedNetworks } from '@defindex/sdk';

export interface VaultInfoDto {
  defindexVaultId: string;
  name: string;
  symbol: string;
  apy: number;
  assets: {
    address: string;
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
