import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Resolves which local account a request is allowed to act on.
 *
 * The guard puts the Privy DID on `request.user.id`, not our own `User.id`, so a
 * route that needs the local user has no choice today but to read it from the
 * client. That is how every business route works, and it means a valid token for
 * A can operate on B's data.
 *
 * This service closes that gap for routes that opt into it, by deriving the owner
 * from the wallets Privy verified for the bearer:
 *
 *   verified Stellar addresses
 *     -> the oldest active WalletAccount holding one of them
 *          -> walletAccount.userId
 *
 * It takes the addresses rather than the Privy DID for the same reason
 * `AuthService.walletLogin` does: the controller owns the call to
 * `PrivyAuthService.getStellarWalletAddresses`, which keeps the Privy SDK — and its
 * ESM dependencies — out of the services and out of their unit tests.
 */
@Injectable()
export class AccountOwnerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The only local user the bearer of these verified wallets may act on.
   *
   * Throws NotFoundException when Privy verified no Stellar wallet, or when no
   * active WalletAccount matches one — both mean there is no local account behind
   * an otherwise valid token.
   */
  async resolveUserId(verifiedStellarAddresses: string[]): Promise<string> {
    if (verifiedStellarAddresses.length === 0) {
      throw new NotFoundException(
        'No Stellar wallet is linked to this authenticated user',
      );
    }

    const wallet = await this.prisma.walletAccount.findFirst({
      where: {
        stellarAddress: { in: verifiedStellarAddresses },
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });

    if (!wallet) {
      throw new NotFoundException('No active account found for this user');
    }

    return wallet.userId;
  }

  /**
   * Resolves the owner and rejects a request that names a different user.
   *
   * `claimedUserId` is whatever the client sent — path, body or query. It is never
   * trusted as the answer, only compared against it. The app's api client injects a
   * `userId` into every request, so passing it through here is what keeps that habit
   * from becoming an authorization bypass.
   */
  async assertOwnership(
    verifiedStellarAddresses: string[],
    claimedUserId?: string | null,
  ): Promise<string> {
    const userId = await this.resolveUserId(verifiedStellarAddresses);

    if (claimedUserId && claimedUserId !== userId) {
      throw new ForbiddenException(
        'This account does not belong to the authenticated user',
      );
    }

    return userId;
  }
}
