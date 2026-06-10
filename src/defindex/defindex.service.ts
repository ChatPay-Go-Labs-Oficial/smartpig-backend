import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { DefindexConfig } from './defindex.config';
import { DefindexMapper } from './defindex.mapper';
import { mapDefindexError } from './errors/defindex.errors';
import {
  CreateVaultParamsDto,
  CreateVaultResultDto,
  DiscoverVaultsResponseDto,
  GenerateDepositXdrDto,
  GenerateWithdrawXdrDto,
  StrategyDto,
  SubmitTransactionDto,
  SubmitTransactionResultDto,
  VaultApyDto,
  VaultBalanceDto,
  VaultInfoDto,
  XdrResponseDto,
} from './dto/defindex.dto';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 100;

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  if (
    'statusCode' in error &&
    typeof (error as Record<string, unknown>).statusCode === 'number'
  ) {
    return (error as { statusCode: number }).statusCode;
  }

  if ('response' in error) {
    const response = (error as { response?: { status?: unknown } }).response;
    return typeof response?.status === 'number' ? response.status : undefined;
  }

  return undefined;
}

function shouldRetry(error: unknown): boolean {
  const status = getHttpStatus(error);
  if (status !== undefined) return status >= 500;

  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('timeout') ||
    error.message.includes('ETIMEDOUT') ||
    error.message.includes('ECONNRESET') ||
    error.message.includes('ECONNREFUSED')
  );
}

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
      if (attempt >= attempts || !shouldRetry(err)) break;

      await new Promise((resolve) =>
        setTimeout(resolve, BASE_DELAY_MS * Math.pow(2, attempt - 1)),
      );
    }
  }
  throw lastError;
}

@Injectable()
export class DefindexService {
  private readonly logger = new Logger(DefindexService.name);
  private readonly httpClient: AxiosInstance;
  private readonly vaultInfoCache = new Map<
    string,
    { value: VaultInfoDto; expiresAt: number }
  >();
  private readonly vaultInfoRequests = new Map<string, Promise<VaultInfoDto>>();

  constructor(private readonly defindexConfig: DefindexConfig) {
    this.httpClient = axios.create({
      baseURL: this.defindexConfig.baseUrl,
      timeout: this.defindexConfig.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(this.defindexConfig.apiKey && {
          Authorization: `Bearer ${this.defindexConfig.apiKey}`,
        }),
      },
    });
  }

  private get sdk() {
    return this.defindexConfig.sdk;
  }

  async discoverVaults(network?: string): Promise<DiscoverVaultsResponseDto> {
    const net = network ?? this.defindexConfig.defaultNetwork;
    try {
      const data = await withRetry(() =>
        this.httpClient
          .get(`/vault/discover?network=${net}`)
          .then((res) => res.data),
      );
      return data as DiscoverVaultsResponseDto;
    } catch (err) {
      this.logger.warn(`discoverVaults failed for network=${net}`);
      mapDefindexError(err);
    }
  }

  async getStrategies(network?: string): Promise<StrategyDto[]> {
    const net = network ?? this.defindexConfig.defaultNetwork;
    try {
      const data = await withRetry(() =>
        this.httpClient
          .get(`/strategies?network=${net}`)
          .then((res) => res.data),
      );
      return data as StrategyDto[];
    } catch (err) {
      this.logger.warn(`getStrategies failed for network=${net}`);
      mapDefindexError(err);
    }
  }

  async healthCheck(): Promise<unknown> {
    try {
      return await withRetry(() => this.sdk.healthCheck());
    } catch (err) {
      mapDefindexError(err);
    }
  }

  async getVaultInfo(vaultAddress: string): Promise<VaultInfoDto> {
    const cached = this.vaultInfoCache.get(vaultAddress);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const pending = this.vaultInfoRequests.get(vaultAddress);
    if (pending) return pending;

    const request = this.fetchVaultInfo(vaultAddress);
    this.vaultInfoRequests.set(vaultAddress, request);

    try {
      return await request;
    } finally {
      this.vaultInfoRequests.delete(vaultAddress);
    }
  }

  private async fetchVaultInfo(vaultAddress: string): Promise<VaultInfoDto> {
    try {
      const raw = await withRetry(() => this.sdk.getVaultInfo(vaultAddress));
      const info = DefindexMapper.toVaultInfo(vaultAddress, raw);
      this.vaultInfoCache.set(vaultAddress, {
        value: info,
        expiresAt: Date.now() + this.defindexConfig.vaultInfoCacheTtlMs,
      });
      return info;
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

  async generateDepositXdr(
    params: GenerateDepositXdrDto,
  ): Promise<XdrResponseDto> {
    const {
      vaultAddress,
      callerAddress,
      amounts,
      slippageBps,
      invest,
      network,
    } = params;
    try {
      const raw = await withRetry(() =>
        this.sdk.depositToVault(
          vaultAddress,
          {
            caller: callerAddress,
            amounts,
            slippageBps,
            invest: invest ?? true,
          },
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

  async generateWithdrawXdr(
    params: GenerateWithdrawXdrDto,
  ): Promise<XdrResponseDto> {
    const { vaultAddress, callerAddress, shareAmount, slippageBps, network } =
      params;
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
      this.logger.warn(`generateWithdrawXdr failed for vault=${vaultAddress}`);
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
        result: raw.result ?? null,
      };
    } catch (err) {
      this.logger.warn(`submitSignedTransaction failed`);
      mapDefindexError(err);
    }
  }

  async createVault(
    params: CreateVaultParamsDto,
  ): Promise<CreateVaultResultDto> {
    const net = this.defindexConfig.defaultNetwork;
    try {
      const data = await withRetry(() =>
        this.httpClient
          .post(`/factory/create-vault-auto-invest?network=${net}`, params)
          .then((res) => res.data),
      );
      return {
        xdr: data.xdr ?? null,
        predictedVaultAddress: data.predictedVaultAddress ?? null,
      };
    } catch (err) {
      this.logger.warn(`createVault failed`);
      mapDefindexError(err);
    }
  }
}
