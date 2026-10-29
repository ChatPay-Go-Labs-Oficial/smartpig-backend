import { Keypair } from '@stellar/stellar-sdk';
import { IncomingPaymentsJob } from './incoming-payments.job';
import type { HorizonPayment } from './horizon-payments.client';

const ISSUER = Keypair.random().publicKey();
const ME = Keypair.random().publicKey();
const FRIEND = Keypair.random().publicKey();
const STRANGER = Keypair.random().publicKey();
const PARTNER = Keypair.random().publicKey();
const TREASURY = Keypair.random();
const AGENT = Keypair.random();

function payment(
  id: string,
  overrides: Partial<HorizonPayment> = {},
): HorizonPayment {
  return {
    id,
    paging_token: `pt-${id}`,
    type: 'payment',
    from: FRIEND,
    to: ME,
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: ISSUER,
    amount: '50.0000000',
    transaction_hash: `hash-${id}`,
    transaction_successful: true,
    created_at: '2026-10-29T12:00:00Z',
    ...overrides,
  };
}

interface Wallet {
  id: string;
  userId: string;
  stellarAddress: string;
  lastPaymentCursor: string | null;
}

function createJob(opts: {
  wallets: Wallet[];
  pages?: HorizonPayment[][];
  latest?: string;
  pigfiSenders?: {
    stellarAddress: string;
    userId: string;
    username: string | null;
  }[];
  recentOnramp?: boolean;
  config?: Record<string, unknown>;
  notifyResult?: (dedupeKey: string) => boolean;
}) {
  const pages = [...(opts.pages ?? [])];
  const prisma = {
    walletAccount: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        // Duas consultas: a seleção das carteiras e a resolução dos remetentes.
        if ('stellarAddress' in args.where) {
          return Promise.resolve(
            (opts.pigfiSenders ?? []).map((s) => ({
              stellarAddress: s.stellarAddress,
              userId: s.userId,
              user: { username: s.username },
            })),
          );
        }
        return Promise.resolve(opts.wallets);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    onrampTransaction: {
      count: jest.fn().mockResolvedValue(opts.recentOnramp ? 1 : 0),
    },
    etherfuseOrder: { count: jest.fn().mockResolvedValue(0) },
  };
  const horizon = {
    latestCursor: jest.fn().mockResolvedValue(opts.latest ?? 'pt-latest'),
    paymentsAfter: jest.fn(() => Promise.resolve(pages.shift() ?? [])),
  };
  const notifications = {
    notify: jest.fn((input: { dedupeKey: string }) =>
      Promise.resolve(
        opts.notifyResult ? opts.notifyResult(input.dedupeKey) : true,
      ),
    ),
  };
  const values: Record<string, unknown> = {
    STELLAR_USDC_ASSET_CODE: 'USDC',
    STELLAR_USDC_ISSUER: ISSUER,
    TREASURY_STELLAR_SECRET: TREASURY.secret(),
    GIFT_CLAIM_AGENT_SECRET: AGENT.secret(),
    INCOMING_PAYMENTS_IGNORED_SENDERS: PARTNER,
    ...opts.config,
  };
  const config = { get: jest.fn((key: string) => values[key]) };
  const job = new IncomingPaymentsJob(
    prisma as never,
    horizon as never,
    notifications as never,
    config as never,
  );
  const logger = (job as unknown as { logger: Record<string, jest.Mock> })
    .logger;
  for (const level of ['log', 'warn', 'error', 'debug'])
    logger[level] = jest.fn();
  return { job, prisma, horizon, notifications, logger };
}

const WALLET: Wallet = {
  id: 'w1',
  userId: 'u1',
  stellarAddress: ME,
  lastPaymentCursor: 'pt-0',
};

