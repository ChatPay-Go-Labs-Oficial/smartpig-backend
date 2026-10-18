import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';

/** Delay between getVaultInfo calls to avoid hitting the DeFindex rate limit. */
const INTER_VAULT_DELAY_MS = 500;

/**
 * Discovers vaults from the DeFindex API and records what it found in VaultCatalog.
 *
 * Runs every 6 hours. Discovery plus one enrichment call per vault shares the same
 * DeFindex rate limit as the balance reads the app makes on demand, and every 30
 * minutes was enough to exhaust it. A new vault taking up to six hours to appear is
 * acceptable; a user who cannot read their own balance is not.
 *
 * ## What this job may and may not write
 *
 * The job owns only what it observes: `discoveredName`, `discoveredAssetSymbol`,
 * `apy`, `tvl`, `lastSeenAt`, `lastSyncedAt`. It **never** writes `isActive`.
 *
 * It used to upsert `isActive: true` on both create and update, which made admin
 * deactivation pointless — any vault switched off came back within six hours. For
 * the same reason it no longer overwrites the curated `name`/`assetSymbol` of a row
 * flagged `isCurated`: DeFindex reports XLM as the symbol `"native"` and has been
 * seen returning a truncated contract id (`"CD6M4R23"`) as a symbol, so upstream
 * values are a signal, not the truth we show users.
 *
 * A newly discovered vault is therefore created **invisible** (`isActive: false`)
 * and only an admin can list it.
 */
@Injectable()
export class VaultSyncJob {
  private readonly logger = new Logger(VaultSyncJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
  ) {}

  @Cron('0 0 */6 * * *') // every 6 hours
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

        let discoveredName: string | undefined;
        let discoveredAssetSymbol: string | undefined;
        let tvl: Decimal | null = null;

        try {
          const info = await this.defindex.getVaultInfo(vault.address);
          if (info?.name) discoveredName = info.name;
          if (info?.assetSymbol) discoveredAssetSymbol = info.assetSymbol;
          if (info?.tvl) tvl = new Decimal(info.tvl);
        } catch (infoErr) {
          this.logger.warn(
            `Could not enrich vault info for ${vault.address}: ${(infoErr as Error).message}`,
          );
        }

        const apy = vault.apy != null ? new Decimal(vault.apy) : null;
        const now = new Date();

        const existing = await this.prisma.vaultCatalog.findUnique({
          where: { defindexVaultId: vault.address },
          select: { id: true, isCurated: true },
        });

        if (!existing) {
          await this.prisma.vaultCatalog.create({
            data: {
              defindexVaultId: vault.address,
              // Until an admin curates the row, the observed values are all we have.
              // The address is a safe placeholder name: formatVaultNameForMode on the
              // app already renders a raw contract id readably.
              name: discoveredName ?? vault.address,
              assetSymbol: discoveredAssetSymbol ?? 'UNKNOWN',
              assetDecimals: 7,
              discoveredName,
              discoveredAssetSymbol,
              apy,
              tvl,
              // Invisible until an admin lists it. This is what makes runtime
              // activation a real control rather than a value the job overwrites.
              isActive: false,
              isCurated: false,
              lastSeenAt: now,
              lastSyncedAt: now,
            },
          });
        } else {
          await this.prisma.vaultCatalog.update({
            where: { id: existing.id },
            data: {
              // Always recorded: this is the job's own column.
              discoveredName,
              discoveredAssetSymbol,
              apy: apy ?? undefined,
              tvl: tvl ?? undefined,
              lastSeenAt: now,
              lastSyncedAt: now,
              // Only a non-curated row follows upstream for display values, and
              // `undefined` (not a literal fallback) so a failed enrichment call
              // leaves the previous value intact instead of writing 'UNKNOWN'.
              ...(existing.isCurated
                ? {}
                : {
                    name: discoveredName,
                    assetSymbol: discoveredAssetSymbol,
                  }),
            },
          });
        }

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
