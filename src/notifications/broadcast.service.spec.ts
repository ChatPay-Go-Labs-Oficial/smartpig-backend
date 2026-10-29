import { BroadcastService } from './broadcast.service';

type Device = {
  id: string;
  userId: string;
  platform: 'IOS' | 'ANDROID';
  appVersion: string | null;
};

function createService(
  devices: Device[],
  prefs: Record<string, unknown>[] = [],
) {
  const prisma = {
    pushDevice: {
      findMany: jest.fn((args: { cursor?: { id: string }; take: number }) => {
        // Paginação por cursor: devolve a partir do id depois do cursor.
        const start = args.cursor
          ? devices.findIndex((d) => d.id === args.cursor!.id) + 1
          : 0;
        return Promise.resolve(devices.slice(start, start + args.take));
      }),
    },
    notificationPreference: {
      findMany: jest.fn().mockResolvedValue(prefs),
    },
    notification: {
      createMany: jest.fn((args: { data: unknown[] }) =>
        Promise.resolve({ count: args.data.length }),
      ),
    },
  };
  return { service: new BroadcastService(prisma as never), prisma };
}

const BASE = {
  type: 'APP_UPDATE_AVAILABLE' as const,
  title: 'Nova versão',
  body: 'Atualize o PigFi',
};

describe('BroadcastService', () => {
  it('cria uma notificação PENDING por usuário elegível, com dedupeKey por broadcast', async () => {
    const { service, prisma } = createService([
      { id: 'd1', userId: 'u1', platform: 'IOS', appVersion: '1.0.11' },
      { id: 'd2', userId: 'u1', platform: 'ANDROID', appVersion: '1.0.11' },
      { id: 'd3', userId: 'u2', platform: 'ANDROID', appVersion: '1.0.12' },
    ]);

    const result = await service.broadcast({ ...BASE, url: '/' });

    expect(result).toEqual(
      expect.objectContaining({
        eligible: 2,
        skippedByPreference: 0,
        created: 2,
        dryRun: false,
      }),
    );
    const rows = prisma.notification.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    expect(rows.skipDuplicates).toBe(true);
    expect(rows.data[0]).toEqual(
      expect.objectContaining({
        userId: 'u1',
        type: 'APP_UPDATE_AVAILABLE',
        category: 'updates',
        title: 'Nova versão',
        body: 'Atualize o PigFi',
        status: 'PENDING',
        dedupeKey: `broadcast:${result.broadcastId}:u1`,
        data: { broadcastId: result.broadcastId, url: '/', target: {} },
      }),
    );
  });

  it('filtra por plataforma no banco e por maxAppVersion com semver', async () => {
    const { service, prisma } = createService([
      { id: 'd1', userId: 'u1', platform: 'IOS', appVersion: '1.0.9' },
      { id: 'd2', userId: 'u2', platform: 'IOS', appVersion: '1.0.12' },
      { id: 'd3', userId: 'u3', platform: 'IOS', appVersion: '1.0.100' },
    ]);

    const result = await service.broadcast({
      ...BASE,
      platform: 'ios',
      maxAppVersion: '1.0.12',
    });

    expect(prisma.pushDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          disabledAt: null,
          platform: 'IOS',
          user: { deletedAt: null },
        },
      }),
    );
    expect(result.eligible).toBe(1);
    const rows = prisma.notification.createMany.mock.calls[0][0] as {
      data: { userId: string; data: unknown }[];
    };
    expect(rows.data.map((r) => r.userId)).toEqual(['u1']);
    expect(rows.data[0].data).toEqual(
      expect.objectContaining({
        target: { platform: 'ios', maxAppVersion: '1.0.12' },
      }),
    );
  });

  it('marketing respeita o opt-in: sem preferência salva, ignora', async () => {
    const { service, prisma } = createService(
      [
        { id: 'd1', userId: 'u1', platform: 'IOS', appVersion: '1.0.12' },
        { id: 'd2', userId: 'u2', platform: 'IOS', appVersion: '1.0.12' },
      ],
      [
        {
          userId: 'u2',
          transactions: true,
          updates: true,
          marketing: true,
          showDetails: false,
        },
      ],
    );

    const result = await service.broadcast({
      ...BASE,
      type: 'ANNOUNCEMENT',
    });

    expect(result).toEqual(
      expect.objectContaining({
        eligible: 2,
        skippedByPreference: 1,
        created: 1,
      }),
    );
    const rows = prisma.notification.createMany.mock.calls[0][0] as {
      data: { userId: string; category: string }[];
    };
    expect(rows.data).toEqual([
      expect.objectContaining({ userId: 'u2', category: 'marketing' }),
    ]);
  });

  it('dryRun só conta, não grava nada', async () => {
    const { service, prisma } = createService([
      { id: 'd1', userId: 'u1', platform: 'IOS', appVersion: '1.0.12' },
    ]);

    const result = await service.broadcast({ ...BASE, dryRun: true });

    expect(result).toEqual(
      expect.objectContaining({
        eligible: 1,
        toNotify: 1,
        created: 0,
        dryRun: true,
      }),
    );
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('pagina os devices e grava em lotes', async () => {
    const devices: Device[] = Array.from({ length: 1201 }, (_, i) => ({
      id: `d${String(i).padStart(5, '0')}`,
      userId: `u${i}`,
      platform: 'ANDROID',
      appVersion: '1.0.0',
    }));
    const { service, prisma } = createService(devices);

    const result = await service.broadcast(BASE);

    expect(result.eligible).toBe(1201);
    expect(result.created).toBe(1201);
    expect(prisma.pushDevice.findMany.mock.calls.length).toBeGreaterThan(1);
    expect(prisma.notification.createMany.mock.calls.length).toBeGreaterThan(1);
  });
});
