import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../infra/prisma/prisma.service';
import { VaultAdapterRegistry } from '../defindex/adapter.registry';
import { PricingService, type AssetPrice } from '../pricing/pricing.service';

/** A full sweep of every wallet × vault, regardless of history, once a week. */
const FULL_SWEEP_WEEKDAY = 0; // Sunday

interface VaultRow {
  id: string;
  defindexVaultId: string;
  assetSymbol: string;
  assetDecimals: number;
  protocol: string;
}

/**
 * Takes a daily snapshot of each user's position, valued in USD.
 *
 * Runs at 00:05 UTC.
 *
 * Two things changed from the first version, both because the data it wrote was
 * not usable. It stored raw share units in `balanceAmount`, a figure with no
 * stated scale that was neither the asset amount nor a value; and it never set
 * `balanceUsd`, so positions in three different assets could not be added up.
 *
 * It also no longer reads every wallet against every vault. That product grows
 * with the catalog against a DeFindex rate limit which already forced the sync
 * jobs down to six hours, and a wallet that never touched a vault has nothing to
 * snapshot there.
 */
@Injectable()
export class PortfolioSnapshotJob {
  private readonly logger = new Logger(PortfolioSnapshotJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: VaultAdapterRegistry,
    private readonly pricing: PricingService,
  ) {}

  @Cron('5 0 * * *', { timeZone: 'UTC' })
  async takeSnapshots() {
    const wallets = await this.prisma.walletAccount.findMany({
      where: { isActive: true },
      select: { userId: true, stellarAddress: true },
      distinct: ['userId'],
    });

    const vaults = (await this.prisma.vaultCatalog.findMany({
      where: { isActive: true },
      select: {
        id: true,
        defindexVaultId: true,
        assetSymbol: true,
        assetDecimals: true,
        protocol: true,
      },
    })) as VaultRow[];

    if (wallets.length === 0 || vaults.length === 0) return;

    // Priced once per run, before the wallet loop. Per wallet per vault this
    // would be thousands of oracle reads for the same three numbers.
    const prices = await this.pricing.getUsdPrices(
      vaults.map((vault) => vault.assetSymbol),
    );
    await this.recordPrices(prices);

    const fullSweep = new Date().getUTCDay() === FULL_SWEEP_WEEKDAY;
    const capturedAt = new Date();
    let snapshots = 0;
    let unpriced = 0;

    this.logger.log(
      `Portfolio snapshot starting: ${wallets.length} wallet(s), ${vaults.length} vault(s)` +
        `${fullSweep ? ' (full sweep)' : ''}`,
    );

    for (const wallet of wallets) {
      const scope = fullSweep
        ? vaults
        : await this.vaultsTouchedBy(wallet.userId, vaults);

      for (const vault of scope) {
        try {
          const adapter = this.adapters.get(vault.protocol);
          const position = await adapter.getPosition(
            {
              id: vault.id,
              contractId: vault.defindexVaultId,
              assetSymbol: vault.assetSymbol,
              assetDecimals: vault.assetDecimals,
            },
            wallet.stellarAddress,
          );

          const underlying = new Decimal(position.underlying[0] ?? '0');
          if (underlying.lte(0)) continue;

          const price = prices.get(vault.assetSymbol.toUpperCase());
          if (!price) unpriced++;

          await this.prisma.portfolioSnapshot.create({
            data: {
              userId: wallet.userId,
              vaultId: vault.id,
              assetSymbol: vault.assetSymbol,
              balanceAmount: underlying,
              shareAmount: new Decimal(position.shares),
              // The snapshot is taken either way. Skipping it because the oracle
              // was down would lose the position itself, not just its value.
              balanceUsd: price
                ? underlying.mul(price.priceUsd).toDecimalPlaces(4)
                : null,
              priceUsd: price?.priceUsd ?? null,
              priceSource: price?.source ?? null,
              capturedAt,
            },
          });
          snapshots++;
        } catch (err) {
          this.logger.warn(
            `Snapshot failed for wallet=${wallet.stellarAddress} vault=${vault.defindexVaultId}: ${(err as Error).message}`,
          );
        }
      }
    }

    this.logger.log(
      `Portfolio snapshot complete: ${snapshots} record(s)` +
        (unpriced > 0 ? `, ${unpriced} without a USD value` : ''),
    );
  }

  /**
   * The vaults this user has ever interacted with.
   *
   * Same reasoning as `EligibilityService.inspectionScope`: a position can only
   * exist where there was a deposit, a withdrawal, or an earlier snapshot. The
   * weekly full sweep is the backstop for anything that reasoning misses.
   */
  private async vaultsTouchedBy(
    userId: string,
    vaults: VaultRow[],
  ): Promise<VaultRow[]> {
    const [deposits, withdrawals, snapshots] = await Promise.all([
      this.prisma.depositIntent.findMany({
        where: { userId },
        select: { vaultId: true },
        distinct: ['vaultId'],
      }),
      this.prisma.withdrawalIntent.findMany({
        where: { userId },
        select: { vaultId: true },
        distinct: ['vaultId'],
      }),
      this.prisma.portfolioSnapshot.findMany({
        where: { userId },
        select: { vaultId: true },
        distinct: ['vaultId'],
      }),
    ]);

    const touched = new Set(
      [...deposits, ...withdrawals, ...snapshots].map((row) => row.vaultId),
    );

    return vaults.filter((vault) => touched.has(vault.id));
  }

  /**
   * Records the prices this run used.
   *
   * An oracle only serves the latest price, so without this a historical
   * valuation could never be audited.
   */
  private async recordPrices(prices: Map<string, AssetPrice>) {
    // The map is keyed by both the canonical symbol and the requested alias, so
    // dedupe before writing.
    const unique = new Map<string, AssetPrice>();
    for (const price of prices.values()) unique.set(price.symbol, price);

    for (const price of unique.values()) {
      try {
        await this.prisma.assetPriceSnapshot.create({
          data: {
            assetSymbol: price.symbol,
            priceUsd: price.priceUsd,
            source: price.source,
            asOf: price.asOf,
            stale: price.stale,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Could not record price for ${price.symbol}: ${(err as Error).message}`,
        );
      }
    }
  }
}
