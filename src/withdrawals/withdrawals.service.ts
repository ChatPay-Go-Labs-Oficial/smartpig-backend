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
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { SubmitSignedXdrDto } from './dto/submit-signed-xdr.dto';
import {
  DEFINDEX_SHARE_DECIMALS,
  toAssetUnits,
} from '../defindex/asset-amount';
import { classifyFailure } from '../defindex/failure-classifier';
import {
  normalizeTransactionState,
  type FailureCode,
} from '../defindex/transaction-state';

const INTENT_TTL_HOURS = 24;

const intentSelect = {
  id: true,
  idempotencyKey: true,
  userId: true,
  walletAccountId: true,
  vaultId: true,
  shareAmount: true,
  requestedAmount: true,
  status: true,
  failureCode: true,
  errorMessage: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: DefindexOrchestrator,
  ) {}

  async createWithdrawal(dto: CreateWithdrawalDto) {
    // Idempotency check
    const existing = await this.prisma.withdrawalIntent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { ...intentSelect, unsignedXdr: true },
    });
    if (existing) {
      this.logger.log(`Idempotent withdrawal hit: ${dto.idempotencyKey}`);
      return existing;
    }

    // Validate vault
    const vault = await this.prisma.vaultCatalog.findUnique({
      where: { id: dto.vaultId },
      select: { id: true, isActive: true },
    });
    if (!vault || !vault.isActive) {
      throw new NotFoundException(`Vault ${dto.vaultId} not found or inactive`);
    }

    // Validate wallet belongs to user
    const wallet = await this.prisma.walletAccount.findFirst({
      where: { id: dto.walletAccountId, userId: dto.userId, isActive: true },
      select: { id: true },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet ${dto.walletAccountId} not found for user ${dto.userId}`,
      );
    }

    // DeFindex vault shares always use 7 decimal places.
    toAssetUnits(dto.shareAmount, DEFINDEX_SHARE_DECIMALS);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + INTENT_TTL_HOURS);

    const intent = await this.prisma.withdrawalIntent.create({
      data: {
        idempotencyKey: dto.idempotencyKey,
        userId: dto.userId,
        walletAccountId: dto.walletAccountId,
        vaultId: dto.vaultId,
        shareAmount: new Decimal(dto.shareAmount),
        requestedAmount: dto.requestedAmount
          ? new Decimal(dto.requestedAmount)
          : undefined,
        expiresAt,
      },
    });

    let xdr: string | null = null;
    try {
      xdr = await this.orchestrator.buildWithdrawXdr(intent.id);
    } catch (err) {
      await this.prisma.withdrawalIntent.update({
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

    this.logger.log(`Withdrawal intent ${intent.id} created, XDR generated`);
    return { ...intent, unsignedXdr: xdr };
  }

  async submitSignedXdr(id: string, dto: SubmitSignedXdrDto, userId: string) {
    const intent = await this.findIntentOrThrow(id, userId);

    if (intent.status === IntentStatus.CONFIRMED) {
      throw new ConflictException(`Withdrawal ${id} already confirmed`);
    }
    if (intent.status === IntentStatus.SUBMITTED) {
      throw new ConflictException(`Withdrawal ${id} already submitted`);
    }
    if (intent.status === IntentStatus.FAILED) {
      throw new BadRequestException(`Withdrawal ${id} is in FAILED state`);
    }
    if (intent.status === IntentStatus.CREATED) {
      throw new BadRequestException(
        `Withdrawal ${id} has no XDR yet (status: CREATED)`,
      );
    }
    if (new Date() > intent.expiresAt) {
      throw new BadRequestException(`Withdrawal intent ${id} has expired`);
    }

    // The orchestrator reports what it actually wrote. This used to return a
    // hardcoded SUBMITTED even when the row had already reached CONFIRMED, which
    // left the client unable to distinguish "on chain" from "done".
    const { txHash, status } = await this.orchestrator.submitWithdrawal(
      id,
      dto.signedXdr,
    );
    this.logger.log(`Withdrawal ${id} submitted to chain → txHash=${txHash}`);
    return { id, txHash, status };
  }

  /**
   * The intent plus the client-facing state.
   *
   * `state` is the projection the app renders; the raw `status` stays for
   * backwards compatibility with the published build, which reads it. `txHash`
   * comes from the transaction record — without it a failed withdrawal gives
   * support nothing to look up.
   */
  async getWithdrawal(id: string, userId: string) {
    const intent = await this.prisma.withdrawalIntent.findFirst({
      where: { id, userId },
      select: {
        ...intentSelect,
        transaction: { select: { status: true, txHash: true } },
      },
    });
    if (!intent)
      throw new NotFoundException(`Withdrawal intent ${id} not found`);

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

  async listWithdrawals(userId: string) {
    const withdrawals = await this.prisma.withdrawalIntent.findMany({
      where: { userId },
      select: {
        ...intentSelect,
        transaction: { select: { status: true, txHash: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return withdrawals.map(({ transaction, ...withdrawal }) => {
      const status =
        transaction?.status === 'CONFIRMED'
          ? IntentStatus.CONFIRMED
          : withdrawal.status;

      return {
        ...withdrawal,
        status,
        txHash: transaction?.txHash ?? null,
        // Same projection as the detail route, so history and detail can never
        // disagree about what the user is looking at.
        state: normalizeTransactionState({
          status,
          expiresAt: withdrawal.expiresAt,
          failureCode: withdrawal.failureCode,
          txConfirmed: transaction?.status === 'CONFIRMED',
        }),
        failureCode: (withdrawal.failureCode ?? null) as FailureCode | null,
      };
    });
  }

  /**
   * `userId` e o dono resolvido a partir do token. A busca e escopada por ele em
   * vez de checar depois, para que a resposta nao diferencie "nao existe" de
   * "nao e seu".
   */
  private async findIntentOrThrow(id: string, userId: string) {
    const intent = await this.prisma.withdrawalIntent.findFirst({
      where: { id, userId },
      select: { ...intentSelect, expiresAt: true },
    });
    if (!intent)
      throw new NotFoundException(`Withdrawal intent ${id} not found`);
    return intent;
  }
}
