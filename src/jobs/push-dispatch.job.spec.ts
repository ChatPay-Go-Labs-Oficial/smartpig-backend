import { PushDispatchJob } from './push-dispatch.job';

type Row = {
  id: string;
  userId: string;
  type: string;
  category: string;
  title: string;
  body: string;
  attempts: number;
};

function row(id: string, userId = 'u1', overrides: Partial<Row> = {}): Row {
  return {
    id,
    userId,
    type: 'OFFRAMP_COMPLETED',
    category: 'transactions',
    title: 'Saque concluído',
    body: 'Seu saque foi enviado para a sua conta.',
    attempts: 0,
    ...overrides,
  };
}

function createJob(opts: {
  pending: Row[];
  devices: { id: string; userId: string; token: string }[];
  claimed?: (id: string) => boolean;
  chunkSize?: number;
}) {
  const claimed = opts.claimed ?? (() => true);
  const prisma = {
    notification: {
      findMany: jest.fn().mockResolvedValue(opts.pending),
      updateMany: jest.fn(
        (args: { where: { id?: string; status?: string } }) => {
          // Claim: update condicional de uma linha PENDING para SENDING.
          if (args.where.id) {
            return Promise.resolve({ count: claimed(args.where.id) ? 1 : 0 });
          }
          return Promise.resolve({ count: 0 });
        },
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    pushDevice: {
      findMany: jest.fn().mockResolvedValue(opts.devices),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const size = opts.chunkSize ?? 100;
  const expo = {
    chunkMessages: jest.fn((messages: unknown[]) => {
      const chunks: unknown[][] = [];
      for (let i = 0; i < messages.length; i += size) {
        chunks.push(messages.slice(i, i + size));
      }
      return chunks;
    }),
    send: jest.fn((messages: { to: string }[]) =>
      Promise.resolve(
        messages.map((m) => ({ status: 'ok', id: `ticket-${m.to}` })),
      ),
    ),
  };
  const config = { get: jest.fn().mockReturnValue(true) };
  const job = new PushDispatchJob(
    prisma as never,
    expo as never,
    config as never,
  );
  const logger = (job as unknown as { logger: Record<string, jest.Mock> })
    .logger;
  logger.log = jest.fn();
  logger.warn = jest.fn();
  logger.error = jest.fn();
  return { job, prisma, expo };
}

function updateFor(prisma: ReturnType<typeof createJob>['prisma'], id: string) {
  const call = prisma.notification.update.mock.calls.find(
    (c: [{ where: { id: string } }]) => c[0].where.id === id,
  );
  return call?.[0] as { data: Record<string, unknown> } | undefined;
}

describe('PushDispatchJob', () => {
  it('faz claim atômico: só envia as linhas que conseguiu passar de PENDING para SENDING', async () => {
    const { job, prisma, expo } = createJob({
      pending: [row('n1'), row('n2')],
      devices: [{ id: 'd1', userId: 'u1', token: 'ExponentPushToken[a]' }],
      claimed: (id) => id === 'n1',
    });

    await job.dispatch();

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', status: 'PENDING' },
      data: expect.objectContaining({
        status: 'SENDING',
        attempts: { increment: 1 },
      }),
    });
    const sent = expo.send.mock.calls.flat(2) as {
      data: { notificationId: string };
    }[];
    expect(sent.map((m) => m.data.notificationId)).toEqual(['n1']);
    expect(updateFor(prisma, 'n2')).toBeUndefined();
  });

  it('monta a mensagem conforme o contrato e envia para todos os devices ativos', async () => {
    const { job, prisma, expo } = createJob({
      pending: [row('n1')],
      devices: [
        { id: 'd1', userId: 'u1', token: 'ExponentPushToken[a]' },
        { id: 'd2', userId: 'u1', token: 'ExponentPushToken[b]' },
      ],
    });

    await job.dispatch();

    expect(prisma.pushDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: { in: ['u1'] }, disabledAt: null },
      }),
    );
    expect(expo.send).toHaveBeenCalledWith([
      expect.objectContaining({
        to: 'ExponentPushToken[a]',
        title: 'Saque concluído',
        body: 'Seu saque foi enviado para a sua conta.',
        sound: 'default',
        channelId: 'transactions',
        data: {
          type: 'OFFRAMP_COMPLETED',
          url: '/wallet/history',
          notificationId: 'n1',
        },
      }),
      expect.objectContaining({ to: 'ExponentPushToken[b]' }),
    ]);
    expect(updateFor(prisma, 'n1')?.data).toEqual(
      expect.objectContaining({
        status: 'SENT',
        ticketId: 'ticket-ExponentPushToken[a]',
        tickets: [
          { ticketId: 'ticket-ExponentPushToken[a]', deviceId: 'd1' },
          { ticketId: 'ticket-ExponentPushToken[b]', deviceId: 'd2' },
        ],
        sentAt: expect.any(Date),
      }),
    );
  });

  it('divide em chunks e associa os tickets à mensagem certa', async () => {
    const { job, prisma, expo } = createJob({
      pending: [row('n1', 'u1'), row('n2', 'u2'), row('n3', 'u3')],
      devices: [
        { id: 'd1', userId: 'u1', token: 'ExponentPushToken[1]' },
        { id: 'd2', userId: 'u2', token: 'ExponentPushToken[2]' },
        { id: 'd3', userId: 'u3', token: 'ExponentPushToken[3]' },
      ],
      chunkSize: 2,
    });

    await job.dispatch();

    expect(expo.send).toHaveBeenCalledTimes(2);
    expect(updateFor(prisma, 'n3')?.data).toEqual(
      expect.objectContaining({
        status: 'SENT',
        tickets: [{ ticketId: 'ticket-ExponentPushToken[3]', deviceId: 'd3' }],
      }),
    );
  });

  it('marca SKIPPED quando o usuário não tem device ativo', async () => {
    const { job, prisma, expo } = createJob({
      pending: [row('n1')],
      devices: [],
    });

    await job.dispatch();

    expect(expo.send).not.toHaveBeenCalled();
    expect(updateFor(prisma, 'n1')?.data).toEqual(
      expect.objectContaining({ status: 'SKIPPED' }),
    );
  });

  it('marca FAILED quando todos os tickets voltam com erro e desativa DeviceNotRegistered', async () => {
    const { job, prisma, expo } = createJob({
      pending: [row('n1')],
      devices: [{ id: 'd1', userId: 'u1', token: 'ExponentPushToken[a]' }],
    });
    expo.send.mockResolvedValueOnce([
      {
        status: 'error',
        message: 'not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    ] as never);

    await job.dispatch();

    expect(updateFor(prisma, 'n1')?.data).toEqual(
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['d1'] }, disabledAt: null },
      data: { disabledAt: expect.any(Date) },
    });
  });

  it('erro HTTP 5xx ou de rede devolve para PENDING enquanto houver tentativas', async () => {
    const { job, prisma, expo } = createJob({
      pending: [row('n1')],
      devices: [{ id: 'd1', userId: 'u1', token: 'ExponentPushToken[a]' }],
    });
    expo.send.mockRejectedValueOnce(
      Object.assign(new Error('bad gateway'), { statusCode: 502 }),
    );

    await job.dispatch();

    expect(updateFor(prisma, 'n1')?.data).toEqual(
      expect.objectContaining({ status: 'PENDING' }),
    );
  });

  it('erro HTTP 400 é definitivo: FAILED sem nova tentativa', async () => {
    const { job, prisma, expo } = createJob({
      pending: [row('n1')],
      devices: [{ id: 'd1', userId: 'u1', token: 'ExponentPushToken[a]' }],
    });
    expo.send.mockRejectedValueOnce(
      Object.assign(new Error('bad request'), { statusCode: 400 }),
    );

    await job.dispatch();

    expect(updateFor(prisma, 'n1')?.data).toEqual(
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('esgotadas as tentativas, erro transitório vira FAILED', async () => {
    const { job, prisma, expo } = createJob({
      pending: [row('n1', 'u1', { attempts: 2 })],
      devices: [{ id: 'd1', userId: 'u1', token: 'ExponentPushToken[a]' }],
    });
    expo.send.mockRejectedValueOnce(new Error('ECONNRESET'));

    await job.dispatch();

    expect(updateFor(prisma, 'n1')?.data).toEqual(
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('recupera linhas presas em SENDING como FAILED, sem reenviar', async () => {
    const { job, prisma } = createJob({ pending: [], devices: [] });

    await job.dispatch();

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { status: 'SENDING', updatedAt: { lt: expect.any(Date) } },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
  });

  it('não roda com PUSH_DISPATCH_ENABLED=false', async () => {
    const { job, prisma } = createJob({ pending: [row('n1')], devices: [] });
    (job as unknown as { config: { get: jest.Mock } }).config.get.mockReturnValue(
      false,
    );

    await job.dispatch();

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it('não sobrepõe execuções na mesma instância', async () => {
    const { job, prisma } = createJob({ pending: [], devices: [] });
    let release!: () => void;
    prisma.notification.findMany.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );

    const first = job.dispatch();
    await job.dispatch();
    release();
    await first;

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(1);
  });
});
