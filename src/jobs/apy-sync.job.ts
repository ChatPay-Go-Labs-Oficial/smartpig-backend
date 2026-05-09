import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';

/** Delay between getVaultApy calls to avoid hitting the DeFindex rate limit. */
const INTER_VAULT_DELAY_MS = 500;

/**
 * Periodically refreshes APY for all active vaults and persists to DB.
 * Runs every 10 minutes.
 */
@Injectable()
export class ApySyncJob {
  private readonly logger = new Logger(ApySyncJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
  ) {}

  @Cron('0 */10 * * * *') // every 10 minutes
  async syncApyForAllVaults() {
    const vaults = await this.prisma.vaultCatalog.findMany({
      where: { isActive: true },
      select: { id: true, defindexVaultId: true, name: true },
    });

    if (vaults.length === 0) return;

    this.logger.log(`Syncing APY for ${vaults.length} vault(s)...`);
    let updated = 0;

    for (const vault of vaults) {
      await new Promise((r) => setTimeout(r, INTER_VAULT_DELAY_MS));
      try {
        const { apy } = await this.defindex.getVaultApy(vault.defindexVaultId);
        await this.prisma.vaultCatalog.update({
          where: { id: vault.id },
          data: { apy: new Decimal(apy), lastSyncedAt: new Date() },
        });
        updated++;
      } catch (err) {
        this.logger.warn(`APY sync failed for vault ${vault.name}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`APY sync complete: ${updated}/${vaults.length} updated`);
  }
}
