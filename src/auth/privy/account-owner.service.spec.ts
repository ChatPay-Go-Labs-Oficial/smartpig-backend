import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccountOwnerService } from './account-owner.service';

describe('AccountOwnerService', () => {
  const addressA = `G${'A'.repeat(55)}`;
  const addressB = `G${'B'.repeat(55)}`;

  function createService() {
    const prisma = {
      walletAccount: {
        findFirst: jest.fn(),
      },
    };

    return {
      prisma,
      service: new AccountOwnerService(prisma as never),
    };
  }

  it('derives the local user from the oldest active wallet Privy verified', async () => {
    const { prisma, service } = createService();
    prisma.walletAccount.findFirst.mockResolvedValue({ userId: 'user-a' });

    await expect(service.resolveUserId([addressB, addressA])).resolves.toBe(
      'user-a',
    );

    expect(prisma.walletAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stellarAddress: { in: [addressB, addressA] },
          isActive: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('rejects the request when Privy verified no Stellar wallet', async () => {
    const { prisma, service } = createService();

    await expect(service.resolveUserId([])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.walletAccount.findFirst).not.toHaveBeenCalled();
  });

  it('rejects the request when no active account matches the verified wallets', async () => {
    const { prisma, service } = createService();
    prisma.walletAccount.findFirst.mockResolvedValue(null);

    await expect(service.resolveUserId([addressA])).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('accepts a claimed user id that matches the owner derived from the token', async () => {
    const { prisma, service } = createService();
    prisma.walletAccount.findFirst.mockResolvedValue({ userId: 'user-a' });

    await expect(service.assertOwnership([addressA], 'user-a')).resolves.toBe(
      'user-a',
    );
  });

  it("refuses a token from A that claims B's account", async () => {
    const { prisma, service } = createService();
    prisma.walletAccount.findFirst.mockResolvedValue({ userId: 'user-a' });

    await expect(
      service.assertOwnership([addressA], 'user-b'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ignores an absent claimed user id and answers with the owner', async () => {
    const { prisma, service } = createService();
    prisma.walletAccount.findFirst.mockResolvedValue({ userId: 'user-a' });

    await expect(service.assertOwnership([addressA])).resolves.toBe('user-a');
    await expect(service.assertOwnership([addressA], null)).resolves.toBe(
      'user-a',
    );
  });
});
