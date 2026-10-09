import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import axios, { type AxiosInstance } from 'axios';
import {
  horizonPathAssetParam,
  type AssetDefinition,
} from '../config/asset-registry';
import { describePath, type HorizonPathHop } from './path-mapper';

/** Stellar represents amounts to 7 decimal places. */
const STELLAR_DECIMALS = 7;

/**
 * How long a quote may be acted on.
 *
 * Short because the number is a market price. The conversion intent that carries
 * it lives longer, but its `destMin` is what actually protects the user — an
 * expired quote only means we should re-price, not that funds are at risk.
 */
export const QUOTE_TTL_MS = 60 * 1000;

export interface ConversionQuote {
  sourceAsset: AssetDefinition;
  targetAsset: AssetDefinition;
  /** Whole units, decimal strings. */
  sendAmount: string;
  destAmount: string;
  destMin: string;
  slippageBps: number;
  /** Intermediate hops, `[]` for a direct route. */
  path: HorizonPathHop[];
  pathDescription: string[];
  expiresAt: Date;
}

interface StrictSendRecord {
  destination_amount: string;
  path: HorizonPathHop[];
}

@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({
      baseURL: this.config.getOrThrow<string>('STELLAR_HORIZON_URL'),
      timeout: this.config.get<number>('STELLAR_HORIZON_TIMEOUT_MS', 15_000),
    });
  }

  /**
   * Prices a conversion using Horizon's strict-send path finder.
   *
   * Strict-**send** because the known quantity is what the user holds. The dead
   * `swap.ts` in the app used strict-receive, and in the opposite direction.
   */
  async quote(params: {
    sourceAsset: AssetDefinition;
    targetAsset: AssetDefinition;
    sendAmount: string;
    slippageBps?: number;
  }): Promise<ConversionQuote> {
    const { sourceAsset, targetAsset, sendAmount } = params;
    const slippageBps = params.slippageBps ?? targetAsset.maxSlippageBps;

    const records = await this.findPaths(sourceAsset, targetAsset, sendAmount);

    if (records.length === 0) {
      throw new ServiceUnavailableException({
        message: `No conversion route from ${sourceAsset.symbol} to ${targetAsset.symbol} right now`,
        code: 'NO_CONVERSION_ROUTE',
        details: {
          sourceAsset: sourceAsset.symbol,
          targetAsset: targetAsset.symbol,
        },
      });
    }

    // Best price wins. The dead swap.ts took the first record Horizon returned,
    // which is not ordered by price — it simply accepted whatever came first.
    const best = records.reduce((a, b) =>
      new Decimal(b.destination_amount).gt(a.destination_amount) ? b : a,
    );

    const destAmount = new Decimal(best.destination_amount);
    // destMin is the floor the operation enforces on chain: below it the payment
    // fails atomically and the user keeps their funds. swap.ts set it equal to the
    // quote, which fails on any market movement at all.
    const destMin = destAmount
      .mul(new Decimal(10_000 - slippageBps).div(10_000))
      .toDecimalPlaces(STELLAR_DECIMALS, Decimal.ROUND_DOWN);

    const quote: ConversionQuote = {
      sourceAsset,
      targetAsset,
      sendAmount: new Decimal(sendAmount).toFixed(STELLAR_DECIMALS),
      destAmount: destAmount.toFixed(STELLAR_DECIMALS),
      destMin: destMin.toFixed(STELLAR_DECIMALS),
      slippageBps,
      path: best.path ?? [],
      pathDescription: describePath(best.path),
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    };

    this.logger.log(
      `Quote ${sendAmount} ${sourceAsset.symbol} → ${quote.destAmount} ${targetAsset.symbol} ` +
        `(min ${quote.destMin}, ${slippageBps}bps, hops=${quote.path.length})`,
    );

    return quote;
  }

  private async findPaths(
    sourceAsset: AssetDefinition,
    targetAsset: AssetDefinition,
    sendAmount: string,
  ): Promise<StrictSendRecord[]> {
    const params: Record<string, string> = {
      source_amount: new Decimal(sendAmount).toFixed(STELLAR_DECIMALS),
      destination_assets: horizonPathAssetParam(targetAsset),
      ...this.sourceAssetParams(sourceAsset),
    };

    try {
      const { data } = await this.http.get<{
        _embedded?: { records?: StrictSendRecord[] };
      }>('/paths/strict-send', { params });
      return data?._embedded?.records ?? [];
    } catch (err) {
      this.logger.warn(
        `Horizon strict-send failed for ${sourceAsset.symbol}→${targetAsset.symbol}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException({
        message: 'Could not price the conversion right now. Try again.',
        code: 'QUOTE_UNAVAILABLE',
      });
    }
  }

  /**
   * Horizon wants the source asset as three separate query parameters, and a
   * different `asset_type` depending on the code's length.
   */
  private sourceAssetParams(asset: AssetDefinition): Record<string, string> {
    if (asset.kind === 'NATIVE') return { source_asset_type: 'native' };

    return {
      source_asset_type:
        asset.code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12',
      source_asset_code: asset.code,
      source_asset_issuer: asset.issuer as string,
    };
  }
}
