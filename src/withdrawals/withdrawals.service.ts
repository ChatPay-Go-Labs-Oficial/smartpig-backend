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

const INTENT_TTL_HOURS = 24;

const intentSelect = {
  id: true,
  idempotencyKey: true,
  userId: true,
  walletAccountId: true,
  vaultId: true,
  shareAmount: true,
  status: true,
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

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + INTENT_TTL_HOURS);

    const intent = await this.prisma.withdrawalIntent.create({
      data: {
        idempotencyKey: dto.idempotencyKey,
        userId: dto.userId,
        walletAccountId: dto.walletAccountId,
        vaultId: dto.vaultId,
        shareAmount: new Decimal(dto.shareAmount),
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
        },
      });
      throw err;
    }

    this.logger.log(`Withdrawal intent ${intent.id} created, XDR generated`);
    return { ...intent, unsignedXdr: xdr };
  }

  async submitSignedXdr(id: string, dto: SubmitSignedXdrDto) {
    const intent = await this.findIntentOrThrow(id);

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

    const { txHash } = await this.orchestrator.submitWithdrawal(id, dto.signedXdr);
    this.logger.log(`Withdrawal ${id} submitted to chain → txHash=${txHash}`);
    return { id, txHash, status: IntentStatus.SUBMITTED };
  }

  async getWithdrawal(id: string) {
    return this.findIntentOrThrow(id);
  }

  async listWithdrawals(userId: string) {
    return this.prisma.withdrawalIntent.findMany({
      where: { userId },
      select: intentSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findIntentOrThrow(id: string) {
    const intent = await this.prisma.withdrawalIntent.findUnique({
      where: { id },
      select: { ...intentSelect, expiresAt: true },
    });
    if (!intent) throw new NotFoundException(`Withdrawal intent ${id} not found`);
    return intent;
  }
}
