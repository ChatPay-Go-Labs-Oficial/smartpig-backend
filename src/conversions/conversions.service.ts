import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversionStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../infra/prisma/prisma.service';
import { StellarService } from '../wallets/stellar.service';
import { TrustlinesService } from '../wallets/trustlines.service';
import { classifyFailure } from '../defindex/failure-classifier';
import { assetIdOf } from '../config/asset-registry';
import { QuoteService } from './quote.service';
import { toPathAssets } from './path-mapper';
import { VaultEligibilityService } from '../vault-eligibility/vault-eligibility.service';

/**
 * How long a conversion intent may be signed.
 *
 * Shorter than the transaction's 600s time bound so a signature never arrives
 * after the window closed. Longer than the quote's 60s because `destMin`, not the
 * quote, is what protects the user once the XDR exists.
 */
const CONVERSION_TTL_MS = 8 * 60 * 1000;

export type ConversionMode = 'DEX' | 'DISABLED';

export interface PlannedDeposit {
  vaultId: string;
  assetSymbol: string;
}

@Injectable()
export class ConversionsService {
  private readonly logger = new Logger(ConversionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly stellar: StellarService,
    private readonly quotes: QuoteService,
    private readonly trustlines: TrustlinesService,
    private readonly vaultEligibility: VaultEligibilityService,
  ) {}

  /**
   * `DISABLED` is the honest degradation when a pair has no usable market: the
   * vault stays listed and withdrawable with `depositsEnabled: false`, rather
   * than offering a conversion that cannot complete.
   */
  get mode(): ConversionMode {
    return this.config.get<string>('CONVERSION_MODE', 'DEX') === 'DISABLED'
      ? 'DISABLED'
      : 'DEX';
  }

  private assertEnabled() {
    if (this.mode === 'DISABLED') {
      throw new ServiceUnavailableException({
        message: 'Asset conversion is turned off on this deployment',
        code: 'CONVERSION_DISABLED',
      });
    }
  }

  /** Prices a conversion without creating anything. */
  async quote(params: {
    fromSymbol?: string;
    toSymbol: string;
    amount: string;
  }) {
    this.assertEnabled();

    const sourceAsset = params.fromSymbol
      ? this.stellar.getAsset(params.fromSymbol)
      : this.stellar.getFundingAsset();
    const targetAsset = this.stellar.getAsset(params.toSymbol);

    if (sourceAsset.symbol === targetAsset.symbol) {
      throw new BadRequestException(
        `${targetAsset.symbol} needs no conversion`,
      );
    }

    const quote = await this.quotes.quote({
      sourceAsset,
      targetAsset,
      sendAmount: params.amount,
    });

    return {
      sourceSymbol: sourceAsset.symbol,
      targetSymbol: targetAsset.symbol,
      sendAmount: quote.sendAmount,
      estimatedReceive: quote.destAmount,
      minReceive: quote.destMin,
      slippageBps: quote.slippageBps,
      path: quote.pathDescription,
      expiresAt: quote.expiresAt,
    };
  }

