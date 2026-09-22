import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EtherfuseOrderStatus,
  GiftStatus,
  IntentStatus,
  Prisma,
  RampStatus,
  TransactionStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { readAllowedVaultIds } from '../config/allowed-vaults';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';
import { StellarService } from '../wallets/stellar.service';
import {
  Blocker,
  EligibilityResult,
  EligibilityWarning,
  VaultShareResidual,
  WalletAssetResidual,
} from './dto/eligibility.dto';

/** Intent states that are neither CONFIRMED nor FAILED — money is moving. */
const IN_FLIGHT_INTENT: IntentStatus[] = [
  IntentStatus.CREATED,
  IntentStatus.XDR_GENERATED,
  IntentStatus.SIGNED_XDR_RECEIVED,
  IntentStatus.SUBMITTED,
];

const IN_FLIGHT_ONRAMP: RampStatus[] = [
  RampStatus.PENDING,
  RampStatus.AWAITING_PAYMENT,
  RampStatus.PROCESSING,
];

const IN_FLIGHT_OFFRAMP: RampStatus[] = [
  RampStatus.PENDING,
  RampStatus.DELEGATION_NEEDED,
  RampStatus.PROCESSING,
];

const IN_FLIGHT_ETHERFUSE: EtherfuseOrderStatus[] = [
  EtherfuseOrderStatus.CREATED,
  EtherfuseOrderStatus.PENDING_SIGNATURE,
  EtherfuseOrderStatus.PROCESSING,
];

/** Always returned — these are the things no deletion can undo. */
const WARNINGS: EligibilityWarning[] = [
  'ONCHAIN_HISTORY_PUBLIC',
  'BLINDPAY_RETAINS_KYC',
  'PRIVY_WALLET_ARCHIVED',
];

/**
 * How many vault balance reads run at the same time.
 *
 * One call per vault, all fired at once, is what exhausted the DeFindex rate
 * limit: the whole catalog left in the same tick, came back 429, and every vault
 * turned into VAULT_BALANCE_UNKNOWN — a screen full of blockers the user could do
 * nothing about. The jobs space their calls 500ms apart for the same reason, but
 * this route answers a user who is waiting, so it bounds concurrency instead of
 * serialising: the catalog is read in small groups rather than one burst.
 */
const VAULT_READ_CONCURRENCY = 3;

/**
 * Upstream failures that say "not now" rather than "not ever".
 *
 * `mapDefindexError` turns a rate limit into 503 and a timeout into 504. Neither
 * tells us anything about the vault's balance, so neither may be reported as a
 * balance we could not verify — the user would be told to wait for something that
 * is never going to change on its own.
 */
const TRANSIENT_UPSTREAM_STATUSES: number[] = [
  HttpStatus.SERVICE_UNAVAILABLE,
  HttpStatus.GATEWAY_TIMEOUT,
];

function isTransientUpstream(error: unknown): boolean {
  return (
    error instanceof HttpException &&
    TRANSIENT_UPSTREAM_STATUSES.includes(error.getStatus())
  );
}

/**
 * `Promise.all` over `items`, but with at most `limit` calls in flight.
 *
 * Results keep the order of `items`, which is what keeps the blocker list stable
 * between two checks of the same account.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await fn(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );

  return results;
}

/**
 * Decides whether an account may be deleted without the user losing money or
 * interrupting an operation.
 *
 * Governing principle, from the business rules: when in doubt, block. Every
 * comparison against the dust threshold is done in Decimal — a float here would
 * let a balance slip through and be destroyed with the account.
 *
 * This is a pure read. It never writes, and its answer is advisory: the check that
 * actually authorises a deletion is the one re-run at confirmation time.
 */
