import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import {
  Account,
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

/**
 * A price as the oracle reports it.
 *
 * `asOf` is the oracle's own timestamp, not when we read it: a healthy read of a
 * stale price is still a stale price, and only the oracle knows which it is.
 */
export interface OraclePrice {
  priceUsd: Decimal;
  asOf: Date;
}

/**
 * Reads prices from a Reflector oracle contract.
 *
 * Verified against mainnet on 2026-10-09: the external CEX/DEX oracle
 * (`CAFJZQWS…`) quotes `XLM`, `EURC` and `USDC` against a `USD` base with 14
 * decimals and a 300-second resolution, which covers every asset the registry
 * knows. The separate FX oracle exists for fiat pairs and is not needed here.
 *
 * Reads are simulations — `simulateTransaction` against a Soroban RPC — so they
 * cost nothing and need no signature. The source account is only a required
 * field of the envelope; it is never charged and never signs.
 */
@Injectable()
export class ReflectorService {
  private readonly logger = new Logger(ReflectorService.name);
  private readonly rpcUrl: string | null;
  private readonly simulationSource: string;

  constructor(private readonly config: ConfigService) {
    this.rpcUrl = this.config.get<string>('STELLAR_SOROBAN_RPC_URL') ?? null;
    // Any existing account works for a simulation. The treasury is the one we
    // always have, and it is never charged for this.
    this.simulationSource =
      this.config.get<string>('REFLECTOR_SIMULATION_SOURCE') ??
      'GA4JFBKTPEIGQJRSVFKHDL5ZPFOBIEHI23JOEUOEXSA6SQLHACAWPL5Q';

    if (!this.rpcUrl) {
      this.logger.warn(
        'STELLAR_SOROBAN_RPC_URL is not set; oracle reads are unavailable',
      );
    }
  }

  get available(): boolean {
    return this.rpcUrl !== null;
  }

  /**
   * Reads one asset's USD price, or null when the oracle cannot answer.
   *
   * Null rather than a throw, and never a fabricated number: a portfolio that
   * says "we could not price this" is honest, while one that quietly substitutes
   * a guess misreports someone's money.
   */
  async getPrice(params: {
    contractId: string;
    asset: string;
    networkPassphrase?: string;
  }): Promise<OraclePrice | null> {
    if (!this.rpcUrl) return null;

    const { contractId, asset } = params;
    const networkPassphrase = params.networkPassphrase ?? Networks.PUBLIC;

    try {
      const [raw, decimals] = await Promise.all([
        this.simulate<{ price: bigint; timestamp: bigint } | null>(
          contractId,
          networkPassphrase,
          'lastprice',
          [this.otherAsset(asset)],
        ),
        this.decimals(contractId, networkPassphrase),
      ]);

      if (!raw || decimals === null) {
        this.logger.warn(`Reflector returned no price for ${asset}`);
        return null;
      }

      return {
        priceUsd: new Decimal(raw.price.toString()).div(
          new Decimal(10).pow(decimals),
        ),
        // Seconds, confirmed against mainnet — a millisecond reading puts every
        // price in 1970 and makes staleness checks meaningless.
        asOf: new Date(Number(raw.timestamp) * 1000),
      };
    } catch (err) {
      this.logger.warn(
        `Reflector read failed for ${asset}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Cached per contract: the scale is a deploy-time property, not a price. */
  private readonly decimalsCache = new Map<string, number>();

  private async decimals(
    contractId: string,
    networkPassphrase: string,
  ): Promise<number | null> {
    const cached = this.decimalsCache.get(contractId);
    if (cached !== undefined) return cached;

    const value = await this.simulate<number | bigint>(
      contractId,
      networkPassphrase,
      'decimals',
    );
    if (value === null || value === undefined) return null;

    const decimals = Number(value);
    this.decimalsCache.set(contractId, decimals);
    return decimals;
  }

  /**
   * The contract's `Asset::Other(Symbol)` variant.
   *
   * Reflector keys these assets by ticker rather than by contract address — the
   * oracle aggregates external venues, where a Stellar address means nothing.
   */
  private otherAsset(symbol: string): xdr.ScVal {
    return xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol('Other'),
      xdr.ScVal.scvSymbol(symbol),
    ]);
  }

  private async simulate<T>(
    contractId: string,
    networkPassphrase: string,
    method: string,
    args: xdr.ScVal[] = [],
  ): Promise<T | null> {
    const server = new rpc.Server(this.rpcUrl as string);

    const tx = new TransactionBuilder(new Account(this.simulationSource, '0'), {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`${method} simulation failed: ${sim.error}`);
    }

    const retval = sim.result?.retval;
    return retval ? (scValToNative(retval) as T) : null;
  }
}
