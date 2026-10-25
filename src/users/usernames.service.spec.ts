import { Prisma } from '@prisma/client';
import { normalizeUsername, UsernamesService } from './usernames.service';

describe('Usernames', () => {
  it('normalizes ASCII casing and validates syntax', () => {
    expect(normalizeUsername(' Carol.Tea_1 ')).toBe('carol.tea_1');
    for (const name of ['ab', '1abc', 'ábc', 'a-b', 'a'.repeat(21)])
      expect(normalizeUsername(name)).toBeNull();
  });
  it('does exact availability lookups without listing accounts', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'u' });
    const service = new UsernamesService(
      { user: { findUnique } } as never,
      {} as never,
    );
    await expect(service.availability('ALICE')).resolves.toEqual({
      available: false,
      reason: 'TAKEN',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { username: 'alice' },
      select: { id: true },
    });
  });
  it('atomically refuses a second username', async () => {
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const service = new UsernamesService(
      { $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) } as never,
      {} as never,
    );
    await expect(service.register('u', 'alice')).rejects.toMatchObject({
      response: { code: 'USERNAME_ALREADY_SET' },
    });
  });
  it('maps a concurrent unique constraint failure to USERNAME_TAKEN', async () => {
    const service = new UsernamesService(
      {
        $transaction: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: '5',
          }),
        ),
      } as never,
      {} as never,
    );
    await expect(service.register('u', 'alice')).rejects.toMatchObject({
      response: { code: 'USERNAME_TAKEN' },
    });
  });
  it('returns only a KYC verified name and asks Stellar for receiving capability', async () => {
    const user = {
      username: 'alice',
      deletedAt: null,
      blindpayReceiver: { name: 'Alice', kycStatus: 'VERIFYING' },
      wallets: [{ stellarAddress: 'GADDRESS' }],
    };
    const stellar = {
      getReceivingCapabilities: jest
        .fn()
        .mockResolvedValue({ USDC: true, EURC: false, XLM: true }),
    };
    const service = new UsernamesService(
      { user: { findUnique: async () => user } } as never,
      stellar as never,
    );
    await expect(service.resolve('alice')).resolves.toMatchObject({
      name: null,
      verified: false,
      stellarAddress: 'GADDRESS',
      canReceive: { EURC: false },
    });
    user.blindpayReceiver.kycStatus = 'APPROVED';
    await expect(service.resolve('alice')).resolves.toMatchObject({
      name: 'Alice',
      verified: true,
    });
  });
  it('does not resolve a deleted account', async () => {
    const service = new UsernamesService(
      {
        user: {
          findUnique: async () => ({ deletedAt: new Date(), wallets: [] }),
        },
      } as never,
      {} as never,
    );
    await expect(service.resolve('alice')).rejects.toMatchObject({
      status: 404,
    });
  });
});
