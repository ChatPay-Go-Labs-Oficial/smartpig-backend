import { IntentType, Prisma, TransactionStatus } from '@prisma/client';
import { ReconciliationJob } from './reconciliation.job';

function createJob(pending: Record<string, unknown>[], success = true) {
  const order: string[] = [];
  const prisma = {
    transactionRecord: {
      findMany: jest.fn().mockResolvedValue(pending),
      update: jest.fn().mockReturnValue('tx-update'),
    },
    depositIntent: {
      findUnique: jest.fn().mockResolvedValue({
        signedXdr: 'XDR',
        amount: new Prisma.Decimal('20'),
        assetSymbol: 'USDC',
      }),
      update: jest.fn().mockReturnValue('intent-update'),
    },
    withdrawalIntent: {
      findUnique: jest.fn().mockResolvedValue({
        signedXdr: 'XDR',
        requestedAmount: new Prisma.Decimal('5'),
        vault: { assetSymbol: 'EURC' },
      }),
      update: jest.fn().mockReturnValue('intent-update'),
    },
    $transaction: jest.fn(() => {
      order.push('persist');
      return Promise.resolve([]);
    }),
    $executeRaw: jest.fn(),
  };
  const defindex = {
    submitSignedTransaction: jest.fn().mockResolvedValue({ success }),
  };
  const notifications = {
    notify: jest.fn(() => {
      order.push('notify');
      return Promise.resolve();
    }),
  };
  const job = new ReconciliationJob(
    prisma as never,
    defindex as never,
    notifications as never,
  );
  const logger = (job as unknown as { logger: Record<string, jest.Mock> })
    .logger;
  logger.log = jest.fn();
  logger.warn = jest.fn();
  return { job, prisma, notifications, order };
}

describe('ReconciliationJob — push', () => {
  it('notifica VAULT_DEPOSIT_CONFIRMED depois de gravar a confirmação', async () => {
    const { job, notifications, order } = createJob([
      {
        id: 'tr1',
        userId: 'u1',
        txHash: 'h1',
        status: TransactionStatus.PENDING,
        intentType: IntentType.DEPOSIT,
        depositIntentId: 'di1',
        withdrawalIntentId: null,
      },
    ]);

    await job.reconcilePendingTransactions();

    expect(order).toEqual(['persist', 'notify']);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: 'VAULT_DEPOSIT_CONFIRMED',
        dedupeKey: 'vault-tx:tr1:CONFIRMED',
        details: { amount: new Prisma.Decimal('20'), asset: 'USDC' },
      }),
    );
  });

  it('notifica VAULT_WITHDRAWAL_CONFIRMED para resgates', async () => {
    const { job, notifications } = createJob([
      {
        id: 'tr2',
        userId: 'u1',
        txHash: 'h2',
        intentType: IntentType.WITHDRAWAL,
        depositIntentId: null,
        withdrawalIntentId: 'wi1',
      },
    ]);

    await job.reconcilePendingTransactions();

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'VAULT_WITHDRAWAL_CONFIRMED',
        dedupeKey: 'vault-tx:tr2:CONFIRMED',
        details: { amount: new Prisma.Decimal('5'), asset: 'EURC' },
      }),
    );
  });

  it('não notifica quando a transação ainda não confirmou', async () => {
    const { job, notifications } = createJob(
      [
        {
          id: 'tr1',
          userId: 'u1',
          txHash: 'h1',
          intentType: IntentType.DEPOSIT,
          depositIntentId: 'di1',
          withdrawalIntentId: null,
        },
      ],
      false,
    );

    await job.reconcilePendingTransactions();

    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
