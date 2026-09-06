import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccountDeletionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { BlindPayService } from '../blindpay/blindpay.service';
import {
  IDENTITY_DELETER,
  type IdentityDeleter,
} from '../auth/privy/identity-deleter.port';
import { StellarService, TX_TIMEOUT_SECONDS } from '../wallets/stellar.service';
import { EligibilityService } from './eligibility.service';
import { ScrubService } from './scrub.service';
import type {
  ConfirmDeletionDto,
  ConfirmDeletionResult,
  RequestDeletionResult,
} from './dto/deletion.dto';

/**
 * Orchestrates the account deletion.
 *
 * It touches four systems — our database, the Stellar network, BlindPay and Privy
 * — and three of them are external and irreversible. No transaction spans all
 * four, so the order is chosen by what happens when each step fails:
 *
 *   1. Re-check eligibility. The answer the app saw may be minutes old, and a Pix
 *      can land in between. This is the check that counts.
 *   2. Close the account on-chain. It is the only step that needs the user's
 *      signature, so it cannot run after Privy is gone.
 *   3. Scrub, in one transaction. If everything after this fails, the user can log
 *      in again and gets a clean new account — a bearable outcome. In the reverse
 *      order they would come back to a half-erased one, which is the worst state.
 *   4. Delete the customer at BlindPay, best effort. A regulated partner being
 *      down must not block a person from leaving.
 *   5. Delete the user at Privy. Irreversible, and it destroys the ability to
 *      authenticate — so it goes last by definition.
 *
 * Steps 4 and 5 are the only ones the cleanup job retries. Everything destructive
 * and local already happened atomically in step 3.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: EligibilityService,
    private readonly scrub: ScrubService,
    private readonly stellar: StellarService,
    private readonly blindpay: BlindPayService,
    @Inject(IDENTITY_DELETER)
    private readonly identity: IdentityDeleter,
  ) {}

  async requestDeletion(
    userId: string,
    privyUserId: string,
    idempotencyKey: string,
  ): Promise<RequestDeletionResult> {
    const existing = await this.prisma.accountDeletionRequest.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new ForbiddenException('This request belongs to another account');
      }
      // Residuals are read fresh rather than from the row: the vault dust is not
      // stored anywhere, and the consent screen shows these numbers to the user.
      const current = await this.eligibility.check(userId);
      return this.toRequestResult(existing, current.residuals);
    }

    const eligibility = await this.eligibility.check(userId);
    if (!eligibility.eligible) {
      throw new ConflictException({
        message: 'Account is not eligible for deletion',
        blockers: eligibility.blockers,
      });
    }

    const wallet = await this.prisma.walletAccount.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { stellarAddress: true, isActivated: true },
    });

    const request = await this.prisma.accountDeletionRequest.create({
      data: {
        idempotencyKey,
        userId,
        // Kept because the cleanup job cannot derive it later: after the scrub the
        // local wallet address is a sentinel, and there is no way back to the DID.
        privyUserId,
        status: AccountDeletionStatus.REQUESTED,
        acknowledgements: Prisma.JsonNull,
      },
    });

    // A wallet that was never activated has no on-chain account to close, so the
    // app skips the signing step entirely.
    if (!wallet?.isActivated) {
      return this.toRequestResult(request, eligibility.residuals);
    }

    const closure = await this.stellar.buildAccountClosureXdr(
      wallet.stellarAddress,
    );

    const updated = await this.prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: AccountDeletionStatus.PENDING_SIGNATURE,
        closureUnsignedXdr: closure.xdr,
        sweptAmount: closure.sweptAmount,
        sweptAssetSymbol: closure.sweptAssetSymbol,
      },
    });

    return this.toRequestResult(updated, eligibility.residuals);
  }

  async confirmDeletion(
    userId: string,
    privyUserId: string,
    requestId: string,
    dto: ConfirmDeletionDto,
  ): Promise<ConfirmDeletionResult> {
    const request = await this.prisma.accountDeletionRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Deletion request not found');
    if (request.userId !== userId) {
      throw new ForbiddenException('This request belongs to another account');
    }

    // Already done. The app may simply have lost the response, and answering with
    // an error would show a failure over a deletion that worked.
    if (request.status === AccountDeletionStatus.COMPLETED) {
      return {
        status: request.status,
        deletedAt: request.updatedAt.toISOString(),
      };
    }
    if (request.status === AccountDeletionStatus.FAILED) {
      throw new ConflictException(
        request.errorMessage ?? 'This deletion request failed',
      );
    }

    await this.assertEligible(userId);

    if (request.closureUnsignedXdr) {
      if (!dto.signedXdr) {
        throw new BadRequestException(
          'The closure transaction must be signed before confirming',
        );
      }
      await this.closeOnChain(
        request.id,
        dto.signedXdr,
        request.closureUnsignedXdr,
      );
    }

    await this.scrub.scrub(userId);
    await this.prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: AccountDeletionStatus.LOCAL_SCRUBBED,
        acknowledgements: {
          ...dto.acknowledgements,
          acceptedAt: new Date().toISOString(),
        },
      },
    });

    await this.cleanUpExternals(request.id, userId, privyUserId);

    const finished = await this.prisma.accountDeletionRequest.findUniqueOrThrow(
      {
        where: { id: request.id },
      },
    );
    return {
      status: finished.status,
      deletedAt: finished.updatedAt.toISOString(),
    };
  }

  /**
   * Steps 4 and 5. Failure here leaves the request in LOCAL_SCRUBBED for the
   * cleanup job, and never bubbles up: from the user's side the account is gone.
   */
  async cleanUpExternals(
    requestId: string,
    userId: string,
    privyUserId: string,
  ): Promise<void> {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { userId },
      select: { blindpayReceiverId: true },
    });

    let blindpayDeletedAt: Date | null = null;
    if (receiver) {
      try {
        await this.blindpay.deleteCustomer(receiver.blindpayReceiverId);
        blindpayDeletedAt = new Date();
      } catch (err) {
        this.logger.warn(
          `BlindPay deletion failed for ${userId}, job will retry: ${(err as Error).message}`,
        );
      }
    } else {
      blindpayDeletedAt = new Date();
    }

    let privyDeletedAt: Date | null = null;
    try {
      await this.identity.deleteUser(privyUserId);
      privyDeletedAt = new Date();
    } catch (err) {
      this.logger.warn(
        `Privy deletion failed for ${privyUserId}, job will retry: ${(err as Error).message}`,
      );
    }

    const completed = blindpayDeletedAt !== null && privyDeletedAt !== null;
    await this.prisma.accountDeletionRequest.update({
      where: { id: requestId },
      data: {
        ...(blindpayDeletedAt ? { blindpayDeletedAt } : {}),
        ...(privyDeletedAt ? { privyDeletedAt } : {}),
        ...(completed
          ? {
              status: AccountDeletionStatus.COMPLETED,
              // Working data, not part of the record. The provider id exists only
              // so the cleanup job can finish the job; once it has, keeping an
              // identifier that pointed at a person would be retaining PII in the
              // very row that documents its erasure. A FAILED request keeps it,
              // because a human still needs it to finish by hand.
              privyUserId: null,
            }
          : {}),
      },
    });
  }

  /** Step 2. A failure here stops the saga before anything local is touched. */
  private async closeOnChain(
    requestId: string,
    signedXdr: string,
    expectedUnsignedXdr: string,
  ): Promise<void> {
    try {
      const { hash } = await this.stellar.submitFeeBumpTransaction(
        signedXdr,
        expectedUnsignedXdr,
      );
      await this.prisma.accountDeletionRequest.update({
        where: { id: requestId },
        data: {
          status: AccountDeletionStatus.CHAIN_CLOSED,
          closureTxHash: hash,
        },
      });
    } catch (err) {
      const message = (err as Error).message;
      await this.prisma.accountDeletionRequest.update({
        where: { id: requestId },
        data: {
          status: AccountDeletionStatus.FAILED,
          errorMessage: message,
        },
      });
      // 503 and not 500: nothing was destroyed, and trying again later is safe.
      throw new ServiceUnavailableException(message);
    }
  }

  private async assertEligible(userId: string): Promise<void> {
    const eligibility = await this.eligibility.check(userId);
    if (!eligibility.eligible) {
      throw new ConflictException({
        message: 'Account is not eligible for deletion',
        blockers: eligibility.blockers,
      });
    }
  }

  private toRequestResult(
    request: { id: string; closureUnsignedXdr: string | null; createdAt: Date },
    residuals: { sweptToTreasuryUsd: string; permanentlyLostUsd: string },
  ): RequestDeletionResult {
    return {
      requestId: request.id,
      closureXdr: request.closureUnsignedXdr,
      residuals: {
        sweptToTreasuryUsd: residuals.sweptToTreasuryUsd,
        permanentlyLostUsd: residuals.permanentlyLostUsd,
      },
      // The signed transaction carries its own time bound. After this the XDR is
      // refused by the network, and the app has to start over.
      expiresAt: new Date(
        request.createdAt.getTime() + TX_TIMEOUT_SECONDS * 1000,
      ).toISOString(),
    };
  }
}
