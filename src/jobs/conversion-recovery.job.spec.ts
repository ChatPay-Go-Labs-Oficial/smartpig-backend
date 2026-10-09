import { Decimal } from '@prisma/client/runtime/library';
import { ConversionRecoveryJob } from './conversion-recovery.job';

interface Options {
  stranded?: Record<string, unknown>[];
  expiredCount?: number;
}

function createJob(options: Options = {}) {
  const { stranded = [], expiredCount = 0 } = options;

  let findManyArgs: { where: Record<string, unknown> } | null = null;
  let updateManyArgs: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  } | null = null;

  const prisma = {
    assetConversion: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        findManyArgs = args;
        return Promise.resolve(stranded);
      }),
      updateMany: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          updateManyArgs = args;
          return Promise.resolve({ count: expiredCount });
        },
      ),
    },
  };

  return {
    job: new ConversionRecoveryJob(prisma as unknown as never),
    prisma,
    getFindManyArgs: () => findManyArgs,
    getUpdateManyArgs: () => updateManyArgs,
  };
}

describe('ConversionRecoveryJob', () => {
  describe('conversions stranded without their deposit', () => {
    it('looks only for confirmed conversions with no deposit and a plan', async () => {
      const { job, getFindManyArgs } = createJob();

      await job.sweep();

      expect(getFindManyArgs()?.where).toMatchObject({
        status: 'CONFIRMED',
        depositIntentId: null,
      });
    });

    it('ignores one that only just confirmed', async () => {
      // A user taking their time signing the second transaction is not stranded.
      const { job, getFindManyArgs } = createJob();

      await job.sweep();

      const createdAt = getFindManyArgs()?.where.createdAt as { lt: Date };
      expect(createdAt.lt.getTime()).toBeLessThan(Date.now());
      expect(createdAt.lt.getTime()).toBeGreaterThan(
        Date.now() - 20 * 60 * 1000,
      );
    });

    it('reports without changing anything, because finishing needs a signature', async () => {
      // There is nothing a background job could do here except move money that
      // nobody asked it to move.
      const { job, prisma, getUpdateManyArgs } = createJob({
        stranded: [
          {
            id: 'conv-1',
            userId: 'user-a',
            targetSymbol: 'EURC',
            receivedAmount: new Decimal('8.97'),
          },
        ],
      });

      await job.sweep();

      // The only write is the expiry sweep, never a change to a stranded row.
      expect(prisma.assetConversion.updateMany).toHaveBeenCalledTimes(1);
      expect(getUpdateManyArgs()?.where.status).not.toBe('CONFIRMED');
    });

    it('survives a stranded row whose received amount was never read', async () => {
      const { job } = createJob({
        stranded: [
          {
            id: 'conv-1',
            userId: 'user-a',
            targetSymbol: 'EURC',
            receivedAmount: null,
          },
        ],
      });

      await expect(job.sweep()).resolves.toBeUndefined();
    });
  });

  describe('intents the user never authorized', () => {
    it('expires only those still awaiting a signature', async () => {
      const { job, getUpdateManyArgs } = createJob({ expiredCount: 2 });

      await job.sweep();

      const args = getUpdateManyArgs();
      expect(args?.where.status).toEqual({
        in: ['CREATED', 'XDR_GENERATED'],
      });
      expect(args?.data).toMatchObject({
        status: 'EXPIRED',
        failureCode: 'INTENT_EXPIRED',
      });
    });

    it('never touches a submitted conversion', async () => {
      // Once a transaction is in flight it either landed or it did not; the time
      // bound stops mattering, and calling it expired would misreport money that
      // already moved.
      const { job, getUpdateManyArgs } = createJob();

      await job.sweep();

      const statuses = (getUpdateManyArgs()?.where.status as { in: string[] })
        .in;
      expect(statuses).not.toContain('SUBMITTED');
      expect(statuses).not.toContain('CONFIRMED');
      expect(statuses).not.toContain('SIGNED_XDR_RECEIVED');
    });
  });
});
