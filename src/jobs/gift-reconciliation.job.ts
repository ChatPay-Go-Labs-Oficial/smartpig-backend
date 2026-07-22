import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { GiftStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { GiftStellarService } from '../gifts/gift-stellar.service';

/**
 * Reconciles gift funding and refunds against the Stellar ledger:
 * - CREATED gifts: matches new claimable balances (agent as claimant) to the
 *   gift via the funding transaction memo and marks them FUNDED.
 * - EXPIRED gifts: when the claimable balance is gone, the sender reclaimed
 *   it → mark REFUNDED.
 */
@Injectable()
export class GiftReconciliationJob {
  private readonly logger = new Logger(GiftReconciliationJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: GiftStellarService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcileGifts() {
    if (!this.stellar.isConfigured()) return;

    await this.fundPendingGifts();
    await this.detectRefunds();
  }

  private async fundPendingGifts() {
    const pending = await this.prisma.gift.findMany({
      where: { status: GiftStatus.CREATED },
      select: { id: true, memo: true, amount: true },
      take: 50,
    });
    if (pending.length === 0) return;

    let balances;
    try {
      balances = await this.stellar.listAgentClaimableBalances();
    } catch (err) {
      this.logger.warn(
        `Unable to list agent claimable balances: ${(err as Error).message}`,
      );
      return;
    }
    if (balances.length === 0) return;

    const known = await this.prisma.gift.findMany({
      where: { balanceId: { in: balances.map((b) => b.balanceId) } },
      select: { balanceId: true },
    });
    const knownIds = new Set(known.map((k) => k.balanceId));
    const pendingByMemo = new Map(pending.map((gift) => [gift.memo, gift]));

    for (const balance of balances) {
      if (knownIds.has(balance.balanceId)) continue;
      try {
        const fundingTx = await this.stellar.getBalanceFundingTx(
          balance.balanceId,
        );
        const gift = fundingTx?.memo
          ? pendingByMemo.get(fundingTx.memo)
          : undefined;
        if (!gift || !fundingTx) continue;

        if (!new Decimal(balance.amount).equals(gift.amount)) {
          this.logger.warn(
            `Gift ${gift.id}: balance ${balance.balanceId} amount ${balance.amount} does not match expected ${gift.amount.toString()}`,
          );
          continue;
        }

        const updated = await this.prisma.gift.updateMany({
          where: { id: gift.id, status: GiftStatus.CREATED },
          data: {
            status: GiftStatus.FUNDED,
            balanceId: balance.balanceId,
            fundingTxHash: fundingTx.hash,
          },
        });
        if (updated.count > 0) {
          this.logger.log(
            `Gift ${gift.id} funded → balance ${balance.balanceId}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Gift reconciliation failed for balance ${balance.balanceId}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async detectRefunds() {
    const expired = await this.prisma.gift.findMany({
      where: { status: GiftStatus.EXPIRED, balanceId: { not: null } },
      select: { id: true, balanceId: true },
      take: 20,
    });

    for (const gift of expired) {
      try {
        const exists = await this.stellar.balanceExists(
          gift.balanceId as string,
        );
        if (!exists) {
          await this.prisma.gift.update({
            where: { id: gift.id },
            data: { status: GiftStatus.REFUNDED },
          });
          this.logger.log(`Gift ${gift.id} refunded to sender`);
        }
      } catch (err) {
        this.logger.warn(
          `Refund detection failed for gift ${gift.id}: ${(err as Error).message}`,
        );
      }
    }
  }
}
