import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UsernamesService } from './usernames.service';

function setup() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const stellar = {
    getAsset: jest.fn((symbol: string) => ({ symbol })),
    hasTrustline: jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false),
  };
  return {
    service: new UsernamesService(prisma as never, stellar as never),
    prisma,
    stellar,
  };
}

describe('UsernamesService', () => {
  it('checks availability using the normalized exact username', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.availability(' Ana.Lima ')).resolves.toEqual({
      available: true,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'ana.lima' } }),
    );
  });

  it('rejects invalid usernames without querying other users', async () => {
    const { service, prisma } = setup();

    await expect(service.availability('_ana')).resolves.toEqual({
      available: false,
      reason: 'INVALID',
    });
    await expect(service.create('user-a', 'a!')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('sets a username only once', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({ username: null });

    await expect(service.create('user-a', 'Ana.Lima')).resolves.toEqual({
      username: 'ana.lima',
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-a', username: null },
        data: expect.objectContaining({ username: 'ana.lima' }),
      }),
    );
  });

  it('does not allow replacing a permanent username', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({ username: 'ana.lima' });

    await expect(service.create('user-a', 'ana.nova')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('resolves the verified name, address and receivable assets', async () => {
    const { service, prisma, stellar } = setup();
    prisma.user.findUnique.mockResolvedValue({
      name: 'João Silva',
      deletedAt: null,
      blindpayReceiver: { name: 'João KYC', kycStatus: 'APPROVED' },
      etherfuseCustomer: null,
      wallets: [{ stellarAddress: 'GADDRESS' }],
    });

    await expect(service.resolve('JOAO.SILVA')).resolves.toEqual({
      username: 'joao.silva',
      displayName: 'João KYC',
      verified: true,
      stellarAddress: 'GADDRESS',
      receives: { USDC: true, EURC: false, XLM: true },
    });
    expect(stellar.hasTrustline).toHaveBeenCalledTimes(2);
  });

  it('does not expose whether an invalid or absent exact name ever existed', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.resolve('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.resolve('!!')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
