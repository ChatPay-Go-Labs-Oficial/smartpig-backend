import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GiftStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';

/**
 * Marks gifts past their expiry as EXPIRED. The sender reclaims the
 * on-chain balance themselves (trustless predicate); the reconciliation job
 * later flips EXPIRED → REFUNDED once the balance disappears from the ledger.
 * Runs every hour (mirrors ExpiredIntentsJob).
 */
@Injectable()
export class GiftExpiryJob {
  private readonly logger = new Logger(GiftExpiryJob.name);

  constructor(private readonly prisma: PrismaService) {}

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
}
