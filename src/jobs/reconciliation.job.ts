import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../infra/prisma/prisma.service';
import { TransactionStatus, IntentStatus, IntentType } from '@prisma/client';
import { DefindexService } from '../defindex/defindex.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { NotificationDetails } from '../notifications/notification-copy';

/**
 * Reconciles SUBMITTED intents that haven't been confirmed yet.
 * Queries DeFindex for the tx status and updates the DB record.
 */
@Injectable()
export class ReconciliationJob {
  private readonly logger = new Logger(ReconciliationJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePendingTransactions() {
    const pending = await this.prisma.transactionRecord.findMany({
      where: { status: TransactionStatus.PENDING },
      select: {
        id: true,
        userId: true,
        txHash: true,
        intentType: true,
        depositIntentId: true,
        withdrawalIntentId: true,
      },
      take: 50,
    });

    if (pending.length === 0) return;

    this.logger.log(`Reconciling ${pending.length} pending transaction(s)...`);

    for (const tx of pending) {
      if (!tx.txHash) continue;
      try {
        // Re-submit the stored signed XDR to check status.
        // DeFindex SDK sendTransaction is idempotent for already-confirmed txs.
        const intent = await this.getIntent(tx);
        const signedXdr = intent?.signedXdr;
        if (!signedXdr) continue;

        const result = await this.defindex.submitSignedTransaction({
          xdr: signedXdr,
        });
        if (result.success) {
          await this.prisma.$transaction([
            this.prisma.transactionRecord.update({
              where: { id: tx.id },
              data: {
                status: TransactionStatus.CONFIRMED,
                confirmedAt: new Date(),
              },
            }),
            tx.intentType === IntentType.DEPOSIT && tx.depositIntentId
              ? this.prisma.depositIntent.update({
                  where: { id: tx.depositIntentId },
                  data: { status: IntentStatus.CONFIRMED },
                })
              : tx.withdrawalIntentId
                ? this.prisma.withdrawalIntent.update({
                    where: { id: tx.withdrawalIntentId },
                    data: { status: IntentStatus.CONFIRMED },
                  })
                : this.prisma.$executeRaw`SELECT 1`,
          ]);
          this.logger.log(`Tx ${tx.txHash} confirmed`);
          // Só linhas PENDING entram aqui, então isto é sempre a transição.
          await this.notifications.notify({
            userId: tx.userId,
            type:
              tx.intentType === IntentType.DEPOSIT
                ? 'VAULT_DEPOSIT_CONFIRMED'
                : 'VAULT_WITHDRAWAL_CONFIRMED',
            dedupeKey: `vault-tx:${tx.id}:CONFIRMED`,
            data: { transactionRecordId: tx.id },
            details: intent.details,
          });
        }
      } catch (err) {
        this.logger.warn(
          `Reconciliation failed for tx ${tx.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /** XDR assinado para reenviar, e valor/ativo para o texto do push. */
  private async getIntent(tx: {
    intentType: IntentType;
    depositIntentId: string | null;
    withdrawalIntentId: string | null;
  }): Promise<{
    signedXdr: string | null;
    details: NotificationDetails;
  } | null> {
    if (tx.intentType === IntentType.DEPOSIT && tx.depositIntentId) {
      const intent = await this.prisma.depositIntent.findUnique({
        where: { id: tx.depositIntentId },
        select: { signedXdr: true, amount: true, assetSymbol: true },
      });
      if (!intent) return null;
      return {
        signedXdr: intent.signedXdr,
        details: { amount: intent.amount, asset: intent.assetSymbol },
      };
    }
    if (tx.withdrawalIntentId) {
      const intent = await this.prisma.withdrawalIntent.findUnique({
        where: { id: tx.withdrawalIntentId },
        select: {
          signedXdr: true,
          requestedAmount: true,
          vault: { select: { assetSymbol: true } },
        },
      });
      if (!intent) return null;
      return {
        signedXdr: intent.signedXdr,
        details: {
          amount: intent.requestedAmount,
          asset: intent.vault.assetSymbol,
        },
      };
    }
    return null;
  }
}
