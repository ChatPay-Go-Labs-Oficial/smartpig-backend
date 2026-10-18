import { GiftStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { GiftReconciliationJob } from './gift-reconciliation.job';
import type { AgentClaimableBalance } from '../gifts/gift-stellar.service';

const MEMO = 'GIFT-ABC';

function balance(balanceId: string, amount = '10'): AgentClaimableBalance {
  return { balanceId, amount, sponsor: null };
}

interface Options {
  configured?: boolean;
  pending?: { id: string; memo: string; amount: Decimal }[];
  known?: { balanceId: string | null }[];
  balances?: AgentClaimableBalance[] | Error;
  fundingTx?: Record<
    string,
    { hash: string; memo: string | null } | Error | null
  >;
  expired?: { id: string; balanceId: string | null }[];
  balanceExists?: Record<string, boolean | Error>;
}

function createJob(options: Options = {}) {
  const {
    configured = true,
    pending = [{ id: 'gift-1', memo: MEMO, amount: new Decimal('10') }],
    known = [],
    balances = [balance('bal-1')],
    fundingTx = { 'bal-1': { hash: 'tx-1', memo: MEMO } },
    expired = [],
    balanceExists = {},
  } = options;

  const prisma = {
    gift: {
      // The job issues three distinct reads; the status in the filter is what
      // tells them apart.
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        if (where.status === GiftStatus.CREATED)
          return Promise.resolve(pending);
        if (where.status === GiftStatus.EXPIRED)
          return Promise.resolve(expired);
        return Promise.resolve(known);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const stellar = {
    isConfigured: jest.fn().mockReturnValue(configured),
    listAgentClaimableBalances: jest.fn(() =>
      balances instanceof Error
        ? Promise.reject(balances)
        : Promise.resolve(balances),
    ),
    getBalanceFundingTx: jest.fn((balanceId: string) => {
      const configuredTx = fundingTx[balanceId];
      if (configuredTx instanceof Error) return Promise.reject(configuredTx);
      return Promise.resolve(configuredTx ?? null);
    }),
    balanceExists: jest.fn((balanceId: string) => {
      const configuredExists = balanceExists[balanceId];
      if (configuredExists instanceof Error) {
        return Promise.reject(configuredExists);
      }
      return Promise.resolve(configuredExists ?? true);
    }),
  };

  return {
    job: new GiftReconciliationJob(prisma as never, stellar as never),
    prisma,
    stellar,
  };
}

describe('GiftReconciliationJob', () => {
  it('does no work at all when the claim agent is not configured', async () => {
    // Without the agent secret there is no claimant to reconcile against, and
    // this job runs every minute.
    const { job, prisma, stellar } = createJob({ configured: false });

    await job.reconcileGifts();

    expect(prisma.gift.findMany).not.toHaveBeenCalled();
    expect(stellar.listAgentClaimableBalances).not.toHaveBeenCalled();
  });

  describe('funding pending gifts', () => {
    it('funds the gift whose memo the funding transaction carries', async () => {
      const { job, prisma } = createJob();

      await job.reconcileGifts();

      expect(prisma.gift.updateMany).toHaveBeenCalledWith({
        // Guarded on CREATED: the claim flow may have moved the gift on while
        // this sweep was reading Horizon.
        where: { id: 'gift-1', status: GiftStatus.CREATED },
        data: {
          status: GiftStatus.FUNDED,
          balanceId: 'bal-1',
          fundingTxHash: 'tx-1',
        },
      });
    });

    it('refuses to fund when the on-chain amount is not the gift amount', async () => {
      // Funding a 10 USDC gift from a 9 USDC balance would promise the
      // recipient money the balance cannot pay.
      const { job, prisma } = createJob({ balances: [balance('bal-1', '9')] });

      await job.reconcileGifts();

      expect(prisma.gift.updateMany).not.toHaveBeenCalled();
    });

    it('ignores a balance already recorded against a gift', async () => {
      const { job, stellar } = createJob({ known: [{ balanceId: 'bal-1' }] });

      await job.reconcileGifts();

      expect(stellar.getBalanceFundingTx).not.toHaveBeenCalled();
    });

    it('leaves a balance alone when no pending gift claims its memo', async () => {
      const { job, prisma } = createJob({
        fundingTx: { 'bal-1': { hash: 'tx-1', memo: 'GIFT-SOMEONE-ELSE' } },
      });

      await job.reconcileGifts();

      expect(prisma.gift.updateMany).not.toHaveBeenCalled();
    });

    it('leaves a balance alone when its funding transaction has no memo', async () => {
      // The memo is the only link between a gift row and a ledger balance.
      const { job, prisma } = createJob({
        fundingTx: { 'bal-1': { hash: 'tx-1', memo: null } },
      });

      await job.reconcileGifts();

      expect(prisma.gift.updateMany).not.toHaveBeenCalled();
    });

    it('gives up the funding sweep when Horizon cannot list the balances', async () => {
      // A Horizon outage must not take the whole job down: refunds still run.
      const { job, prisma } = createJob({
        balances: new Error('ETIMEDOUT'),
        expired: [{ id: 'gift-old', balanceId: 'bal-old' }],
        balanceExists: { 'bal-old': false },
      });

      await expect(job.reconcileGifts()).resolves.toBeUndefined();

      expect(prisma.gift.updateMany).not.toHaveBeenCalled();
      expect(prisma.gift.update).toHaveBeenCalledWith({
        where: { id: 'gift-old' },
        data: { status: GiftStatus.REFUNDED },
      });
    });

    it('keeps going when one balance cannot be read', async () => {
      const { job, prisma } = createJob({
        balances: [balance('bal-down'), balance('bal-ok')],
        fundingTx: {
          'bal-down': new Error('ETIMEDOUT'),
          'bal-ok': { hash: 'tx-2', memo: MEMO },
        },
      });

      await job.reconcileGifts();

      expect(prisma.gift.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.gift.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ balanceId: 'bal-ok' }),
        }),
      );
    });
  });

  describe('detecting refunds', () => {
    it('marks the gift refunded once its balance leaves the ledger', async () => {
      // The balance being gone after expiry means the sender reclaimed it.
      const { job, prisma } = createJob({
        pending: [],
        expired: [{ id: 'gift-old', balanceId: 'bal-old' }],
        balanceExists: { 'bal-old': false },
      });

      await job.reconcileGifts();

      expect(prisma.gift.update).toHaveBeenCalledWith({
        where: { id: 'gift-old' },
        data: { status: GiftStatus.REFUNDED },
      });
    });

    it('leaves the gift expired while the balance is still there', async () => {
      const { job, prisma } = createJob({
        pending: [],
        expired: [{ id: 'gift-old', balanceId: 'bal-old' }],
        balanceExists: { 'bal-old': true },
      });

      await job.reconcileGifts();

      expect(prisma.gift.update).not.toHaveBeenCalled();
    });

    it('keeps going when one refund check fails', async () => {
      const { job, prisma } = createJob({
        pending: [],
        expired: [
          { id: 'gift-down', balanceId: 'bal-down' },
          { id: 'gift-ok', balanceId: 'bal-ok' },
        ],
        balanceExists: { 'bal-down': new Error('ETIMEDOUT'), 'bal-ok': false },
      });

      await job.reconcileGifts();

      expect(prisma.gift.update).toHaveBeenCalledTimes(1);
      expect(prisma.gift.update).toHaveBeenCalledWith({
        where: { id: 'gift-ok' },
        data: { status: GiftStatus.REFUNDED },
      });
    });
  });
});
