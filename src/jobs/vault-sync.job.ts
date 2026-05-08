import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';

/**
 * Discovers vaults from the DeFindex API and upserts them into the local VaultCatalog.
 * Runs every 30 minutes. This ensures new vaults deployed on DeFindex appear in the app
 * without manual intervention.
 */
@Injectable()
export class VaultSyncJob {
  private readonly logger = new Logger(VaultSyncJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
  ) {}

  @Cron('0 */30 * * * *') // every 30 minutes
  async syncVaultsFromDefindex() {
    this.logger.log('Starting vault discovery sync...');

    let discovered: Awaited<ReturnType<typeof this.defindex.discoverVaults>>;
    try {
      discovered = await this.defindex.discoverVaults();
    } catch (err) {
      this.logger.warn(`Vault discovery failed: ${(err as Error).message}`);
      return;
    }

    if (!discovered?.vaults?.length) {
      this.logger.log('No vaults returned from DeFindex discovery.');
      return;
    }

    let upserted = 0;

    for (const vault of discovered.vaults) {
      try {
        const totalFunds = vault.totalManagedFunds?.[0];
        const tvl = totalFunds?.total_amount
          ? new Decimal(totalFunds.total_amount)
          : null;

        await this.prisma.vaultCatalog.upsert({
          where: { defindexVaultId: vault.address },
          create: {
            defindexVaultId: vault.address,
            name: vault.address, // placeholder — enriched by getVaultInfo if needed
            assetSymbol: totalFunds?.asset ?? 'UNKNOWN',
            apy: vault.apy != null ? new Decimal(vault.apy) : null,
            tvl,
            isActive: true,
            lastSyncedAt: new Date(),
          },
          update: {
            apy: vault.apy != null ? new Decimal(vault.apy) : undefined,
            tvl: tvl ?? undefined,
            isActive: true,
            lastSyncedAt: new Date(),
          },
        });

        upserted++;
      } catch (err) {
        this.logger.warn(
          `Failed to upsert vault ${vault.address}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Vault sync complete: ${upserted}/${discovered.vaults.length} upserted (total discovered: ${discovered.totalVaults})`,
    );
  }
}
