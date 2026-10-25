import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { IntentStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexOrchestrator } from '../defindex/defindex.orchestrator';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { SubmitSignedXdrDto } from './dto/submit-signed-xdr.dto';
import { toAssetUnits } from '../defindex/asset-amount';
import { classifyFailure } from '../defindex/failure-classifier';
import {
  normalizeTransactionState,
  type FailureCode,
} from '../defindex/transaction-state';
import { VaultRegistryService } from '../vault-registry/vault-registry.service';
import { DisclosureGuardService } from '../vault-registry/disclosure.guard.service';
import { ConversionsService } from '../conversions/conversions.service';
import { CreateDepositFromConversionDto } from './dto/from-conversion.dto';
import { VaultEligibilityService } from '../vault-eligibility/vault-eligibility.service';

const INTENT_TTL_HOURS = 24;

// Fields returned to the caller (never expose raw XDRs in list views)
const intentSelect = {
  id: true,
  idempotencyKey: true,
  userId: true,
  walletAccountId: true,
  vaultId: true,
  amount: true,
  assetSymbol: true,
  status: true,
  failureCode: true,
  errorMessage: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: DefindexOrchestrator,
    private readonly registry: VaultRegistryService,
    private readonly disclosureGuard: DisclosureGuardService,
    private readonly conversions: ConversionsService,
    private readonly vaultEligibility: VaultEligibilityService,
  ) {}

  async createDeposit(dto: CreateDepositDto) {
    // Idempotency: return existing intent if key already used
    const existing = await this.prisma.depositIntent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { ...intentSelect, unsignedXdr: true },
    });
    if (existing) {
      if (existing.userId !== dto.userId) {
        throw new ConflictException(
          'Idempotency key is already associated with another account',
        );
      }
      this.logger.log(`Idempotent deposit hit: ${dto.idempotencyKey}`);
      return existing;
    }

    // The registry is the single answer to "is this vault usable", and it
    // distinguishes a delisted vault (404) from one with deposits frozen (409).
    const vault = await this.registry.assertDepositable(dto.vaultId);

    // Education eligibility is independent from risk acknowledgment. It runs
    // before both disclosure and conversion planning so a locked Lite account
    // cannot create an intent or a conversion as a side effect. PRO is an
    // explicit bypass inside the policy service.
    await this.vaultEligibility.assertEligibleForDeposit(
      dto.userId,
      vault.id,
      vault.assetSymbol,
    );

    // Non-USDC vaults require acknowledgment of their current risk disclosure.
    // Checked here, before anything is persisted and before any XDR is generated,
    // so a blocked deposit leaves no trace. The exemption uses the registry asset,
    // never the asset symbol supplied by the client.
    await this.disclosureGuard.assertAcknowledged(
      dto.userId,
      vault.id,
      vault.assetSymbol,
    );

    if (dto.assetSymbol.toUpperCase() !== vault.assetSymbol.toUpperCase()) {
      // Without autoConvert this stays a flat rejection, so older clients behave
      // exactly as before.
      if (!dto.autoConvert) {
        throw new BadRequestException(
          `Vault ${dto.vaultId} accepts ${vault.assetSymbol}, not ${dto.assetSymbol}`,
        );
      }

      return this.planConversionFirst(dto, vault.assetSymbol);
    }

    // Validate precision and SDK numeric limits before persisting the intent.
    toAssetUnits(dto.amount, vault.assetDecimals);

    // Validate wallet belongs to the user
    const wallet = await this.prisma.walletAccount.findFirst({
      where: { id: dto.walletAccountId, userId: dto.userId, isActive: true },
      select: { id: true },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet ${dto.walletAccountId} not found for user ${dto.userId}`,
      );
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + INTENT_TTL_HOURS);

    // Create intent in CREATED state
    const intent = await this.prisma.depositIntent.create({
      data: {
        idempotencyKey: dto.idempotencyKey,
        userId: dto.userId,
        walletAccountId: dto.walletAccountId,
        vaultId: dto.vaultId,
        amount: new Decimal(dto.amount),
        assetSymbol: vault.assetSymbol,
        expiresAt,
      },
    });

    // Generate XDR via orchestrator (calls DeFindex SDK)
    let xdr: string | null = null;
    try {
      xdr = await this.orchestrator.buildDepositXdr(intent.id);
    } catch (err) {
      // Mark as failed so caller knows to retry with new idempotency key
      await this.prisma.depositIntent.update({
        where: { id: intent.id },
        data: {
          status: IntentStatus.FAILED,
          errorMessage: (err as Error).message,
          // Where it failed is the context the message lacks: a throw here is
          // always about building the XDR, whatever the upstream text says.
          failureCode: classifyFailure(err, 'XDR_GENERATION_FAILED'),
        },
      });
      throw err;
    }

    this.logger.log(`Deposit intent ${intent.id} created, XDR generated`);
    return { ...intent, unsignedXdr: xdr };
  }

  async submitSignedXdr(id: string, dto: SubmitSignedXdrDto, userId: string) {
    const intent = await this.findIntentOrThrow(id, userId);

    if (intent.status === IntentStatus.CONFIRMED) {
      throw new ConflictException(`Deposit ${id} already confirmed`);
    }
    if (intent.status === IntentStatus.SUBMITTED) {
      throw new ConflictException(`Deposit ${id} already submitted`);
    }
    if (intent.status === IntentStatus.FAILED) {
      throw new BadRequestException(`Deposit ${id} is in FAILED state`);
    }
    if (intent.status === IntentStatus.CREATED) {
      throw new BadRequestException(
        `Deposit ${id} has no XDR yet (status: CREATED)`,
      );
    }
    if (new Date() > intent.expiresAt) {
      throw new BadRequestException(`Deposit intent ${id} has expired`);
    }

    // The orchestrator reports what it actually wrote. This used to return a
    // hardcoded SUBMITTED even when the row had already reached CONFIRMED, which
    // left the client unable to distinguish "on chain" from "done".
    const { txHash, status } = await this.orchestrator.submitDeposit(
      id,
      dto.signedXdr,
    );
    this.logger.log(
      `Deposit ${id} submitted to chain → txHash=${txHash} status=${status}`,
    );
    return { id, txHash, status };
  }

  /**
   * The intent plus the client-facing state.
   *
   * `state` is the projection the app renders; the raw `status` stays for
   * backwards compatibility with the published build, which reads it. `txHash`
   * comes from the transaction record — without it a failed deposit gives
   * support nothing to look up.
   */
  async getDeposit(id: string, userId: string) {
    const intent = await this.prisma.depositIntent.findFirst({
      where: { id, userId },
      select: {
        ...intentSelect,
        transaction: { select: { status: true, txHash: true } },
      },
    });
    if (!intent) throw new NotFoundException(`Deposit intent ${id} not found`);

    const { transaction, ...rest } = intent;
    return {
      ...rest,
      txHash: transaction?.txHash ?? null,
      state: normalizeTransactionState({
        status: rest.status,
        expiresAt: rest.expiresAt,
        failureCode: rest.failureCode,
        txConfirmed: transaction?.status === 'CONFIRMED',
      }),
      failureCode: (rest.failureCode ?? null) as FailureCode | null,
    };
  }

  async listDeposits(userId: string) {
    const deposits = await this.prisma.depositIntent.findMany({
      where: { userId },
      select: {
        ...intentSelect,
        transaction: { select: { status: true, txHash: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return deposits.map(({ transaction, ...deposit }) => {
      const status =
        transaction?.status === 'CONFIRMED'
          ? IntentStatus.CONFIRMED
          : deposit.status;

      return {
        ...deposit,
        status,
        txHash: transaction?.txHash ?? null,
        // Same projection as the detail route, so history and detail can never
        // disagree about what the user is looking at.
        state: normalizeTransactionState({
          status,
          expiresAt: deposit.expiresAt,
          failureCode: deposit.failureCode,
          txConfirmed: transaction?.status === 'CONFIRMED',
        }),
        failureCode: (deposit.failureCode ?? null) as FailureCode | null,
      };
    });
  }

  /**
   * The steps that turn the funding asset into a deposit, without doing any of them.
   *
   * No `DepositIntent` is created here. Creating one would record an amount of an
   * asset the user does not hold yet, and the amount it would record is a quote
   * rather than what the conversion actually yields.
   *
   * The deposit step is deferred for a harder reason too: DeFindex simulates the
   * account state when it builds a deposit XDR, so generating it before the
   * conversion lands reads a zero balance and fails.
   */
  private async planConversionFirst(
    dto: CreateDepositDto,
    targetSymbol: string,
  ) {
    const conversion = await this.conversions.createConversion({
      // Derived from the deposit's key so a retry of the same deposit reuses the
      // same conversion instead of opening a second one.
      idempotencyKey: `conv:${dto.idempotencyKey}`,
      userId: dto.userId,
      walletAccountId: dto.walletAccountId,
      toSymbol: targetSymbol,
      amount: dto.amount,
      plannedDeposit: { vaultId: dto.vaultId, assetSymbol: targetSymbol },
    });

    const quoted = conversion as unknown as {
      id: string;
      unsignedXdr?: string | null;
      sendAmount: unknown;
      quotedDestAmount: unknown;
      destMin: unknown;
      sourceSymbol: string;
      targetSymbol: string;
    };

    return {
      plan: {
        steps: [
          {
            type: 'CONVERT' as const,
            id: quoted.id,
            unsignedXdr: quoted.unsignedXdr ?? null,
            quote: {
              send: String(quoted.sendAmount),
              sendAsset: quoted.sourceSymbol,
              estimatedReceive: String(quoted.quotedDestAmount),
              minReceive: String(quoted.destMin),
              receiveAsset: quoted.targetSymbol,
            },
          },
          {
            // Deferred on purpose: it can only be generated once the conversion
            // confirms, and it is sized by what actually arrived.
            type: 'DEPOSIT' as const,
            id: null,
            deferred: true as const,
            vaultId: dto.vaultId,
          },
        ],
      },
    };
  }

  /**
   * Creates the deposit a confirmed conversion was for.
   *
   * Sized by `receivedAmount`, floored to the asset's precision — the conversion
   * is a market operation and what arrived is rarely the quote. Flooring rather
   * than rounding keeps the deposit within what the user actually holds.
   */
  async createDepositFromConversion(
    userId: string,
    dto: CreateDepositFromConversionDto,
  ) {
    const existing = await this.prisma.depositIntent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { ...intentSelect, unsignedXdr: true },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new ConflictException(
          'Idempotency key is already associated with another account',
        );
      }
      return existing;
    }

    const conversion = await this.conversions.getConsumable(
      dto.conversionId,
      userId,
    );

    const vault = await this.registry.assertDepositable(conversion.vaultId);
    await this.vaultEligibility.assertEligibleForDeposit(
      userId,
      vault.id,
      vault.assetSymbol,
    );
    await this.disclosureGuard.assertAcknowledged(
      userId,
      vault.id,
      vault.assetSymbol,
    );

    const amount = conversion.receivedAmount.toDecimalPlaces(
      vault.assetDecimals,
      Decimal.ROUND_DOWN,
    );
    if (amount.lte(0)) {
      throw new BadRequestException(
        `Conversion ${dto.conversionId} yielded nothing to deposit`,
      );
    }

    const wallet = await this.prisma.walletAccount.findFirst({
      where: { id: dto.walletAccountId, userId, isActive: true },
      select: { id: true },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet ${dto.walletAccountId} not found for user ${userId}`,
      );
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + INTENT_TTL_HOURS);

    const intent = await this.prisma.depositIntent.create({
      data: {
        idempotencyKey: dto.idempotencyKey,
        userId,
        walletAccountId: wallet.id,
        vaultId: vault.id,
        amount,
        assetSymbol: vault.assetSymbol,
        expiresAt,
      },
    });

    // Linked before the XDR is generated: if that fails, the conversion is still
    // consumed and the user is not offered the same leftover balance twice.
    await this.conversions.attachDeposit(dto.conversionId, intent.id);

    let xdr: string | null = null;
    try {
      xdr = await this.orchestrator.buildDepositXdr(intent.id);
    } catch (err) {
      await this.prisma.depositIntent.update({
        where: { id: intent.id },
        data: {
          status: IntentStatus.FAILED,
          errorMessage: (err as Error).message,
          failureCode: classifyFailure(err, 'XDR_GENERATION_FAILED'),
        },
      });
      throw err;
    }

    this.logger.log(
      `Deposit ${intent.id} created from conversion ${dto.conversionId} (${amount.toString()} ${vault.assetSymbol})`,
    );

    return { ...intent, unsignedXdr: xdr };
  }

  /**
   * `userId` e o dono resolvido a partir do token. A busca e escopada por ele em
   * vez de checar depois, para que a resposta nao diferencie "nao existe" de
   * "nao e seu".
   */
  private async findIntentOrThrow(id: string, userId: string) {
    const intent = await this.prisma.depositIntent.findFirst({
      where: { id, userId },
      select: { ...intentSelect, expiresAt: true },
    });
    if (!intent) throw new NotFoundException(`Deposit intent ${id} not found`);
    return intent;
  }
}
