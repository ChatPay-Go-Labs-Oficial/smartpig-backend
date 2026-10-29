import { PushReceiptsJob } from './push-receipts.job';

function createJob(
  sent: { id: string; tickets: unknown; sentAt?: Date }[],
  receipts: Record<string, unknown>,
) {
  const prisma = {
    notification: {
      findMany: jest.fn().mockResolvedValue(sent),
      updateMany: jest.fn().mockResolvedValue({ count: sent.length }),
      update: jest.fn().mockResolvedValue({}),
    },
    pushDevice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const expo = {
    chunkReceiptIds: jest.fn((ids: string[]) => [ids]),
    getReceipts: jest.fn().mockResolvedValue(receipts),
  };
  const config = { get: jest.fn().mockReturnValue(true) };
  const job = new PushReceiptsJob(
    prisma as never,
    expo as never,
    config as never,
  );
  const logger = (job as unknown as { logger: Record<string, jest.Mock> })
    .logger;
  logger.log = jest.fn();
  logger.warn = jest.fn();
  logger.error = jest.fn();
  return { job, prisma, expo, logger };
}

describe('PushReceiptsJob', () => {
  it('só consulta SENT não conferidas, entre 15 min e 24 h depois do envio', async () => {
    const { job, prisma } = createJob([], {});

    await job.checkReceipts();

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'SENT',
          receiptCheckedAt: null,
          sentAt: { lt: expect.any(Date), gt: expect.any(Date) },
        },
      }),
    );
  });

  it('desativa o device do ticket que voltou DeviceNotRegistered', async () => {
    const { job, prisma } = createJob(
      [
        {
          id: 'n1',
          tickets: [
            { ticketId: 't1', deviceId: 'd1' },
            { ticketId: 't2', deviceId: 'd2' },
          ],
        },
      ],
      {
        t1: { status: 'ok' },
        t2: {
          status: 'error',
          message: 'gone',
          details: { error: 'DeviceNotRegistered' },
        },
      },
    );

    await job.checkReceipts();

    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['d2'] }, disabledAt: null },
      data: { disabledAt: expect.any(Date) },
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['n1'] } },
      data: { receiptCheckedAt: expect.any(Date) },
    });
  });

  it('erro de credencial vira log e registro, sem desativar device', async () => {
    const { job, prisma, logger } = createJob(
      [{ id: 'n1', tickets: [{ ticketId: 't1', deviceId: 'd1' }] }],
      {
        t1: {
          status: 'error',
          message: 'bad creds',
          details: { error: 'InvalidCredentials' },
        },
      },
    );

    await job.checkReceipts();

    expect(prisma.pushDevice.updateMany).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { error: expect.stringContaining('InvalidCredentials') },
    });
  });

  it('não marca como conferido enquanto o Expo não devolveu todos os receipts', async () => {
    const { job, prisma } = createJob(
      [
        {
          id: 'n1',
          sentAt: new Date(Date.now() - 60 * 60_000),
          tickets: [
            { ticketId: 't1', deviceId: 'd1' },
            { ticketId: 't2', deviceId: 'd2' },
          ],
        },
      ],
      // t2 ainda não está pronto no Expo.
      { t1: { status: 'ok' } },
    );

    await job.checkReceipts();

    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it('perto do fim da janela de 24 h, encerra mesmo com receipt faltando', async () => {
    const { job, prisma } = createJob(
      [
        {
          id: 'n1',
          sentAt: new Date(Date.now() - 23.5 * 60 * 60_000),
          tickets: [{ ticketId: 't1', deviceId: 'd1' }],
        },
      ],
      {},
    );

    await job.checkReceipts();

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['n1'] } },
      data: { receiptCheckedAt: expect.any(Date) },
    });
  });

  it('não marca como conferido quando a consulta ao Expo falha', async () => {
    const { job, prisma, expo } = createJob(
      [{ id: 'n1', tickets: [{ ticketId: 't1', deviceId: 'd1' }] }],
      {},
    );
    expo.getReceipts.mockRejectedValueOnce(new Error('503'));

    await expect(job.checkReceipts()).resolves.toBeUndefined();

    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it('não roda com PUSH_DISPATCH_ENABLED=false', async () => {
    const { job, prisma } = createJob([], {});
    (
      job as unknown as { config: { get: jest.Mock } }
    ).config.get.mockReturnValue(false);

    await job.checkReceipts();

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });
});
