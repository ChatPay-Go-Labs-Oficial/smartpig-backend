import { Prisma } from '@prisma/client';
import {
  MAX_DEVICES_PER_USER,
  PushDevicesService,
} from './push-devices.service';

const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';

function createService() {
  const prisma = {
    pushDevice: {
      upsert: jest.fn().mockResolvedValue({ id: 'd1' }),
      update: jest.fn().mockResolvedValue({ id: 'd1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return { service: new PushDevicesService(prisma as never), prisma };
}

describe('PushDevicesService.register', () => {
  it('faz upsert pelo token, reatribui ao usuário atual e reativa o device', async () => {
    const { service, prisma } = createService();

    await service.register('user-b', {
      token: TOKEN,
      platform: 'android',
      appVersion: '1.0.12',
    });

    const args = prisma.pushDevice.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ token: TOKEN });
    expect(args.create).toEqual(
      expect.objectContaining({
        userId: 'user-b',
        token: TOKEN,
        platform: 'ANDROID',
        appVersion: '1.0.12',
      }),
    );
    // O mesmo token em outro usuário passa a ser deste: quem está logado no
    // aparelho é quem recebe.
    expect(args.update).toEqual(
      expect.objectContaining({
        userId: 'user-b',
        platform: 'ANDROID',
        disabledAt: null,
        lastSeenAt: expect.any(Date),
      }),
    );
  });

  it('em corrida de dois upserts do mesmo token novo, refaz como update', async () => {
    const { service, prisma } = createService();
    prisma.pushDevice.upsert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    await service.register('user-a', { token: TOKEN, platform: 'ios' });

    expect(prisma.pushDevice.update).toHaveBeenCalledWith({
      where: { token: TOKEN },
      data: expect.objectContaining({ userId: 'user-a', platform: 'IOS' }),
    });
  });

  it('mantém no máximo MAX_DEVICES_PER_USER, apagando os mais antigos', async () => {
    const { service, prisma } = createService();
    prisma.pushDevice.findMany.mockResolvedValue([
      { id: 'old1' },
      { id: 'old2' },
    ]);

    await service.register('user-a', { token: TOKEN, platform: 'ios' });

    expect(prisma.pushDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a' },
        orderBy: { lastSeenAt: 'desc' },
        skip: MAX_DEVICES_PER_USER,
      }),
    );
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old1', 'old2'] }, userId: 'user-a' },
    });
  });
});

describe('PushDevicesService.remove', () => {
  it('apaga só se o token pertencer ao usuário atual', async () => {
    const { service, prisma } = createService();

    await service.remove('user-a', TOKEN);

    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { token: TOKEN, userId: 'user-a' },
    });
  });

  it('é idempotente: token inexistente não é erro', async () => {
    const { service, prisma } = createService();
    prisma.pushDevice.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove('user-a', TOKEN)).resolves.toBeUndefined();
  });
});
