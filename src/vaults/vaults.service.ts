import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';
import { Decimal } from '@prisma/client/runtime/library';
import { VaultSyncJob } from '../jobs/vault-sync.job';

const APY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class VaultsService {
  private readonly logger = new Logger(VaultsService.name);
  private readonly apyCache = new Map<string, { apy: number; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
    private readonly vaultSyncJob: VaultSyncJob,
  ) {}

  async listVaults() {
    return this.prisma.vaultCatalog.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        defindexVaultId: true,
        name: true,
        assetSymbol: true,
        description: true,
        apy: true,
        tvl: true,
        lastSyncedAt: true,
      },
    });
  }

  async getVault(id: string) {
    const vault = await this.prisma.vaultCatalog.findUnique({
      where: { id },
      select: {
        id: true,
        defindexVaultId: true,
        name: true,
        assetSymbol: true,
        description: true,
        apy: true,
        tvl: true,
        metadata: true,
        isActive: true,
        lastSyncedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!vault) throw new NotFoundException(`Vault ${id} not found`);

    // Fetch live info from DeFindex and merge
    try {
      const liveInfo = await this.defindex.getVaultInfo(vault.defindexVaultId);
      return { ...vault, liveInfo };
    } catch (err) {
      this.logger.warn(`Could not fetch live vault info for ${id}: ${(err as Error).message}`);
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
        .catch((e) => this.logger.error(`Failed to persist APY for vault ${id}`, e));

      return { vaultId: id, apy, cached: false };
    } catch (err) {
      // Fallback to stored APY
      if (vault.apy !== null) {
        return { vaultId: id, apy: Number(vault.apy), cached: true, stale: true };
      }
      throw err;
    }
  }

  async getVaultBalance(id: string, walletAddress: string) {
    const vault = await this.findActiveVaultOrThrow(id);
    const balance = await this.defindex.getVaultBalance(vault.defindexVaultId, walletAddress);
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
    if (!vault || !vault.isActive) throw new NotFoundException(`Vault ${id} not found`);
    return vault;
  }
}
