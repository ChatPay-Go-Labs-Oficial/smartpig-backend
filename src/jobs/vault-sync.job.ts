import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';

/** Delay between getVaultInfo calls to avoid hitting the DeFindex rate limit. */
const INTER_VAULT_DELAY_MS = 500;

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
        // Enrich with on-chain vault metadata (name, asset symbol, and TVL).
        // A small delay between calls avoids hitting the DeFindex rate limit.
        await new Promise((r) => setTimeout(r, INTER_VAULT_DELAY_MS));

        let vaultName = vault.address;
        let assetSymbol = 'UNKNOWN';
        let tvl: Decimal | null = null;

        try {
          const info = await this.defindex.getVaultInfo(vault.address);
          if (info?.name) vaultName = info.name;
          if (info?.assetSymbol) assetSymbol = info.assetSymbol;
          if (info?.tvl) tvl = new Decimal(info.tvl);
        } catch (infoErr) {
          this.logger.warn(
            `Could not enrich vault info for ${vault.address}: ${(infoErr as Error).message}`,
          );
        }

        await this.prisma.vaultCatalog.upsert({
          where: { defindexVaultId: vault.address },
          create: {
            defindexVaultId: vault.address,
            name: vaultName,
            assetSymbol,
            apy: vault.apy != null ? new Decimal(vault.apy) : null,
            tvl,
            isActive: true,
            lastSyncedAt: new Date(),
          },
          update: {
            name: vaultName,
            assetSymbol,
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
