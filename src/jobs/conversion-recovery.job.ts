import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConversionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';

/**
 * How long a confirmed conversion may sit without its deposit before it counts
 * as stranded.
 *
 * Long enough that a user simply taking their time signing the second
 * transaction is not flagged, short enough that a genuinely interrupted flow is
 * visible within the same session.
 */
const ORPHAN_AFTER_MS = 15 * 60 * 1000;

/**
 * Watches conversions that landed but never became a deposit.
 *
 * The user holds the converted asset — it is their money, in their account, not
 * lost — but from their side it is an unexplained balance. This job is what makes
 * that state observable; `GET /conversions/pending` is what lets the app offer to
 * finish it.
 *
 * It deliberately does not retry anything. Completing the deposit needs the
 * user's signature, so there is nothing a background job could do on its own
 * except move money without being asked.
 */
@Injectable()
export class ConversionRecoveryJob {
  private readonly logger = new Logger(ConversionRecoveryJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/5 * * * *')
  async sweep() {
    const [stranded, expired] = await Promise.all([
      this.flagStranded(),
      this.expireUnsigned(),
    ]);

    if (stranded > 0 || expired > 0) {
      this.logger.log(
        `Conversion sweep: ${stranded} awaiting their deposit, ${expired} expired unsigned`,
      );
    }
  }

  /**
   * Counts conversions whose deposit never happened.
   *
   * Only reports. The row itself is already the recovery record — it carries
   * `plannedDeposit` — so there is no state to advance here, only visibility to
   * provide.
   */
  private async flagStranded(): Promise<number> {
    const threshold = new Date(Date.now() - ORPHAN_AFTER_MS);

    const stranded = await this.prisma.assetConversion.findMany({
      where: {
        status: ConversionStatus.CONFIRMED,
        depositIntentId: null,
        plannedDeposit: { not: Prisma.DbNull },
        createdAt: { lt: threshold },
      },
      select: {
        id: true,
        userId: true,
        targetSymbol: true,
        receivedAmount: true,
      },
      take: 100,
    });

    for (const conversion of stranded) {
      this.logger.warn(
        `Conversion ${conversion.id} holds ${conversion.receivedAmount?.toString() ?? '?'} ` +
          `${conversion.targetSymbol} for user ${conversion.userId} with no deposit`,
      );
    }

    return stranded.length;
  }

  /**
   * Closes out conversions the user never authorized.
   *
   * Nothing moved on chain, so this only stops a dead intent looking actionable.
   * Statuses past signing are left alone: a submitted transaction either landed
   * or did not, and the time bound stops mattering once it is in flight.
   */
  private async expireUnsigned(): Promise<number> {
    const { count } = await this.prisma.assetConversion.updateMany({
      where: {
        status: {
          in: [ConversionStatus.CREATED, ConversionStatus.XDR_GENERATED],
        },
        expiresAt: { lt: new Date() },
      },
      data: {
        status: ConversionStatus.EXPIRED,
        failureCode: 'INTENT_EXPIRED',
      },
    });

    return count;
  }
}
