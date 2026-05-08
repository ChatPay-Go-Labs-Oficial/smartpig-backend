import { Injectable, Logger } from '@nestjs/common';
import { DefindexConfig } from './defindex.config';
import { DefindexMapper } from './defindex.mapper';
import { mapDefindexError } from './errors/defindex.errors';
import {
  GenerateDepositXdrDto,
  GenerateWithdrawXdrDto,
  SubmitTransactionDto,
  SubmitTransactionResultDto,
  VaultApyDto,
  VaultBalanceDto,
  VaultInfoDto,
  XdrResponseDto,
} from './dto/defindex.dto';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 100;

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = MAX_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((r) =>
          setTimeout(r, BASE_DELAY_MS * Math.pow(4, attempt - 1)),
        );
      }
    }
  }
  throw lastError;
}

@Injectable()
export class DefindexService {
  private readonly logger = new Logger(DefindexService.name);

  constructor(private readonly defindexConfig: DefindexConfig) {}

  private get sdk() {
    return this.defindexConfig.sdk;
  }

  async healthCheck(): Promise<unknown> {
    try {
      return await withRetry(() => this.sdk.healthCheck());
    } catch (err) {
      mapDefindexError(err);
    }
  }

  async getVaultInfo(vaultAddress: string): Promise<VaultInfoDto> {
    try {
      const raw = await withRetry(() => this.sdk.getVaultInfo(vaultAddress));
      return DefindexMapper.toVaultInfo(vaultAddress, raw);
    } catch (err) {
      this.logger.warn(`getVaultInfo failed for ${vaultAddress}`);
      mapDefindexError(err);
    }
  }

  async getVaultBalance(
    vaultAddress: string,
    userAddress: string,
  ): Promise<VaultBalanceDto> {
    try {
      const raw = await withRetry(() =>
        this.sdk.getVaultBalance(vaultAddress, userAddress),
      );
      return DefindexMapper.toVaultBalance(raw);
    } catch (err) {
      this.logger.warn(
        `getVaultBalance failed for vault=${vaultAddress} user=${userAddress}`,
      );
      mapDefindexError(err);
    }
  }

  async getVaultApy(vaultAddress: string): Promise<VaultApyDto> {
    try {
      const raw = await withRetry(() => this.sdk.getVaultAPY(vaultAddress));
      return DefindexMapper.toVaultApy(raw);
    } catch (err) {
      this.logger.warn(`getVaultAPY failed for ${vaultAddress}`);
      mapDefindexError(err);
    }
  }

  async generateDepositXdr(params: GenerateDepositXdrDto): Promise<XdrResponseDto> {
    const { vaultAddress, callerAddress, amounts, slippageBps, invest, network } = params;
    try {
      const raw = await withRetry(() =>
        this.sdk.depositToVault(
          vaultAddress,
          { caller: callerAddress, amounts, slippageBps, invest: invest ?? true },
          network,
        ),
      );
      return {
        xdr: raw.xdr,
        operationXdr: raw.operationXDR,
        isSmartWallet: raw.isSmartWallet,
      };
    } catch (err) {
      this.logger.warn(`generateDepositXdr failed for vault=${vaultAddress}`);
      mapDefindexError(err);
    }
  }

  async generateWithdrawXdr(params: GenerateWithdrawXdrDto): Promise<XdrResponseDto> {
    const { vaultAddress, callerAddress, shareAmount, slippageBps, network } = params;
    try {
      const raw = await withRetry(() =>
        this.sdk.withdrawShares(
          vaultAddress,
          { caller: callerAddress, shares: shareAmount, slippageBps },
          network,
        ),
      );
      return {
        xdr: raw.xdr,
        operationXdr: raw.operationXDR,
        isSmartWallet: raw.isSmartWallet,
      };
    } catch (err) {
      this.logger.warn(
        `generateWithdrawXdr failed for vault=${vaultAddress}`,
      );
      mapDefindexError(err);
    }
  }

  async submitSignedTransaction(
    params: SubmitTransactionDto,
  ): Promise<SubmitTransactionResultDto> {
    const { xdr, network } = params;
    try {
      const raw = await withRetry(() => this.sdk.sendTransaction(xdr, network));
      return {
        txHash: raw.txHash,
        success: raw.success,
        ledger: raw.ledger,
      };
    } catch (err) {
      this.logger.warn(`submitSignedTransaction failed`);
      mapDefindexError(err);
    }
  }
}
