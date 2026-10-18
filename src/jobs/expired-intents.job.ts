import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IntentStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';

/**
 * Marks expired intents (CREATED or XDR_GENERATED) as FAILED,
 * and purges very old FAILED intents to keep the table lean.
 * Runs every hour.
 */
@Injectable()
export class ExpiredIntentsJob {
  private readonly logger = new Logger(ExpiredIntentsJob.name);

  // Purge FAILED intents older than 30 days
  private readonly PURGE_AFTER_DAYS = 30;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredIntents() {
    const now = new Date();
    const purgeThreshold = new Date();
    purgeThreshold.setDate(purgeThreshold.getDate() - this.PURGE_AFTER_DAYS);

    const expirableStatuses = [
      IntentStatus.CREATED,
      IntentStatus.XDR_GENERATED,
    ];

    // Mark expired-but-not-yet-failed intents
    const [expiredDeposits, expiredWithdrawals] = await Promise.all([
      this.prisma.depositIntent.updateMany({
        where: { status: { in: expirableStatuses }, expiresAt: { lt: now } },
        data: { status: IntentStatus.FAILED, errorMessage: 'Intent expired' },
      }),
      this.prisma.withdrawalIntent.updateMany({
        where: { status: { in: expirableStatuses }, expiresAt: { lt: now } },
        data: { status: IntentStatus.FAILED, errorMessage: 'Intent expired' },
      }),
    ]);

    const totalExpired = expiredDeposits.count + expiredWithdrawals.count;
    if (totalExpired > 0) {
      this.logger.log(
        `Expired ${totalExpired} intent(s) (deposits: ${expiredDeposits.count}, withdrawals: ${expiredWithdrawals.count})`,
      );
    }

    // Purge old failed intents that have no linked transaction
    const [purgedDeposits, purgedWithdrawals] = await Promise.all([
      this.prisma.depositIntent.deleteMany({
        where: {
          status: IntentStatus.FAILED,
          updatedAt: { lt: purgeThreshold },
          transaction: null,
        },
      }),
      this.prisma.withdrawalIntent.deleteMany({
        where: {
          status: IntentStatus.FAILED,
          updatedAt: { lt: purgeThreshold },
          transaction: null,
        },
      }),
    ]);

    const totalPurged = purgedDeposits.count + purgedWithdrawals.count;
    if (totalPurged > 0) {
      this.logger.log(`Purged ${totalPurged} old failed intent(s)`);
    }
  }
}
