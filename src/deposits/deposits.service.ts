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
import { VaultRegistryService } from '../vault-registry/vault-registry.service';
import { DisclosureGuardService } from '../vault-registry/disclosure.guard.service';

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
  ) {}

  async createDeposit(dto: CreateDepositDto) {
    // Idempotency: return existing intent if key already used
    const existing = await this.prisma.depositIntent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { ...intentSelect, unsignedXdr: true },
    });
    if (existing) {
      this.logger.log(`Idempotent deposit hit: ${dto.idempotencyKey}`);
      return existing;
    }

    // The registry is the single answer to "is this vault usable", and it
    // distinguishes a delisted vault (404) from one with deposits frozen (409).
    const vault = await this.registry.assertDepositable(dto.vaultId);

    // No first deposit before the current risk disclosure is acknowledged. Checked
    // here, before anything is persisted and before any XDR is generated, so a
    // deposit the user is not allowed to make leaves no trace. The admin route
    // refuses to activate a vault without a published disclosure, so this is the
    // second of two independent gates rather than the only one.
    await this.disclosureGuard.assertAcknowledged(dto.userId, vault.id);

    if (dto.assetSymbol.toUpperCase() !== vault.assetSymbol.toUpperCase()) {
      throw new BadRequestException(
        `Vault ${dto.vaultId} accepts ${vault.assetSymbol}, not ${dto.assetSymbol}`,
      );
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
        },
      });
      throw err;
    }

    this.logger.log(`Deposit intent ${intent.id} created, XDR generated`);
    return { ...intent, unsignedXdr: xdr };
  }

  async submitSignedXdr(id: string, dto: SubmitSignedXdrDto) {
    const intent = await this.findIntentOrThrow(id);

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

    const { txHash } = await this.orchestrator.submitDeposit(id, dto.signedXdr);
    this.logger.log(`Deposit ${id} submitted to chain → txHash=${txHash}`);
    return { id, txHash, status: IntentStatus.SUBMITTED };
  }

  async getDeposit(id: string) {
    return this.findIntentOrThrow(id);
  }

  async listDeposits(userId: string) {
    const deposits = await this.prisma.depositIntent.findMany({
      where: { userId },
      select: {
        ...intentSelect,
        transaction: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return deposits.map(({ transaction, ...deposit }) => ({
      ...deposit,
      status:
        transaction?.status === 'CONFIRMED'
          ? IntentStatus.CONFIRMED
          : deposit.status,
    }));
  }

  private async findIntentOrThrow(id: string) {
    const intent = await this.prisma.depositIntent.findUnique({
      where: { id },
      select: { ...intentSelect, expiresAt: true },
    });
    if (!intent) throw new NotFoundException(`Deposit intent ${id} not found`);
    return intent;
  }
}
