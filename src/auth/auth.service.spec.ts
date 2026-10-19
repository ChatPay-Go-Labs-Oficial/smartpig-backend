import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const originalAddress = `G${'A'.repeat(55)}`;
  const additionalAddress = `G${'B'.repeat(55)}`;

  function createService() {
    const prisma = {
      walletAccount: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    return {
      prisma,
      service: new AuthService(prisma as never),
    };
  }

  it('returns the oldest registered wallet among the wallets verified by Privy', async () => {
    const { prisma, service } = createService();
    prisma.walletAccount.findFirst.mockResolvedValue({
      id: 'wallet-original',
      userId: 'user-original',
      stellarAddress: originalAddress,
      label: null,
      isActive: true,
      isActivated: true,
      user: {
        id: 'user-original',
        name: null,
        email: null,
        avatarUrl: null,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    });

    const result = await service.walletLogin(
      { stellarAddress: additionalAddress },
      [additionalAddress, originalAddress],
    );

    expect(prisma.walletAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stellarAddress: { in: [additionalAddress, originalAddress] },
          isActive: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(result.wallet.stellarAddress).toBe(originalAddress);
    expect(result.user.id).toBe('user-original');
  });

  it('rejects a wallet address not linked to the authenticated Privy user', async () => {
    const { prisma, service } = createService();

    await expect(
      service.walletLogin({ stellarAddress: additionalAddress }, [
        originalAddress,
      ]),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.walletAccount.findFirst).not.toHaveBeenCalled();
  });

  it('refuses to hand an existing profile to an unauthenticated caller', async () => {
    const { prisma, service } = createService();
    prisma.walletAccount.findFirst.mockResolvedValue({
      id: 'wallet-original',
      userId: 'user-original',
      stellarAddress: originalAddress,
      label: null,
      isActive: true,
      isActivated: true,
      user: {
        id: 'user-original',
        name: 'Registered User',
        email: 'registered@example.com',
        avatarUrl: null,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    });

    // No verified addresses means no bearer token. A Stellar public key is not
    // a secret, so knowing one is not evidence of owning the account behind it:
    // recovering an existing profile has to require the token.
    await expect(
      service.walletLogin({ stellarAddress: originalAddress }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('still bootstraps a brand new wallet without a token', async () => {
    const { prisma, service } = createService();
    prisma.walletAccount.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValue({
      user: {
        id: 'user-new',
        name: null,
        email: null,
        avatarUrl: null,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
      wallet: {
        id: 'wallet-new',
        stellarAddress: additionalAddress,
        label: null,
        isActive: true,
      },
    });

    const result = await service.walletLogin({
      stellarAddress: additionalAddress,
    });

    expect(result.isNewUser).toBe(true);
    expect(result.user.id).toBe('user-new');
  });
});
