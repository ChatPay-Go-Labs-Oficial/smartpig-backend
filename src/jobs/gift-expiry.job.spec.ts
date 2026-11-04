import { Decimal } from '@prisma/client/runtime/library';
import { GiftStatus } from '@prisma/client';
import { GiftExpiryJob } from './gift-expiry.job';

function createJob(
  expiring: Record<string, unknown>[],
  alreadyWarned: string[] = [],
) {
  const prisma = {
    gift: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValueOnce(expiring).mockResolvedValue([]),
    },
    notification: {
      findMany: jest
        .fn()
        .mockResolvedValue(alreadyWarned.map((dedupeKey) => ({ dedupeKey }))),
    },
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const job = new GiftExpiryJob(prisma as never, notifications as never);
  return { job, prisma, notifications };
}

describe('GiftExpiryJob', () => {
  it('avisa quem enviou quando um presente FUNDED expira nas próximas 24 h', async () => {
    const { job, prisma, notifications } = createJob([
      {
        id: 'g1',
        senderUserId: 'sender-1',
        amount: new Decimal('15'),
        assetSymbol: 'USDC',
      },
    ]);

    await job.warnExpiringGifts();

    expect(prisma.gift.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: GiftStatus.FUNDED,
          expiresAt: { gt: expect.any(Date), lte: expect.any(Date) },
        },
      }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'sender-1',
        type: 'GIFT_EXPIRING',
        dedupeKey: 'gift:g1:EXPIRING',
        details: { amount: new Decimal('15'), asset: 'USDC' },
      }),
    );
  });

  it('pula presentes que já foram avisados, sem tentar inserir de novo', async () => {
    const { job, prisma, notifications } = createJob(
      [
        {
          id: 'g1',
          senderUserId: 's1',
          amount: new Decimal('1'),
          assetSymbol: 'USDC',
        },
        {
          id: 'g2',
          senderUserId: 's2',
          amount: new Decimal('2'),
          assetSymbol: 'USDC',
        },
      ],
      ['gift:g1:EXPIRING'],
    );

    await job.warnExpiringGifts();

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { dedupeKey: { in: ['gift:g1:EXPIRING', 'gift:g2:EXPIRING'] } },
      select: { dedupeKey: true },
    });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'gift:g2:EXPIRING' }),
    );
  });

  it('não avisa nada quando não há presente perto de expirar', async () => {
    const { job, notifications } = createJob([]);

    await job.warnExpiringGifts();

    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