  /**
   * Creates a conversion intent and the XDR for the user to authorize.
   *
   * `plannedDeposit` is recorded up front so a conversion that lands without its
   * deposit is resumable rather than a mystery balance.
   */
  async createConversion(params: {
    idempotencyKey: string;
    userId: string;
    walletAccountId: string;
    fromSymbol?: string;
    toSymbol: string;
    amount: string;
    plannedDeposit?: PlannedDeposit;
  }) {
    this.assertEnabled();

    const existing = await this.prisma.assetConversion.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
      select: this.intentSelect(),
    });
    if (existing) {
      this.logger.log(`Idempotent conversion hit: ${params.idempotencyKey}`);
      return existing;
    }

    const wallet = await this.prisma.walletAccount.findFirst({
      where: {
        id: params.walletAccountId,
        userId: params.userId,
        isActive: true,
      },
      select: { id: true, stellarAddress: true },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet ${params.walletAccountId} not found for user ${params.userId}`,
      );
    }

    const sourceAsset = params.fromSymbol
      ? this.stellar.getAsset(params.fromSymbol)
      : this.stellar.getFundingAsset();
    const targetAsset = this.stellar.getAsset(params.toSymbol);
    if (sourceAsset.symbol === targetAsset.symbol) {
      throw new BadRequestException(
        `${targetAsset.symbol} needs no conversion`,
      );
    }

    // Lite unlocks govern both saving and acquiring the advanced currency.
    // Quotes remain public/read-only; the check happens before an operation is
    // created or a trustline/XDR is requested.
    if (targetAsset.symbol !== 'USDC') {
      const targetVault = params.plannedDeposit?.vaultId
        ? await this.prisma.vaultCatalog.findFirst({
            where: {
              id: params.plannedDeposit.vaultId,
              assetSymbol: targetAsset.symbol,
              isActive: true,
            },
            select: { id: true },
          })
        : await this.prisma.vaultCatalog.findFirst({
            where: { assetSymbol: targetAsset.symbol, isActive: true },
            orderBy: { displayOrder: 'asc' },
            select: { id: true },
          });
      if (!targetVault) {
        throw new NotFoundException(
          `Active ${targetAsset.symbol} vault not found for conversion eligibility`,
        );
      }
      await this.vaultEligibility.assertEligibleForDeposit(
        params.userId,
        targetVault.id,
        targetAsset.symbol,
      );
    }

    // The target asset has to be receivable before we move anything into it:
    // without a trustline the payment fails with op_no_trust.
    const trustline = await this.trustlines.ensureTrustline({
      userId: params.userId,
      walletAccountId: wallet.id,
      assetSymbol: targetAsset.symbol,
    });
    if (trustline.required) {
      throw new ConflictException({
        message: `A ${targetAsset.symbol} trustline must be active before converting into it`,
        code: 'TRUSTLINE_REQUIRED',
        details: {
          assetSymbol: targetAsset.symbol,
          assetId: trustline.assetId,
          unsignedXdr: trustline.unsignedXdr,
        },
      });
    }

    const quote = await this.quotes.quote({
      sourceAsset,
      targetAsset,
      sendAmount: params.amount,
    });

    const expiresAt = new Date(Date.now() + CONVERSION_TTL_MS);

    const conversion = await this.prisma.assetConversion.create({
      data: {
        idempotencyKey: params.idempotencyKey,
        userId: params.userId,
        walletAccountId: wallet.id,
        sourceAssetId: assetIdOf(sourceAsset),
        targetAssetId: assetIdOf(targetAsset),
        sourceSymbol: sourceAsset.symbol,
        targetSymbol: targetAsset.symbol,
        sendAmount: new Decimal(quote.sendAmount),
        quotedDestAmount: new Decimal(quote.destAmount),
        destMin: new Decimal(quote.destMin),
        slippageBps: quote.slippageBps,
        path: quote.path as unknown as Prisma.InputJsonValue,
        plannedDeposit: params.plannedDeposit
          ? (params.plannedDeposit as unknown as Prisma.InputJsonValue)
          : undefined,
        expiresAt,
      },
      select: { id: true },
    });

    let unsignedXdr: string;
    try {
      unsignedXdr = await this.stellar.buildPathPaymentXdr({
        userAddress: wallet.stellarAddress,
        sendAsset: this.stellar.toStellarAsset(sourceAsset),
        sendAmount: quote.sendAmount,
        destAsset: this.stellar.toStellarAsset(targetAsset),
        destMin: quote.destMin,
        path: toPathAssets(quote.path),
      });
    } catch (err) {
      await this.fail(conversion.id, err, 'XDR_GENERATION_FAILED', 'build-xdr');
      throw err;
    }

    return this.prisma.assetConversion.update({
      where: { id: conversion.id },
      data: { unsignedXdr, status: ConversionStatus.XDR_GENERATED },
      select: { ...this.intentSelect(), unsignedXdr: true },
    });
  }

  /**
   * Submits the signed conversion and records what actually arrived.
   *
   * `receivedAmount` comes from the transaction effects, never from the quote: the
   * deposit that follows is sized by what landed.
   */
  async submitConversion(params: {
    id: string;
    userId: string;
    signedXdr: string;
  }) {
    const conversion = await this.findOwnedOrThrow(params.id, params.userId);

    if (conversion.status === ConversionStatus.CONFIRMED) {
      throw new ConflictException(`Conversion ${params.id} already confirmed`);
    }
    if (conversion.status === ConversionStatus.SUBMITTED) {
      throw new ConflictException(`Conversion ${params.id} already submitted`);
    }
    if (conversion.status === ConversionStatus.FAILED) {
      throw new BadRequestException(
        `Conversion ${params.id} is in FAILED state`,
      );
    }
    if (!conversion.unsignedXdr) {
      throw new BadRequestException(`Conversion ${params.id} has no XDR yet`);
    }
    if (new Date() > conversion.expiresAt) {
      await this.fail(
        conversion.id,
        new Error('Conversion intent has expired'),
        'INTENT_EXPIRED',
        'validate-expiry',
      );
      throw new BadRequestException(`Conversion ${params.id} has expired`);
    }

    await this.prisma.assetConversion.update({
      where: { id: conversion.id },
      data: {
        signedXdr: params.signedXdr,
        status: ConversionStatus.SIGNED_XDR_RECEIVED,
      },
    });

    let txHash: string;
    try {
      const result = await this.stellar.submitFeeBumpTransaction(
        params.signedXdr,
        conversion.unsignedXdr,
      );
      txHash = result.hash;
    } catch (err) {
      await this.fail(
        conversion.id,
        err,
        'CHAIN_REJECTED',
        'submit-signed-xdr',
      );
      throw err;
    }

    const targetAsset = this.stellar.getAsset(conversion.targetSymbol);
    const received = await this.stellar.readPathPaymentReceived(
      txHash,
      conversion.walletAddress,
      this.stellar.toStellarAsset(targetAsset),
    );

    const updated = await this.prisma.assetConversion.update({
      where: { id: conversion.id },
      data: {
        status: ConversionStatus.CONFIRMED,
        txHash,
        receivedAmount: received ?? undefined,
      },
      select: { ...this.intentSelect(), txHash: true },
    });

    this.logger.log(
      `Conversion ${conversion.id} confirmed → tx=${txHash} received=${received?.toString() ?? 'unread'}`,
    );

    return updated;
  }

  /**
   * Conversions that landed but whose deposit never happened.
   *
   * The user holds the converted asset and still owes the deposit. Surfacing this
   * is what keeps the balance from looking like a mystery.
   */
  async listPending(userId: string) {
    return this.prisma.assetConversion.findMany({
      where: {
        userId,
        status: ConversionStatus.CONFIRMED,
        depositIntentId: null,
        plannedDeposit: { not: Prisma.DbNull },
      },
      select: {
        ...this.intentSelect(),
        txHash: true,
        plannedDeposit: true,
        receivedAmount: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A confirmed conversion that is still owed its deposit.
   *
   * Every rejection here is a different situation the caller must not confuse:
   * not confirmed yet, already consumed, or no planned vault to deposit into. A
   * conversion whose received amount could not be read is also refused — sizing a
   * deposit from the quote would claim an amount the user may not hold.
   */
  async getConsumable(
    id: string,
    userId: string,
  ): Promise<{
    id: string;
    vaultId: string;
    targetSymbol: string;
    receivedAmount: Decimal;
  }> {
    const conversion = await this.prisma.assetConversion.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        status: true,
        targetSymbol: true,
        receivedAmount: true,
        depositIntentId: true,
        plannedDeposit: true,
      },
    });

    if (!conversion || conversion.userId !== userId) {
      throw new NotFoundException(`Conversion ${id} not found`);
    }

    if (conversion.status !== ConversionStatus.CONFIRMED) {
      throw new ConflictException({
        message: `Conversion ${id} is ${conversion.status}, not confirmed`,
        code: 'CONVERSION_NOT_CONFIRMED',
        details: { conversionId: id, status: conversion.status },
      });
    }

    if (conversion.depositIntentId) {
      throw new ConflictException({
        message: `Conversion ${id} was already deposited`,
        code: 'CONVERSION_ALREADY_CONSUMED',
        details: {
          conversionId: id,
          depositIntentId: conversion.depositIntentId,
        },
      });
    }

    const planned = conversion.plannedDeposit as { vaultId?: string } | null;
    if (!planned?.vaultId) {
      throw new BadRequestException(
        `Conversion ${id} has no planned deposit to complete`,
      );
    }

    if (!conversion.receivedAmount) {
      throw new ConflictException({
        message: `The amount received by conversion ${id} is unknown; it cannot size a deposit`,
        code: 'CONVERSION_AMOUNT_UNKNOWN',
        details: { conversionId: id },
      });
    }

    return {
      id: conversion.id,
      vaultId: planned.vaultId,
      targetSymbol: conversion.targetSymbol,
      receivedAmount: conversion.receivedAmount,
    };
  }

  /** Links a conversion to the deposit it funded, so it stops being pending. */
  async attachDeposit(conversionId: string, depositIntentId: string) {
    await this.prisma.assetConversion.update({
      where: { id: conversionId },
      data: { depositIntentId },
    });
  }

  /**
   * Loads a conversion and asserts it belongs to the caller.
   *
   * `walletAccountId` is a scalar with no foreign key — the same choice
   * `AccountDeletionRequest` makes for `userId` — so the address is fetched
   * separately rather than joined.
   */
  private async findOwnedOrThrow(id: string, userId: string) {
    const conversion = await this.prisma.assetConversion.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        walletAccountId: true,
        status: true,
        unsignedXdr: true,
        expiresAt: true,
        targetSymbol: true,
      },
    });

    if (!conversion || conversion.userId !== userId) {
      throw new NotFoundException(`Conversion ${id} not found`);
    }

    const wallet = await this.prisma.walletAccount.findUnique({
      where: { id: conversion.walletAccountId },
      select: { stellarAddress: true },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet ${conversion.walletAccountId} no longer exists`,
      );
    }

    return { ...conversion, walletAddress: wallet.stellarAddress };
  }

  private async fail(
    id: string,
    err: unknown,
    fallback: string,
    stage = fallback,
  ) {
    const failureCode = classifyFailure(err, fallback as never);
    this.logger.warn(
      `Conversion ${id} failed stage=${stage} code=${failureCode}: ${safeFailureReason(err)}`,
    );
    await this.prisma.assetConversion.update({
      where: { id },
      data: {
        status: ConversionStatus.FAILED,
        failureCode,
        errorMessage: (err as Error)?.message ?? String(err),
      },
    });
  }

  /** Never exposes raw XDRs in list views. */
  private intentSelect() {
    return {
      id: true,
      idempotencyKey: true,
      userId: true,
      walletAccountId: true,
      sourceSymbol: true,
      targetSymbol: true,
      sendAmount: true,
      quotedDestAmount: true,
      destMin: true,
      slippageBps: true,
      status: true,
      failureCode: true,
      expiresAt: true,
      createdAt: true,
    } as const;
  }
}

function safeFailureReason(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'unknown error';
  return message
    .replace(/[GC][A-Z2-7]{55}/g, '[stellar-id]')
    .replace(/[A-Za-z0-9+/=]{100,}/g, '[redacted]')
    .slice(0, 300);
}
