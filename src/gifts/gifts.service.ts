import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { GiftStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { GiftStellarService } from './gift-stellar.service';
import { CreateGiftDto } from './dto/create-gift.dto';
import { ClaimGiftDto } from './dto/claim-gift.dto';

// Fields returned to the caller. `code` is a bearer secret: it is only
// included for the sender (create/list of own sent gifts), never in the
// public preview.
const giftSelect = {
  id: true,
  senderUserId: true,
  recipientUserId: true,
  amount: true,
  assetSymbol: true,
  status: true,
  expiresAt: true,
  claimTxHash: true,
  createdAt: true,
  updatedAt: true,
};

const NOT_CLAIMABLE_MESSAGES: Partial<Record<GiftStatus, string>> = {
  [GiftStatus.CREATED]: 'Gift funding has not been confirmed yet',
  [GiftStatus.CLAIMING]: 'Gift claim is already in progress',
  [GiftStatus.CLAIMED]: 'Gift was already claimed',
  [GiftStatus.EXPIRED]: 'Gift has expired',
  [GiftStatus.REFUNDED]: 'Gift was returned to the sender',
};

@Injectable()
export class GiftsService {
  private readonly logger = new Logger(GiftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly stellar: GiftStellarService,
  ) {}

  async createGift(dto: CreateGiftDto) {
    // Idempotency: return existing gift if key already used
    const existing = await this.prisma.gift.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { ...giftSelect, code: true, memo: true },
    });
    if (existing) {
      this.logger.log(`Idempotent gift hit: ${dto.idempotencyKey}`);
      return {
        ...existing,
        claimAgentAddress: this.stellar.getAgentPublicKey(),
      };
    }

    const { canGift } = await this.getEligibility(dto.userId);
    if (!canGift) {
      throw new ForbiddenException(
        'Gifting is not enabled for this account yet',
      );
    }

    const amount = Number(dto.amount);
    const min = Number(this.config.get('GIFT_MIN_USD') ?? 1);
    const max = Number(this.config.get('GIFT_MAX_USD') ?? 100);
    if (!Number.isFinite(amount) || amount < min || amount > max) {
      throw new BadRequestException(
        `Gift amount must be between ${min} and ${max} USDC`,
      );
    }

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

    // Anti-abuse: cap concurrently pending gifts per sender
    const maxPending = Number(
      this.config.get('GIFT_MAX_PENDING_PER_USER') ?? 5,
    );
    const pendingCount = await this.prisma.gift.count({
      where: {
        senderUserId: dto.userId,
        status: { in: [GiftStatus.CREATED, GiftStatus.FUNDED] },
      },
    });
    if (pendingCount >= maxPending) {
      throw new ConflictException(
        `You already have ${pendingCount} pending gift(s); wait for them to be claimed or expire`,
      );
    }

    const expiryDays = Number(this.config.get('GIFT_EXPIRY_DAYS') ?? 7);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    const gift = await this.prisma.gift.create({
      data: {
        idempotencyKey: dto.idempotencyKey,
        // Bearer secret shared via the install-referrer link (128 bits)
        code: randomBytes(16).toString('base64url'),
        senderUserId: dto.userId,
        senderWalletId: dto.walletAccountId,
        amount: new Decimal(dto.amount),
        // On-chain correlation id (NOT secret; <=28 bytes for a text memo)
        memo: `gift:${randomBytes(8).toString('hex')}`,
        expiresAt,
      },
      select: { ...giftSelect, code: true, memo: true },
    });

    this.logger.log(
      `Gift ${gift.id} created (expires ${expiresAt.toISOString()})`,
    );
    return { ...gift, claimAgentAddress: this.stellar.getAgentPublicKey() };
  }

  /**
   * Founder gate: while GIFT_ALLOWED_EMAILS is set, only those emails can
   * send gifts. Empty/absent list = gifting enabled for everyone (rollout is
   * just clearing the env var).
   */
  async getEligibility(userId: string): Promise<{ canGift: boolean }> {
    const raw = (this.config.get<string>('GIFT_ALLOWED_EMAILS') ?? '').trim();
    if (!raw) return { canGift: true };

    const allowed = raw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const canGift = Boolean(
      user?.email && allowed.includes(user.email.toLowerCase()),
    );
    return { canGift };
  }

  /** Public preview — never expose internal ids, addresses or the balanceId. */
  async getGiftByCode(code: string) {
    const gift = await this.prisma.gift.findUnique({
      where: { code },
      select: {
        amount: true,
        assetSymbol: true,
        status: true,
        expiresAt: true,
        sender: { select: { name: true } },
      },
    });
    if (!gift) throw new NotFoundException('Gift not found');
    return {
      amount: gift.amount,
      assetSymbol: gift.assetSymbol,
      status: gift.status,
      expiresAt: gift.expiresAt,
      senderName: gift.sender.name,
    };
  }

  async claimGift(code: string, dto: ClaimGiftDto) {
    const gift = await this.prisma.gift.findUnique({ where: { code } });
    if (!gift) throw new NotFoundException('Gift not found');

    if (new Date() > gift.expiresAt) {
      await this.prisma.gift.updateMany({
        where: {
          id: gift.id,
          status: { in: [GiftStatus.CREATED, GiftStatus.FUNDED] },
        },
        data: {
          status: GiftStatus.EXPIRED,
          errorMessage: 'Gift expired without a claim',
        },
      });
      throw new GoneException('Gift has expired');
    }

    if (gift.status !== GiftStatus.FUNDED) {
      throw new ConflictException(
        NOT_CLAIMABLE_MESSAGES[gift.status] ??
          `Gift is not claimable (status ${gift.status})`,
      );
    }

    if (gift.senderUserId === dto.userId) {
      throw new ForbiddenException('You cannot claim your own gift');
    }

    // Gifts are an acquisition tool: only accounts created AFTER the gift qualify
    const recipient = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { createdAt: true },
    });
    if (!recipient) throw new NotFoundException(`User ${dto.userId} not found`);
    if (recipient.createdAt <= gift.createdAt) {
      throw new ForbiddenException(
        'Gifts can only be claimed by accounts created after the gift',
      );
    }

    const wallet = await this.prisma.walletAccount.findFirst({
      where: { id: dto.walletAccountId, userId: dto.userId, isActive: true },
      select: { stellarAddress: true },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet ${dto.walletAccountId} not found for user ${dto.userId}`,
      );
    }
    if (wallet.stellarAddress !== dto.stellarAddress) {
      throw new BadRequestException(
        'stellarAddress does not match the wallet account',
      );
    }
    if (!gift.balanceId) {
      throw new ConflictException('Gift funding has not been confirmed yet');
    }

    // One-shot lock: FUNDED → CLAIMING guarded by a conditional update
    const locked = await this.prisma.gift.updateMany({
      where: { id: gift.id, status: GiftStatus.FUNDED },
      data: { status: GiftStatus.CLAIMING, recipientUserId: dto.userId },
    });
    if (locked.count === 0) {
      throw new ConflictException('Gift is already being claimed');
    }

    try {
      const { hash } = await this.stellar.claimAndPay(
        gift.balanceId,
        wallet.stellarAddress,
        gift.amount.toString(),
      );
      const claimed = await this.prisma.gift.update({
        where: { id: gift.id },
        data: { status: GiftStatus.CLAIMED, claimTxHash: hash },
        select: giftSelect,
      });
      this.logger.log(`Gift ${gift.id} claimed by ${dto.userId} → tx ${hash}`);
      return claimed;
    } catch (err) {
      // Revert the lock so the recipient can retry
      await this.prisma.gift.updateMany({
        where: { id: gift.id, status: GiftStatus.CLAIMING },
        data: {
          status: GiftStatus.FUNDED,
          recipientUserId: null,
          errorMessage: (err as Error).message,
        },
      });
      this.logger.error(
        `Gift ${gift.id} claim failed: ${(err as Error).message}`,
      );
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException(
        'Failed to deliver the gift on-chain; please try again',
      );
    }
  }

  async listGifts(userId: string) {
    const gifts = await this.prisma.gift.findMany({
      where: {
        OR: [{ senderUserId: userId }, { recipientUserId: userId }],
      },
      // code + balanceId are needed by the SENDER (share link / reclaim after
      // expiry) and stripped from received rows below
      select: { ...giftSelect, code: true, balanceId: true },
      orderBy: { createdAt: 'desc' },
    });

    return gifts.map((gift) =>
      gift.senderUserId === userId
        ? { ...gift, direction: 'sent' as const }
        : {
            ...gift,
            code: null,
            balanceId: null,
            direction: 'received' as const,
          },
    );
  }
}
