import { Injectable, Logger } from '@nestjs/common';
import { GiftStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';

/** Placeholder for a name column that the schema does not allow to be null. */
const DELETED_NAME = 'Conta excluída';

/**
 * Erases the personal data of an account, keeping the financial trail.
 *
 * The row is never deleted. Two reasons, and either alone would be enough:
 *
 * Anti-money-laundering law requires keeping the record of operations for five
 * years, while Apple requires erasing personal data — so identity is separated
 * from transaction instead of one requirement beating the other.
 *
 * And deleting the `User` row is impossible anyway: seven mandatory relations
 * point at it without `onDelete: Cascade`, so Postgres refuses with P2003.
 *
 * Everything happens in a single transaction. A scrub that stops halfway would
 * leave an account that is neither usable nor erased.
 */
@Injectable()
export class ScrubService {
  private readonly logger = new Logger(ScrubService.name);

  constructor(private readonly prisma: PrismaService) {}

  async scrub(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.scrubWallets(tx, userId);
      await this.scrubBlindPay(tx, userId);
      await this.scrubIntents(tx, userId);
      await this.scrubRamps(tx, userId);
      await this.scrubEtherfuse(tx, userId);
      await this.scrubGifts(tx, userId);
      await this.scrubAuditLogs(tx, userId);
      await this.deleteDerived(tx, userId);
      await this.tombstone(tx, userId);
    });

    this.logger.log(`Account ${userId} scrubbed`);
  }

  /**
   * `stellarAddress` is globally unique, so it cannot simply stay behind: if the
   * same wallet logged in again, `AuthService.walletLogin` would find no active
   * account, try to create one, and hit the constraint — a 500 on login.
   *
   * A sentinel frees the address space; the real one moves to
   * `archivedStellarAddress`, where the financial trail can still reach it. It is
   * public on the network anyway.
   */
  private async scrubWallets(tx: Prisma.TransactionClient, userId: string) {
    const wallets = await tx.walletAccount.findMany({
      where: { userId },
      select: { id: true, stellarAddress: true },
    });

    for (const wallet of wallets) {
      await tx.walletAccount.update({
        where: { id: wallet.id },
        data: {
          stellarAddress: `deleted:${wallet.id}`,
          archivedStellarAddress: wallet.stellarAddress,
          label: null,
          activationUnsignedXdr: null,
          activationErrorMessage: null,
          isActive: false,
        },
      });
    }
  }

  /** The CPF lives here. It is the most sensitive column in the database. */
  private async scrubBlindPay(tx: Prisma.TransactionClient, userId: string) {
    const receiver = await tx.blindPayReceiver.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!receiver) return;

    await tx.blindPayReceiver.update({
      where: { id: receiver.id },
      data: {
        taxId: null,
        name: DELETED_NAME,
        tosId: null,
        kycWarnings: Prisma.DbNull,
        rejectionReason: null,
      },
    });

    await tx.blindPayKycAttempt.updateMany({
      where: { receiverId: receiver.id },
      data: { rejectionReason: null, warnings: Prisma.DbNull },
    });

    await tx.blindPayBankAccount.updateMany({
      where: { receiverId: receiver.id },
      data: { pixKey: null },
    });

    // O endereço Stellar é mantido de propósito em `archivedStellarAddress`, onde
    // serve à trilha financeira. Esta cópia não serve a nada depois que o customer
    // é apagado na BlindPay, e a coluna é NOT NULL — daí a sentinela.
    const blockchainWallets = await tx.blindPayBlockchainWallet.findMany({
      where: { receiverId: receiver.id },
      select: { id: true },
    });
    for (const wallet of blockchainWallets) {
      await tx.blindPayBlockchainWallet.update({
        where: { id: wallet.id },
        data: { address: `deleted:${wallet.id}` },
      });
    }
  }

  /** Signing material only. Amounts, assets, statuses and dates are the trail. */
  private async scrubIntents(tx: Prisma.TransactionClient, userId: string) {
    await tx.depositIntent.updateMany({
      where: { userId },
      data: { unsignedXdr: null, signedXdr: null },
    });
    await tx.withdrawalIntent.updateMany({
      where: { userId },
      data: { unsignedXdr: null, signedXdr: null },
    });
  }

  private async scrubRamps(tx: Prisma.TransactionClient, userId: string) {
    await tx.onrampTransaction.updateMany({
      where: { userId },
      data: { pixCode: null, errorMessage: null },
    });
    await tx.offrampTransaction.updateMany({
      where: { userId },
      data: {
        unsignedDelegationXdr: null,
        signedDelegationHash: null,
        errorMessage: null,
      },
    });
  }

  private async scrubEtherfuse(tx: Prisma.TransactionClient, userId: string) {
    const customer = await tx.etherfuseCustomer.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) return;

    await tx.etherfuseBankAccount.updateMany({
      where: { customerId: customer.id },
      data: { clabe: null, pixKey: null, pixKeyType: null },
    });
    await tx.etherfuseOrder.updateMany({
      where: { customerId: customer.id },
      data: { unsignedBurnXdr: null, signedBurnXdr: null },
    });
  }

  /**
   * Only gifts the user sent. A gift they received belongs to the sender's trail,
   * and that sender still has an account.
   *
   * `code` is the secret that lets anyone holding it claim the gift, and it is
   * unique — hence a sentinel rather than null. `memo` stays: it is the key that
   * ties the on-chain transaction to this row.
   */
  private async scrubGifts(tx: Prisma.TransactionClient, userId: string) {
    const gifts = await tx.gift.findMany({
      where: { senderUserId: userId },
      select: { id: true, status: true },
    });

    for (const gift of gifts) {
      await tx.gift.update({
        where: { id: gift.id },
        data: {
          code: `deleted:${gift.id}`,
          errorMessage: null,
          // A gift that was never funded would otherwise stay pending forever,
          // waiting on a sender who no longer exists.
          ...(gift.status === GiftStatus.CREATED
            ? { status: GiftStatus.EXPIRED }
            : {}),
        },
      });
    }
  }

  /** The record that an action happened has audit value. Who and from where does not. */
  private async scrubAuditLogs(tx: Prisma.TransactionClient, userId: string) {
    await tx.apiAuditLog.updateMany({
      where: { userId },
      data: { ipAddress: null, userAgent: null, payload: Prisma.DbNull },
    });
  }

  /** Derived analytics and credentials. Neither has AML value. */
  private async deleteDerived(tx: Prisma.TransactionClient, userId: string) {
    await tx.portfolioSnapshot.deleteMany({ where: { userId } });
    await tx.refreshToken.deleteMany({ where: { userId } });
  }

  /**
   * What is left of the user: an id and a creation date, anchoring the retained
   * financial records to nobody in particular.
   */
  private async tombstone(tx: Prisma.TransactionClient, userId: string) {
    await tx.user.update({
      where: { id: userId },
      data: {
        name: null,
        email: null,
        avatarUrl: null,
        googleId: null,
        appleId: null,
        isOnboarded: false,
        deletedAt: new Date(),
      },
    });
  }
}
