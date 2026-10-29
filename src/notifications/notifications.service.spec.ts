import { Prisma } from '@prisma/client';
import { NotificationsService } from './notifications.service';

function createService() {
  const prisma = {
    user: { findUnique: jest.fn() },
    notification: { create: jest.fn().mockResolvedValue({ id: 'n1' }) },
    notificationPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const service = new NotificationsService(prisma as never);
  // O Logger do Nest escreve no stdout; aqui só interessa que foi chamado.
  const logger = (
    service as unknown as {
      logger: { error: jest.Mock; debug: jest.Mock; warn: jest.Mock };
    }
  ).logger;
  logger.error = jest.fn();
  logger.debug = jest.fn();
  logger.warn = jest.fn();
  return { service, prisma, logger };
}

function userWith(prefs: Record<string, boolean> | null, deletedAt = null) {
  return { deletedAt, notificationPrefs: prefs };
}

const DETAILS = { amount: '50', asset: 'USDC', username: 'joao' };

describe('NotificationsService.notify', () => {
  it('grava a notificação PENDING com categoria e texto genérico por padrão', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userWith(null));

    await service.notify({
      userId: 'u1',
      type: 'OFFRAMP_COMPLETED',
      dedupeKey: 'offramp:o1:COMPLETED',
      data: { offrampId: 'o1' },
      details: DETAILS,
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        type: 'OFFRAMP_COMPLETED',
        category: 'transactions',
        dedupeKey: 'offramp:o1:COMPLETED',
        status: 'PENDING',
        title: 'Saque concluído',
        body: 'Seu saque foi enviado para a sua conta.',
        data: { offrampId: 'o1' },
      }),
    });
  });

  it('usa o texto detalhado quando showDetails está ligado', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(
      userWith({
        transactions: true,
        updates: true,
        marketing: false,
        showDetails: true,
      }),
    );

    await service.notify({
      userId: 'u1',
      type: 'TRANSFER_RECEIVED',
      dedupeKey: 'payment:1',
      details: DETAILS,
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        body: 'Você recebeu 50,00 USDC de @joao',
      }),
    });
  });

  it('cai no genérico com showDetails ligado e dados faltando', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(
      userWith({
        transactions: true,
        updates: true,
        marketing: false,
        showDetails: true,
      }),
    );

    await service.notify({
      userId: 'u1',
      type: 'TRANSFER_RECEIVED',
      dedupeKey: 'payment:2',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        body: 'Você recebeu uma transferência',
      }),
    });
  });

  it('grava SKIPPED quando a categoria está desligada', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(
      userWith({
        transactions: false,
        updates: true,
        marketing: false,
        showDetails: false,
      }),
    );

    await service.notify({
      userId: 'u1',
      type: 'ONRAMP_COMPLETED',
      dedupeKey: 'onramp:x:COMPLETED',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED' }),
    });
  });

  it('marketing é opt-in: sem preferência salva, grava SKIPPED', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userWith(null));

    await service.notify({
      userId: 'u1',
      type: 'ANNOUNCEMENT',
      dedupeKey: 'announcement:1',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'SKIPPED',
        category: 'marketing',
      }),
    });
  });

  it('ignora sem erro quando o dedupeKey já existe', async () => {
    const { service, prisma, logger } = createService();
    prisma.user.findUnique.mockResolvedValue(userWith(null));
    prisma.notification.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    await expect(
      service.notify({
        userId: 'u1',
        type: 'KYC_APPROVED',
        dedupeKey: 'kyc:r1:APPROVED',
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('nunca lança: erro de banco vira log', async () => {
    const { service, prisma, logger } = createService();
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));

    await expect(
      service.notify({
        userId: 'u1',
        type: 'KYC_APPROVED',
        dedupeKey: 'kyc:r1:APPROVED',
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('não grava nada para usuário inexistente ou excluído', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValueOnce(
      userWith(null, new Date() as never),
    );

    await service.notify({ userId: 'u1', type: 'KYC_APPROVED', dedupeKey: 'a' });
    await service.notify({ userId: 'u2', type: 'KYC_APPROVED', dedupeKey: 'b' });

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});

describe('NotificationsService preferences', () => {
  it('devolve os padrões quando o usuário nunca salvou', async () => {
    const { service, prisma } = createService();
    prisma.notificationPreference.findUnique.mockResolvedValue(null);

    await expect(service.getPreferences('u1')).resolves.toEqual({
      transactions: true,
      updates: true,
      marketing: false,
      showDetails: false,
    });
  });

  it('salva só as chaves enviadas e devolve o objeto completo', async () => {
    const { service, prisma } = createService();
    prisma.notificationPreference.upsert.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
      transactions: true,
      updates: true,
      marketing: true,
      showDetails: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.updatePreferences('u1', { marketing: true });

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', marketing: true },
      update: { marketing: true },
    });
    expect(result).toEqual({
      transactions: true,
      updates: true,
      marketing: true,
      showDetails: false,
    });
  });
});
