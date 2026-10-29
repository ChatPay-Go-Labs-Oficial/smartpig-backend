import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GiftStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Antecedência do aviso de presente prestes a expirar. */
const EXPIRING_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Marks gifts past their expiry as EXPIRED. The sender reclaims the
 * on-chain balance themselves (trustless predicate); the reconciliation job
 * later flips EXPIRED → REFUNDED once the balance disappears from the ledger.
 * Runs every hour (mirrors ExpiredIntentsJob).
 */
@Injectable()
export class GiftExpiryJob {
  private readonly logger = new Logger(GiftExpiryJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async expireGifts() {
    const expired = await this.prisma.gift.updateMany({
      where: {
        status: { in: [GiftStatus.CREATED, GiftStatus.FUNDED] },
        expiresAt: { lt: new Date() },
      },
      data: {
        status: GiftStatus.EXPIRED,
        errorMessage: 'Gift expired without a claim',
      },
    });

    if (expired.count > 0) {
      this.logger.log(`Expired ${expired.count} gift(s)`);
    }
  }

  /**
   * Avisa quem enviou que o presente ainda não foi resgatado e expira em até
   * 24 h. Só FUNDED: um CREATED nunca chegou à rede, não há dinheiro em jogo.
   * Roda de hora em hora; o dedupeKey garante um único aviso por presente.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async warnExpiringGifts() {
    const now = Date.now();
    const expiring = await this.prisma.gift.findMany({
      where: {
        status: GiftStatus.FUNDED,
        expiresAt: {
          gt: new Date(now),
          lte: new Date(now + EXPIRING_WINDOW_MS),
        },
      },
      select: { id: true, senderUserId: true, amount: true, assetSymbol: true },
      orderBy: { expiresAt: 'asc' },
      take: 500,
    });

    for (const gift of expiring) {
      await this.notifications.notify({
        userId: gift.senderUserId,
        type: 'GIFT_EXPIRING',
        dedupeKey: `gift:${gift.id}:EXPIRING`,
        data: { giftId: gift.id },
        details: { amount: gift.amount, asset: gift.assetSymbol },
      });
    }
  }
}