describe('IncomingPaymentsJob', () => {
  it('só olha carteiras ativas de usuários não excluídos', async () => {
    const { job, prisma } = createJob({ wallets: [] });

    await job.watch();

    expect(prisma.walletAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, user: { deletedAt: null } },
        orderBy: { id: 'asc' },
      }),
    );
  });

  it('primeira execução: grava o cursor atual sem notificar o histórico', async () => {
    const { job, prisma, horizon, notifications } = createJob({
      wallets: [{ ...WALLET, lastPaymentCursor: null }],
      latest: 'pt-99',
    });

    await job.watch();

    expect(horizon.latestCursor).toHaveBeenCalledWith(ME);
    expect(horizon.paymentsAfter).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.walletAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', lastPaymentCursor: null },
      data: { lastPaymentCursor: 'pt-99' },
    });
  });

  it('notifica pagamento USDC recebido de um usuário PigFi com @username', async () => {
    const { job, notifications } = createJob({
      wallets: [WALLET],
      pages: [[payment('p1')]],
      pigfiSenders: [
        { stellarAddress: FRIEND, userId: 'u2', username: 'joao' },
      ],
    });

    await job.watch();

    expect(notifications.notify).toHaveBeenCalledWith({
      userId: 'u1',
      type: 'TRANSFER_RECEIVED',
      dedupeKey: 'payment:p1',
      data: { paymentId: 'p1', txHash: 'hash-p1' },
      details: { amount: '50.0000000', asset: 'USDC', username: 'joao' },
    });
  });

  it('avança o cursor só depois de gravar, de forma condicional', async () => {
    const { job, prisma, notifications } = createJob({
      wallets: [WALLET],
      pages: [[payment('p1'), payment('p2')]],
    });

    await job.watch();

    const lastNotify = Math.max(
      ...notifications.notify.mock.invocationCallOrder,
    );
    expect(prisma.walletAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', lastPaymentCursor: 'pt-0' },
      data: { lastPaymentCursor: 'pt-p2' },
    });
    expect(
      prisma.walletAccount.updateMany.mock.invocationCallOrder[0],
    ).toBeGreaterThan(lastNotify);
  });

  it('se gravar falhar, o cursor para antes do pagamento que falhou', async () => {
    const { job, prisma } = createJob({
      wallets: [WALLET],
      pages: [[payment('p1'), payment('p2'), payment('p3')]],
      notifyResult: (key) => key !== 'payment:p2',
    });

    await job.watch();

    expect(prisma.walletAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', lastPaymentCursor: 'pt-0' },
      data: { lastPaymentCursor: 'pt-p1' },
    });
  });

  it('ignora o que não é recebimento de USDC', async () => {
    const { job, notifications, prisma } = createJob({
      wallets: [WALLET],
      pages: [
        [
          payment('sent', { from: ME, to: FRIEND }),
          payment('xlm', {
            asset_type: 'native',
            asset_code: undefined,
            asset_issuer: undefined,
          }),
          payment('fake-usdc', { asset_issuer: Keypair.random().publicKey() }),
          payment('path', { type: 'path_payment_strict_send' }),
          payment('create', { type: 'create_account' }),
          payment('failed', { transaction_successful: false }),
        ],
      ],
    });

    await job.watch();

    expect(notifications.notify).not.toHaveBeenCalled();
    // Mesmo sem notificar nada, o cursor avança sobre a página lida.
    expect(prisma.walletAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastPaymentCursor: 'pt-failed' } }),
    );
  });

  it('ignora poeira abaixo de 0,01 USDC (spam de push custaria quase nada)', async () => {
    const { job, notifications } = createJob({
      wallets: [WALLET],
      pages: [[payment('dust', { from: STRANGER, amount: '0.0000001' })]],
    });

    await job.watch();

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('ignora remetentes do sistema: emissor, tesouraria, agente de presente e parceiros', async () => {
    const { job, notifications } = createJob({
      wallets: [WALLET],
      pages: [
        [
          payment('issuer', { from: ISSUER }),
          payment('treasury', { from: TREASURY.publicKey() }),
          payment('gift', { from: AGENT.publicKey() }),
          payment('partner', { from: PARTNER }),
        ],
      ],
    });

    await job.watch();

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('remetente externo com onramp em andamento é a entrega do onramp: não duplica', async () => {
    const { job, notifications, prisma } = createJob({
      wallets: [WALLET],
      pages: [[payment('p1', { from: STRANGER })]],
      recentOnramp: true,
    });

    await job.watch();

    expect(prisma.onrampTransaction.count).toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('remetente externo sem onramp recente gera push genérico (sem @)', async () => {
    const { job, notifications } = createJob({
      wallets: [WALLET],
      pages: [[payment('p1', { from: STRANGER })]],
    });

    await job.watch();

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'payment:p1',
        details: { amount: '50.0000000', asset: 'USDC', username: null },
      }),
    );
  });

  it('remetente PigFi não passa pela checagem de onramp', async () => {
    const { job, notifications, prisma } = createJob({
      wallets: [WALLET],
      pages: [[payment('p1')]],
      pigfiSenders: [{ stellarAddress: FRIEND, userId: 'u2', username: null }],
      recentOnramp: true,
    });

    await job.watch();

    expect(prisma.onrampTransaction.count).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('limita as páginas por carteira e para quando a página vem incompleta', async () => {
    const full = (prefix: string) =>
      Array.from({ length: 50 }, (_, i) =>
        payment(`${prefix}${i}`, { from: ME, to: FRIEND }),
      );
    const { job, horizon } = createJob({
      wallets: [WALLET],
      pages: [full('a'), full('b'), full('c'), full('d'), full('e')],
    });

    await job.watch();

    expect(horizon.paymentsAfter).toHaveBeenCalledTimes(3);
    expect(horizon.paymentsAfter).toHaveBeenNthCalledWith(2, ME, 'pt-a49', 50);
  });

  it('erro numa carteira não para as outras', async () => {
    const other: Wallet = {
      id: 'w2',
      userId: 'u3',
      stellarAddress: FRIEND,
      lastPaymentCursor: 'pt-0',
    };
    const { job, horizon, notifications } = createJob({
      wallets: [WALLET, other],
    });
    horizon.paymentsAfter
      .mockRejectedValueOnce(new Error('horizon 503'))
      .mockResolvedValueOnce([
        payment('p9', { from: STRANGER, to: FRIEND }),
      ] as never);

    await job.watch();

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u3', dedupeKey: 'payment:p9' }),
    );
  });

  it('pula carteira com endereço inválido sem consultar o Horizon nem logar warn', async () => {
    // O /auth/wallet aceita qualquer string: staging tem carteiras como "n..." (9 chars).
    const broken: Wallet = { ...WALLET, id: 'w0', stellarAddress: 'nonsense1' };
    const { job, horizon, logger, notifications } = createJob({
      wallets: [broken, WALLET],
      pages: [[payment('p1', { from: STRANGER, to: ME })]],
    });

    await job.watch();

    expect(horizon.paymentsAfter).toHaveBeenCalledTimes(1);
    expect(horizon.paymentsAfter).toHaveBeenCalledWith(
      ME,
      ...([expect.anything(), expect.anything()] as unknown[]),
    );
    expect(horizon.latestCursor).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', dedupeKey: 'payment:p1' }),
    );
  });

  it('não roda com INCOMING_PAYMENTS_WATCHER_ENABLED=false', async () => {
    const { job, prisma } = createJob({
      wallets: [WALLET],
      config: { INCOMING_PAYMENTS_WATCHER_ENABLED: false },
    });

    await job.watch();

    expect(prisma.walletAccount.findMany).not.toHaveBeenCalled();
  });

  it('não sobrepõe execuções', async () => {
    const { job, prisma } = createJob({ wallets: [] });
    let release!: () => void;
    prisma.walletAccount.findMany.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve([]);
      }) as never,
    );

    const first = job.watch();
    await job.watch();
    release();
    await first;

    expect(prisma.walletAccount.findMany).toHaveBeenCalledTimes(1);
  });

  it('percorre as carteiras em rodízio quando há mais que o limite por execução', async () => {
    const wallets = Array.from({ length: 2 }, (_, i) => ({
      ...WALLET,
      id: `w${i}`,
    }));
    const { job, prisma } = createJob({
      wallets,
      config: { INCOMING_PAYMENTS_WALLETS_PER_RUN: 2 },
    });

    await job.watch();
    await job.watch();

    const secondWhere = prisma.walletAccount.findMany.mock.calls
      .map((c) => c[0])
      .filter((a) => !('stellarAddress' in a.where))[1].where;
    expect(secondWhere).toEqual(expect.objectContaining({ id: { gt: 'w1' } }));
  });
});
