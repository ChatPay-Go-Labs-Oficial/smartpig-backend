import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import {
  findAssetBySymbol,
  readAssetRegistry,
  type AssetDefinition,
} from '../config/asset-registry';
import { ReflectorService } from './reflector.service';

/** Same shape as the APY cache in VaultsService. */
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * How old an oracle price may be before it is labelled stale.
 *
 * Three times the oracle's own 300-second resolution. Tighter would flag a
 * perfectly normal read that happened just before an update.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

export type PriceSource = 'REFLECTOR' | 'STATIC';

export interface AssetPrice {
  symbol: string;
  priceUsd: Decimal;
  source: PriceSource;
  /** The oracle's timestamp, not the time we read it. */
  asOf: Date;
  /** True when the quote is older than we are willing to vouch for. */
  stale: boolean;
}

/**
 * USD prices for the assets the registry knows.
 *
 * Exists because a multi-asset portfolio cannot be added up without one: USDC,
 * EURC and XLM positions are three different units, and a total that sums them
 * raw is a number with no meaning.
 *
 * `PRICING_MODE=STATIC` is the escape hatch for an environment without a working
 * oracle. It is deliberately explicit rather than a silent fallback, because a
 * configured constant presented as a market price is worse than no price at all.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private readonly assets: AssetDefinition[];
  private readonly mode: 'REFLECTOR' | 'STATIC';
  private readonly staticPrices: Record<string, string>;
  private readonly cache = new Map<
    string,
    { value: AssetPrice; expiresAt: number }
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: ReflectorService,
  ) {
    this.assets = readAssetRegistry(
      this.config.get<string>('DEFINDEX_NETWORK', 'testnet'),
      this.config.get<string>('STELLAR_ASSETS_JSON'),
    );

    const configured = this.config.get<string>('PRICING_MODE', 'REFLECTOR');
    // Falls back to STATIC when the oracle has no RPC to talk to, so the mode
    // always describes what will actually happen.
    this.mode =
      configured === 'STATIC' || !this.reflector.available
        ? 'STATIC'
        : 'REFLECTOR';

    this.staticPrices = this.readStaticPrices();

    this.logger.log(
      `Pricing mode: ${this.mode}${this.mode === 'STATIC' ? ` (${Object.keys(this.staticPrices).join(', ') || 'none configured'})` : ''}`,
    );
  }

  /**
   * One asset's USD price, or null when nothing can price it.
   *
   * Null is a real answer. Every caller must handle it rather than defaulting to
   * zero, which would report a funded position as empty.
   */
  async getUsdPrice(symbol: string): Promise<AssetPrice | null> {
    const asset = findAssetBySymbol(this.assets, symbol);
    if (!asset) {
      this.logger.warn(`No registry entry for asset ${symbol}`);
      return null;
    }

    const cached = this.cache.get(asset.symbol);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const price =
      this.mode === 'REFLECTOR'
        ? ((await this.fromOracle(asset)) ?? this.fromStatic(asset))
        : this.fromStatic(asset);

    if (!price) return null;

    this.cache.set(asset.symbol, {
      value: price,
      expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
    });
    return price;
  }

  /**
   * Prices several assets at once.
   *
   * The portfolio job calls this before its wallet loop: with three assets that
   * is three oracle reads per run instead of three per wallet per vault.
   *
   * Keyed by both the canonical symbol and whatever was asked for, so a caller
   * holding DeFindex's `"native"` and one holding `"XLM"` both find the entry.
   * Without that a lookup silently misses and the position reports no value.
   */
  async getUsdPrices(symbols: string[]): Promise<Map<string, AssetPrice>> {
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const prices = await Promise.all(
      unique.map(
        async (symbol) => [symbol, await this.getUsdPrice(symbol)] as const,
      ),
    );

    const bySymbol = new Map<string, AssetPrice>();
    for (const [requested, price] of prices) {
      if (!price) continue;
      bySymbol.set(price.symbol.toUpperCase(), price);
      bySymbol.set(requested, price);
    }
    return bySymbol;
  }

  private async fromOracle(asset: AssetDefinition): Promise<AssetPrice | null> {
    const feed = asset.reflectorFeed;
    if (!feed) {
      this.logger.warn(`Asset ${asset.symbol} has no configured price feed`);
      return null;
    }

    const quote = await this.reflector.getPrice({
      contractId: feed.contractId,
      asset: feed.asset,
    });
    if (!quote) return null;

    const stale = Date.now() - quote.asOf.getTime() > STALE_AFTER_MS;
    if (stale) {
      this.logger.warn(
        `Reflector price for ${asset.symbol} is stale (${quote.asOf.toISOString()})`,
      );
    }

    return {
      symbol: asset.symbol,
      priceUsd: quote.priceUsd,
      source: 'REFLECTOR',
      asOf: quote.asOf,
      stale,
    };
  }

  private fromStatic(asset: AssetDefinition): AssetPrice | null {
    const configured = this.staticPrices[asset.symbol.toUpperCase()];
    if (!configured) return null;

    return {
      symbol: asset.symbol,
      priceUsd: new Decimal(configured),
      source: 'STATIC',
      asOf: new Date(),
      // Always flagged: a constant is not a market price, and anything that
      // displays it should be able to say so.
      stale: true,
    };
  }

  /** `PRICING_STATIC_USD` as `USDC=1,EURC=1.12,XLM=0.19`. */
  private readStaticPrices(): Record<string, string> {
    const raw = this.config.get<string>('PRICING_STATIC_USD', '');
    const parsed: Record<string, string> = {};

    for (const entry of raw.split(',')) {
      const [symbol, value] = entry.split('=').map((part) => part.trim());
      if (!symbol || !value) continue;
      try {
        new Decimal(value);
        parsed[symbol.toUpperCase()] = value;
      } catch {
        this.logger.warn(`Ignoring unparseable static price "${entry}"`);
      }
    }

    return parsed;
  }
}
