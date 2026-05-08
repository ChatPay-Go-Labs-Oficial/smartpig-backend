import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from './defindex.service';
import { IntentStatus } from '@prisma/client';

/**
 * Orchestrates multi-step DeFindex flows that touch both the DB and the SDK.
 * - Deposit: persist intent → generate XDR → persist XDR
 * - Withdrawal: same pattern
 * - Submit: receive signed XDR → submit to chain → persist tx record
 */
@Injectable()
export class DefindexOrchestrator {
  private readonly logger = new Logger(DefindexOrchestrator.name);

  constructor(
    private readonly defindex: DefindexService,
    private readonly prisma: PrismaService,
  ) {}

  async buildDepositXdr(intentId: string): Promise<string | null> {
    const intent = await this.prisma.depositIntent.findUniqueOrThrow({
      where: { id: intentId },
      include: { vault: true, walletAccount: true },
    });

    const { xdr } = await this.defindex.generateDepositXdr({
      vaultAddress: intent.vault.defindexVaultId,
      callerAddress: intent.walletAccount.stellarAddress,
      amounts: [Number(intent.amount)],
    });

    await this.prisma.depositIntent.update({
      where: { id: intentId },
      data: { unsignedXdr: xdr, status: IntentStatus.XDR_GENERATED },
    });

    return xdr;
  }

  async buildWithdrawXdr(intentId: string): Promise<string | null> {
    const intent = await this.prisma.withdrawalIntent.findUniqueOrThrow({
      where: { id: intentId },
      include: { vault: true, walletAccount: true },
    });

    const { xdr } = await this.defindex.generateWithdrawXdr({
      vaultAddress: intent.vault.defindexVaultId,
      callerAddress: intent.walletAccount.stellarAddress,
      shareAmount: Number(intent.shareAmount),
    });

    await this.prisma.withdrawalIntent.update({
      where: { id: intentId },
      data: { unsignedXdr: xdr, status: IntentStatus.XDR_GENERATED },
    });

    return xdr;
  }

  async submitDeposit(
    intentId: string,
    signedXdr: string,
  ): Promise<{ txHash: string }> {
    await this.prisma.depositIntent.update({
      where: { id: intentId },
      data: { signedXdr, status: IntentStatus.SIGNED_XDR_RECEIVED },
    });

    const result = await this.defindex.submitSignedTransaction({ xdr: signedXdr });

    await this.prisma.depositIntent.update({
      where: { id: intentId },
      data: { status: IntentStatus.SUBMITTED },
    });

    await this.prisma.transactionRecord.create({
      data: {
        userId: (
          await this.prisma.depositIntent.findUniqueOrThrow({
            where: { id: intentId },
            select: { userId: true },
          })
        ).userId,
        intentType: 'DEPOSIT',
        depositIntentId: intentId,
        txHash: result.txHash,
        status: result.success ? 'CONFIRMED' : 'PENDING',
        confirmedAt: result.success ? new Date() : null,
      },
    });

    this.logger.log(`Deposit ${intentId} submitted → txHash=${result.txHash}`);
    return { txHash: result.txHash };
  }

  async submitWithdrawal(
    intentId: string,
    signedXdr: string,
  ): Promise<{ txHash: string }> {
    await this.prisma.withdrawalIntent.update({
      where: { id: intentId },
      data: { signedXdr, status: IntentStatus.SIGNED_XDR_RECEIVED },
    });

    const result = await this.defindex.submitSignedTransaction({ xdr: signedXdr });

    await this.prisma.withdrawalIntent.update({
      where: { id: intentId },
      data: { status: IntentStatus.SUBMITTED },
    });

    await this.prisma.transactionRecord.create({
      data: {
        userId: (
          await this.prisma.withdrawalIntent.findUniqueOrThrow({
            where: { id: intentId },
            select: { userId: true },
          })
        ).userId,
        intentType: 'WITHDRAWAL',
        withdrawalIntentId: intentId,
        txHash: result.txHash,
        status: result.success ? 'CONFIRMED' : 'PENDING',
        confirmedAt: result.success ? new Date() : null,
      },
    });

    this.logger.log(
      `Withdrawal ${intentId} submitted → txHash=${result.txHash}`,
    );
    return { txHash: result.txHash };
  }
}
