import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { AccountDeletionStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AccountDeletionService } from '../account-deletion/account-deletion.service';

const DEFAULT_MAX_ATTEMPTS = 10;
const BATCH_SIZE = 20;

/**
 * Finishes deletions that stopped at the external steps.
 *
 * The saga deliberately does not fail when BlindPay or Privy are unavailable: the
 * user's data is already erased and their Stellar account already closed, so
 * holding the response hostage to a partner outage would punish them for someone
 * else's downtime. The request is left in `LOCAL_SCRUBBED` and answered as done.
 *
 * This is what makes that promise true. Without it, a ten-second network failure
 * becomes permanent: the local account erased, the Privy user alive forever, and
 * the Apple requirement unmet.
 *
 * It redoes **only** the two external calls. The on-chain closure and the scrub
 * already happened atomically, and repeating either would be destructive.
 */
@Injectable()
export class AccountDeletionCleanupJob {
  private readonly logger = new Logger(AccountDeletionCleanupJob.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deletion: AccountDeletionService,
    config: ConfigService,
  ) {
    this.maxAttempts =
      config.get<number>('ACCOUNT_DELETION_MAX_CLEANUP_RETRIES') ??
      DEFAULT_MAX_ATTEMPTS;
  }

  @Cron('*/15 * * * *')
  async retryPendingCleanups(): Promise<void> {
    const pending = await this.prisma.accountDeletionRequest.findMany({
      where: {
        status: AccountDeletionStatus.LOCAL_SCRUBBED,
        cleanupAttempts: { lt: this.maxAttempts },
      },
      select: {
        id: true,
        userId: true,
        privyUserId: true,
        cleanupAttempts: true,
      },
      take: BATCH_SIZE,
    });
    if (pending.length === 0) return;

    this.logger.log(`Retrying ${pending.length} pending account deletions`);

    for (const request of pending) {
      // Requests opened before the provider id was recorded cannot be finished
      // here: after the scrub there is no way back from the local account to the
      // DID. Marking them FAILED puts them in front of a human instead of leaving
      // them cycling silently until the attempt limit.
      if (!request.privyUserId) {
        await this.fail(
          request.id,
          'Deletion request has no identity provider id; finish it manually',
        );
        continue;
      }

      const attempts = request.cleanupAttempts + 1;
      try {
        await this.deletion.cleanUpExternals(
          request.id,
          request.userId,
          request.privyUserId,
        );
      } catch (err) {
        this.logger.warn(
          `Cleanup attempt ${attempts} failed for ${request.id}: ${(err as Error).message}`,
        );
      }

      const current = await this.prisma.accountDeletionRequest.findUnique({
        where: { id: request.id },
        select: { status: true },
      });

      // `cleanUpExternals` promotes to COMPLETED when both calls land. Anything
      // else means at least one is still pending, so this counts as an attempt.
      if (current?.status === AccountDeletionStatus.COMPLETED) {
        this.logger.log(`Account deletion ${request.id} completed on retry`);
        continue;
      }

      if (attempts >= this.maxAttempts) {
        await this.fail(
          request.id,
          `External cleanup did not complete after ${attempts} attempts`,
        );
        continue;
      }

      await this.prisma.accountDeletionRequest.update({
        where: { id: request.id },
        data: { cleanupAttempts: attempts },
      });
    }
  }

  private async fail(requestId: string, message: string): Promise<void> {
    this.logger.error(`Account deletion ${requestId}: ${message}`);
    await this.prisma.accountDeletionRequest.update({
      where: { id: requestId },
      data: { status: AccountDeletionStatus.FAILED, errorMessage: message },
    });
  }
}
