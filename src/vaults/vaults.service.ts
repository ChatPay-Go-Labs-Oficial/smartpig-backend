import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';
import { Decimal } from '@prisma/client/runtime/library';
import { VaultSyncJob } from '../jobs/vault-sync.job';
import { VaultRegistryService } from '../vault-registry/vault-registry.service';

const APY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class VaultsService {
  private readonly logger = new Logger(VaultsService.name);
  private readonly apyCache = new Map<
    string,
    { apy: number; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
    private readonly vaultSyncJob: VaultSyncJob,
    private readonly config: ConfigService,
    private readonly registry: VaultRegistryService,
  ) {}

  /**
   * Delegates to the registry, which is the single answer to "which vaults".
   *
   * `userId` only decides the `acknowledgmentRequired` hint, so taking it from the
   * request is acceptable here: it is a display flag, not an authorization
   * decision. The rule itself is enforced server-side in `createDeposit`, which is
   * where a wrong answer would actually matter.
   */
  async listVaults(userId?: string) {
    return this.registry.listForUser(userId);
  }

  async getVault(id: string, userId?: string) {
    const vault = await this.registry.getOrThrow(id, userId);

    // Live info is best-effort: the detail screen must still render the stored
    // record and the disclosure when DeFindex is unreachable.
    try {
      const liveInfo = await this.defindex.getVaultInfo(vault.defindexVaultId);
      return { ...vault, liveInfo };
    } catch (err) {
      this.logger.warn(
        `Could not fetch live vault info for ${id}: ${(err as Error).message}`,
      );
      return vault;
    }
  }

  async getVaultApy(id: string) {
    const vault = await this.findActiveVaultOrThrow(id);
    const cached = this.apyCache.get(id);

    if (cached && cached.expiresAt > Date.now()) {
      return { vaultId: id, apy: cached.apy, cached: true };
    }

    try {
      const { apy } = await this.defindex.getVaultApy(vault.defindexVaultId);
      this.apyCache.set(id, { apy, expiresAt: Date.now() + APY_CACHE_TTL_MS });

      // Persist apy to DB (fire-and-forget)
      this.prisma.vaultCatalog
        .update({
          where: { id },
          data: { apy: new Decimal(apy), lastSyncedAt: new Date() },
        })
        .catch((e) =>
          this.logger.error(`Failed to persist APY for vault ${id}`, e),
        );

      return { vaultId: id, apy, cached: false };
    } catch (err) {
      // Fallback to stored APY
      if (vault.apy !== null) {
        return {
          vaultId: id,
          apy: Number(vault.apy),
          cached: true,
          stale: true,
        };
      }
      throw err;
    }
  }

  async getVaultBalance(id: string, walletAddress: string) {
    const vault = await this.findActiveVaultOrThrow(id);
    const balance = await this.defindex.getVaultBalance(
      vault.defindexVaultId,
      walletAddress,
    );
    return { vaultId: id, walletAddress, ...balance };
  }

  async triggerSync() {
    await this.vaultSyncJob.syncVaultsFromDefindex();
    return { message: 'Vault sync triggered successfully' };
  }

  private async findActiveVaultOrThrow(id: string) {
    const vault = await this.prisma.vaultCatalog.findUnique({
      where: { id },
      select: { id: true, defindexVaultId: true, apy: true, isActive: true },
    });
    if (!vault || !vault.isActive)
      throw new NotFoundException(`Vault ${id} not found`);
    return vault;
  }
}
