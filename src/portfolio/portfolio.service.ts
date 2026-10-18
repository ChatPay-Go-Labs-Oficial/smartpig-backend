import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../infra/prisma/prisma.service';
import { VaultAdapterRegistry } from '../defindex/adapter.registry';
import { VaultRegistryService } from '../vault-registry/vault-registry.service';
import { PricingService } from '../pricing/pricing.service';

export interface PortfolioPosition {
  vaultId: string;
  vaultName: string;
  assetSymbol: string;
  /** Whole units of the underlying asset. */
  amountAsset: string;
  /** Null when nothing could price this asset. */
  amountUsd: string | null;
  shares: string;
}

export interface PortfolioSummary {
  /**
   * Null when any held position could not be priced.
   *
   * A partial total is worse than none: it looks complete and understates what
   * the user has. The app shows the per-asset list instead.
   */
  totalUsd: string | null;
  asOf: string;
  /** `REFLECTOR`, `STATIC`, `MIXED`, or null when nothing was priced. */
  priceSource: string | null;
  /** True when any price used was older than we vouch for. */
  stale: boolean;
  positions: PortfolioPosition[];
}

/**
 * The user's holdings across every vault, in one answer.
 *
 * Replaces the client summing `underlyingBalance[0]` over every vault as if the
 * amounts shared a currency — a total of USDC plus EURC plus XLM is a number
 * with no meaning, and in the app it also drove the pig-level thresholds.
 *
 * One request instead of the client's fan-out, which also removes the largest
 * source of DeFindex reads on the home screen.
 */
@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: VaultRegistryService,
    private readonly adapters: VaultAdapterRegistry,
    private readonly pricing: PricingService,
  ) {}

  async summary(userId: string): Promise<PortfolioSummary> {
    const wallet = await this.prisma.walletAccount.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { stellarAddress: true },
    });
    if (!wallet) {
      throw new NotFoundException(`No active wallet for user ${userId}`);
    }

    const vaults = await this.registry.listForUser(userId);
    if (vaults.length === 0) {
      return {
        totalUsd: '0.0000',
        asOf: new Date().toISOString(),
        priceSource: null,
        stale: false,
        positions: [],
      };
    }

    const prices = await this.pricing.getUsdPrices(
      vaults.map((vault) => vault.assetSymbol),
    );

    const positions: PortfolioPosition[] = [];
    let total = new Decimal(0);
    let anyUnpriced = false;
    let anyStale = false;
    const sources = new Set<string>();

    for (const vault of vaults) {
      let amountAsset = '0';
      let shares = '0';

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
        amountAsset = position.underlying[0] ?? '0';
        shares = position.shares;
      } catch (err) {
        this.logger.warn(
          `Could not read position in vault ${vault.id}: ${(err as Error).message}`,
        );
        // A vault we cannot read is not a vault holding nothing. Counting it as
        // zero would understate the total silently.
        anyUnpriced = true;
        continue;
      }

      const amount = new Decimal(amountAsset);
      if (amount.lte(0)) continue;

      const price = prices.get(vault.assetSymbol.toUpperCase());
      if (!price) {
        anyUnpriced = true;
      } else {
        sources.add(price.source);
        if (price.stale) anyStale = true;
        total = total.plus(amount.mul(price.priceUsd));
      }

      positions.push({
        vaultId: vault.id,
        vaultName: vault.name,
        assetSymbol: vault.assetSymbol,
        amountAsset: amount.toString(),
        amountUsd: price
          ? amount.mul(price.priceUsd).toDecimalPlaces(4).toString()
          : null,
        shares,
      });
    }

    return {
      totalUsd: anyUnpriced ? null : total.toDecimalPlaces(4).toString(),
      asOf: new Date().toISOString(),
      priceSource:
        sources.size === 0
          ? null
          : sources.size === 1
            ? [...sources][0]
            : 'MIXED',
      stale: anyStale,
      positions,
    };
  }
}