@Injectable()
export class EligibilityService {
  private readonly logger = new Logger(EligibilityService.name);
  private readonly dustUsd: Decimal;
  private readonly allowedVaultIds: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
    private readonly stellar: StellarService,
    config: ConfigService,
  ) {
    this.dustUsd = new Decimal(
      config.get<number>('ACCOUNT_DELETION_DUST_USD') ?? 0.01,
    );
    this.allowedVaultIds = readAllowedVaultIds(config);
  }

  async check(userId: string): Promise<EligibilityResult> {
    // One account, one wallet: the social login creates a single Privy wallet, and
    // that is the one the treasury sponsors into existence. So one row answers where
    // the money is, and the ordering just mirrors `AuthService.walletLogin` so this
    // resolves the same wallet the user logged in with. Do not turn it into
    // `findMany` — that would sum balances across rows the domain does not allow.
    const wallet = await this.prisma.walletAccount.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { stellarAddress: true, isActivated: true },
    });

    const [money, inFlight] = await Promise.all([
      this.moneyBlockers(userId, wallet),
      this.inFlightBlockers(userId),
    ]);

    const blockers = [...money.blockers, ...inFlight];

    return {
      eligible: blockers.length === 0,
      blockers,
      residuals: money.residuals,
      warnings: WARNINGS,
      dustThresholdUsd: this.dustUsd.toString(),
    };
  }

  /** B-1 to B-5, plus the residuals, which come from the same balance reads. */
  private async moneyBlockers(
    userId: string,
    wallet: { stellarAddress: string; isActivated: boolean } | null,
  ) {
    const [vaults, walletBalances, gifts] = await Promise.all([
      this.vaultBalances(userId, wallet),
      this.walletBalances(wallet),
      this.giftBlockers(userId),
    ]);

    return {
      blockers: [...vaults.blockers, ...walletBalances.blockers, ...gifts],
      residuals: {
        walletUsdc: walletBalances.usdcResidual.toString(),
        walletAssets: walletBalances.assetResiduals,
        vaultShares: vaults.residuals,
        sweptToTreasuryUsd: walletBalances.sweptTotal.toString(),
        permanentlyLostUsd: vaults.lostTotal.toString(),
      },
    };
  }

  /**
   * B-1 · vault balance.
   *
   * The catalog stores `assetDecimals` because DeFindex answers in asset units, not
   * whole units: a $42.50 position comes back as 425000000. Comparing the raw number
   * against the dust threshold would block every account that ever deposited.
   */
  private async vaultBalances(
    userId: string,
    wallet: { stellarAddress: string } | null,
  ): Promise<{
    blockers: Blocker[];
    residuals: VaultShareResidual[];
    lostTotal: Decimal;
  }> {
    if (!wallet) {
      return { blockers: [], residuals: [], lostTotal: new Decimal(0) };
    }

    const vaults = await this.prisma.vaultCatalog.findMany({
      where: await this.inspectionScope(userId),
      select: {
        id: true,
        defindexVaultId: true,
        name: true,
        assetDecimals: true,
      },
    });

    // One DeFindex call per vault, at most VAULT_READ_CONCURRENCY at a time. Each
    // call already retries internally, so running the catalog in series would
    // multiply this endpoint's latency by its size.
    let throttled = false;

    const readings = await mapWithConcurrency(
      vaults,
      VAULT_READ_CONCURRENCY,
      async (vault) => {
        // Once one read has been throttled the rest will be too, and the answer is
        // already decided. Spending the remaining quota to confirm it only makes the
        // retry the user is about to make less likely to succeed.
        if (throttled) return { vault, underlying: null, transient: true };

        try {
          const balance = await this.defindex.getVaultBalance(
            vault.defindexVaultId,
            wallet.stellarAddress,
          );
          return {
            vault,
            underlying: this.toWholeUnits(
              balance.underlyingBalance?.[0] ?? 0,
              vault.assetDecimals,
            ),
            transient: false,
          };
        } catch (err) {
          if (isTransientUpstream(err)) {
            this.logger.warn(
              `Vault balance temporarily unavailable for ${vault.defindexVaultId}`,
            );
            throttled = true;
            return { vault, underlying: null, transient: true };
          }

          this.logger.warn(
            `Vault balance unavailable for ${vault.defindexVaultId}; blocking deletion`,
          );
          return { vault, underlying: null, transient: false };
        }
      },
    );

    // Answering with blockers here would be a lie: we would be telling the user
    // their vaults cannot be verified when all we know is that DeFindex asked us to
    // come back later. The screen already renders a failed check as "try again",
    // which is the honest answer.
    if (readings.some((reading) => reading.transient)) {
      throw new ServiceUnavailableException(
        'Could not read vault balances right now. Try again shortly.',
      );
    }

    const blockers: Blocker[] = [];
    const residuals: VaultShareResidual[] = [];
    let lostTotal = new Decimal(0);

    for (const { vault, underlying } of readings) {
      if (underlying === null) {
        // The read failed, so we cannot prove the vault is empty. The principle is to
        // block rather than risk destroying a position.
        blockers.push({
          code: 'VAULT_BALANCE_UNKNOWN',
          resolvable: false,
          action: null,
          params: { vaultId: vault.id, vaultName: vault.name },
        });
        continue;
      }

      if (underlying.gt(this.dustUsd)) {
        blockers.push({
          code: 'VAULT_BALANCE',
          resolvable: true,
          action: { type: 'WITHDRAW_VAULT', vaultId: vault.id },
          params: {
            amountUsd: underlying.toString(),
            vaultId: vault.id,
            vaultName: vault.name,
          },
        });
        continue;
      }

      if (underlying.gt(0)) {
        residuals.push({ vaultId: vault.id, amount: underlying.toString() });
        lostTotal = lostTotal.plus(underlying);
      }
    }

    return { blockers, residuals, lostTotal };
  }

  /**
   * Which vaults this check has to read, as a Prisma filter.
   *
   * `ALLOWED_VAULT_IDS` is where the app can deposit *today*, and that list changes:
   * a vault dropped from it keeps whatever was already inside. Reading only the
   * current list would let that balance be destroyed along with the account, so the
   * allowlist is widened by the vaults this user has actually touched — a deposit, a
   * withdrawal or a portfolio snapshot. For everyone who never left the list this
   * costs one query and not a single extra DeFindex call.
   *
   * `isActive` is deliberately absent: a vault can be retired while someone still
   * holds a position in it, and that position must still block the deletion.
   *
   * No allowlist at all means the whole catalog, which already covers everything.
   */
  private async inspectionScope(
    userId: string,
  ): Promise<Prisma.VaultCatalogWhereInput> {
    if (this.allowedVaultIds.length === 0) return {};

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

    const ids = new Set(this.allowedVaultIds);
    for (const { vaultId } of [...deposits, ...withdrawals, ...snapshots]) {
      ids.add(vaultId);
    }

    return { id: { in: [...ids] } };
  }

  /**
   * B-2 and B-3 · wallet balances, read from Horizon.
   *
   * XLM is never evaluated: the account is sponsored and has no spendable XLM — what
   * sits there is treasury reserve, and any excess rides along in the AccountMerge.
   */
  private async walletBalances(
    wallet: { stellarAddress: string; isActivated: boolean } | null,
  ): Promise<{
    blockers: Blocker[];
    usdcResidual: Decimal;
    assetResiduals: WalletAssetResidual[];
    sweptTotal: Decimal;
  }> {
    const empty = {
      blockers: [] as Blocker[],
      usdcResidual: new Decimal(0),
      assetResiduals: [] as WalletAssetResidual[],
      sweptTotal: new Decimal(0),
    };

    if (!wallet || !wallet.isActivated) return empty;

    const balances = await this.stellar.getWalletBalances(
      wallet.stellarAddress,
    );
    const usdcAssetId = this.stellar.getUsdcAssetId();
    const tesouroAssetId = this.stellar.getTesouroAssetId();

    const blockers: Blocker[] = [];
    const assetResiduals: WalletAssetResidual[] = [];
    let usdcResidual = new Decimal(0);
    let sweptTotal = new Decimal(0);

    for (const entry of balances) {
      const isUsdc = entry.asset === usdcAssetId;
      const isTesouro =
        tesouroAssetId !== null && entry.asset === tesouroAssetId;
      if (!isUsdc && !isTesouro) continue;

      const amount = new Decimal(entry.balance);

      if (amount.gt(this.dustUsd)) {
        blockers.push({
          code: isUsdc ? 'WALLET_USDC_BALANCE' : 'WALLET_ASSET_BALANCE',
          resolvable: true,
          action: { type: 'WITHDRAW_WALLET' },
          params: {
            amountUsd: amount.toString(),
            assetCode: entry.asset.split(':')[0],
          },
        });
        continue;
      }

      if (amount.gt(0)) {
        sweptTotal = sweptTotal.plus(amount);
        if (isUsdc) {
          usdcResidual = amount;
        } else {
          assetResiduals.push({
            assetId: entry.asset,
            amount: amount.toString(),
          });
        }
      }
    }

    return { blockers, usdcResidual, assetResiduals, sweptTotal };
  }

  /** B-4 and B-5 · gifts the user sent. Gifts received are the user's money already. */
  private async giftBlockers(userId: string): Promise<Blocker[]> {
    const gifts = await this.prisma.gift.findMany({
      where: {
        senderUserId: userId,
        status: {
          in: [GiftStatus.FUNDED, GiftStatus.CLAIMING, GiftStatus.EXPIRED],
        },
      },
      select: {
        id: true,
        amount: true,
        status: true,
        balanceId: true,
        expiresAt: true,
      },
    });

    const blockers: Blocker[] = [];

    for (const gift of gifts) {
      const amount = new Decimal(gift.amount);

      if (gift.status === GiftStatus.EXPIRED) {
        // Expired without a balanceId means nothing ever reached the network.
        if (!gift.balanceId) continue;
        blockers.push({
          code: 'GIFT_REFUNDABLE',
          resolvable: true,
          action: { type: 'OPEN_GIFTS' },
          params: { amountUsd: amount.toString() },
        });
        continue;
      }

      // FUNDED or CLAIMING: the money is locked on the network and only the sender's
      // key can reclaim it, and only after expiry. There is nothing to offer.
      blockers.push({
        code: 'GIFT_LOCKED',
        resolvable: false,
        action: null,
        params: {
          amountUsd: amount.toString(),
          availableAt: gift.expiresAt.toISOString(),
        },
      });
    }

    return blockers;
  }

  /** B-6 to B-11 · operations already under way. None is resolvable; all are "wait". */
  private async inFlightBlockers(userId: string): Promise<Blocker[]> {
    const [
      deposits,
      withdrawals,
      transactions,
      onramps,
      offramps,
      etherfuseOrders,
    ] = await Promise.all([
      this.prisma.depositIntent.count({
        where: { userId, status: { in: IN_FLIGHT_INTENT } },
      }),
      this.prisma.withdrawalIntent.count({
        where: { userId, status: { in: IN_FLIGHT_INTENT } },
      }),
      this.prisma.transactionRecord.count({
        where: { userId, status: TransactionStatus.PENDING },
      }),
      this.prisma.onrampTransaction.count({
        where: { userId, status: { in: IN_FLIGHT_ONRAMP } },
      }),
      this.prisma.offrampTransaction.count({
        where: { userId, status: { in: IN_FLIGHT_OFFRAMP } },
      }),
      this.prisma.etherfuseOrder.count({
        where: { customer: { userId }, status: { in: IN_FLIGHT_ETHERFUSE } },
      }),
    ]);

    // Six counts, one code each. Nothing here is resolvable — the user can only
    // wait — so none carries an action or parameters.
    const inFlight: [number, Blocker['code']][] = [
      [deposits, 'DEPOSIT_IN_FLIGHT'],
      [withdrawals, 'WITHDRAWAL_IN_FLIGHT'],
      [transactions, 'TX_PENDING'],
      [onramps, 'ONRAMP_IN_FLIGHT'],
      [offramps, 'OFFRAMP_IN_FLIGHT'],
      [etherfuseOrders, 'ETHERFUSE_ORDER_IN_FLIGHT'],
    ];

    return inFlight
      .filter(([count]) => count > 0)
      .map(([, code]) => ({ code, resolvable: false, action: null }));
  }

  /** DeFindex answers in asset units; the threshold is in whole units. */
  private toWholeUnits(units: number, assetDecimals: number): Decimal {
    return new Decimal(units).div(new Decimal(10).pow(assetDecimals));
  }
}
