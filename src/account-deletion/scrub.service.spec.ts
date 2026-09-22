import { Prisma } from '@prisma/client';
import { ScrubService } from './scrub.service';

const USER = 'user-a';

/**
 * The scrub is verified field by field, not by sampling: every column the matrix
 * in 06-banco-de-dados.md marks as erased has to be asserted, and so does every
 * column it marks as preserved. A scrub that misses one column ships a deletion
 * that does not delete.
 */
function createService(
  options: {
    wallets?: { id: string; stellarAddress: string }[];
    receiverId?: string | null;
    customerId?: string | null;
    gifts?: { id: string; status: string }[];
    blockchainWallets?: { id: string }[];
  } = {},
) {
  const {
    wallets = [{ id: 'w1', stellarAddress: `G${'A'.repeat(55)}` }],
    receiverId = 'r1',
    customerId = 'c1',
    gifts = [],
    blockchainWallets = [{ id: 'bw1' }],
  } = options;

  const calls: { model: string; op: string; args: unknown }[] = [];
  const record = (model: string, op: string) =>
    jest.fn((args: unknown) => {
      calls.push({ model, op, args });
      return Promise.resolve({ count: 0 });
    });

  const tx = {
    walletAccount: {
      findMany: jest.fn().mockResolvedValue(wallets),
      update: record('walletAccount', 'update'),
    },
    blindPayReceiver: {
      findUnique: jest
        .fn()
        .mockResolvedValue(receiverId ? { id: receiverId } : null),
      update: record('blindPayReceiver', 'update'),
    },
    blindPayKycAttempt: {
      updateMany: record('blindPayKycAttempt', 'updateMany'),
    },
    blindPayBankAccount: {
      updateMany: record('blindPayBankAccount', 'updateMany'),
    },
    blindPayBlockchainWallet: {
      findMany: jest.fn().mockResolvedValue(blockchainWallets),
      update: record('blindPayBlockchainWallet', 'update'),
    },
    depositIntent: { updateMany: record('depositIntent', 'updateMany') },
    withdrawalIntent: { updateMany: record('withdrawalIntent', 'updateMany') },
    onrampTransaction: {
      updateMany: record('onrampTransaction', 'updateMany'),
    },
    offrampTransaction: {
      updateMany: record('offrampTransaction', 'updateMany'),
    },
    etherfuseCustomer: {
      findUnique: jest
        .fn()
        .mockResolvedValue(customerId ? { id: customerId } : null),
    },
    etherfuseBankAccount: {
      updateMany: record('etherfuseBankAccount', 'updateMany'),
    },
    etherfuseOrder: { updateMany: record('etherfuseOrder', 'updateMany') },
    gift: {
      findMany: jest.fn().mockResolvedValue(gifts),
      update: record('gift', 'update'),
    },
    apiAuditLog: { updateMany: record('apiAuditLog', 'updateMany') },
    portfolioSnapshot: {
      deleteMany: record('portfolioSnapshot', 'deleteMany'),
    },
    refreshToken: { deleteMany: record('refreshToken', 'deleteMany') },
    user: { update: record('user', 'update') },
  };

  const prisma = {
    $transaction: jest.fn((fn: (c: unknown) => Promise<unknown>) => fn(tx)),
  };

  return { service: new ScrubService(prisma as never), prisma, tx, calls };
}

/** The `data` payload of the single write recorded for a model. */
function dataOf(
  calls: { model: string; op: string; args: unknown }[],
  model: string,
): Record<string, unknown> {
  const call = calls.find((c) => c.model === model);
  if (!call) throw new Error(`no write recorded for ${model}`);
  return (call.args as { data: Record<string, unknown> }).data;
}

describe('ScrubService', () => {
  it('runs everything inside one transaction', async () => {
    const { service, prisma } = createService();

    await service.scrub(USER);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  describe('users — the tombstone', () => {
    it('clears every identifying column and marks the deletion', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);
      const data = dataOf(calls, 'user');

      expect(data.name).toBeNull();
      expect(data.email).toBeNull();
      expect(data.avatarUrl).toBeNull();
      expect(data.googleId).toBeNull();
      expect(data.appleId).toBeNull();
      expect(data.isOnboarded).toBe(false);
      expect(data.deletedAt).toBeInstanceOf(Date);
    });

    it('does not touch the id or the creation date', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);
      const data = dataOf(calls, 'user');

      expect(data).not.toHaveProperty('id');
      expect(data).not.toHaveProperty('createdAt');
    });
  });

  describe('wallet_accounts', () => {
    it('replaces the address with a sentinel and archives the real one', async () => {
      const address = `G${'B'.repeat(55)}`;
      const { service, calls } = createService({
        wallets: [{ id: 'w1', stellarAddress: address }],
      });

      await service.scrub(USER);
      const data = dataOf(calls, 'walletAccount');

      expect(data.stellarAddress).toBe('deleted:w1');
      expect(data.archivedStellarAddress).toBe(address);
    });

    it('clears the label and the signing material, and deactivates', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);
      const data = dataOf(calls, 'walletAccount');

      expect(data.label).toBeNull();
      expect(data.activationUnsignedXdr).toBeNull();
      expect(data.activationErrorMessage).toBeNull();
      expect(data.isActive).toBe(false);
    });

    it('preserves the activation transaction hash, already public on the network', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);

      expect(dataOf(calls, 'walletAccount')).not.toHaveProperty(
        'activationTxHash',
      );
    });
  });

  describe('blindpay — where the CPF lives', () => {
    it('clears the tax id, the name, the ToS and the compliance payloads', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);
      const data = dataOf(calls, 'blindPayReceiver');

      expect(data.taxId).toBeNull();
      expect(data.name).toBe('Conta excluída');
      expect(data.tosId).toBeNull();
      expect(data.kycWarnings).toBe(Prisma.DbNull);
      expect(data.rejectionReason).toBeNull();
    });

    it('clears the rejection reason and warnings of every kyc attempt', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);
      const data = dataOf(calls, 'blindPayKycAttempt');

      expect(data.rejectionReason).toBeNull();
      expect(data.warnings).toBe(Prisma.DbNull);
    });

    it('replaces the address of the blindpay wallet with a sentinel', async () => {
      // O endereço fica guardado em `archivedStellarAddress`, que serve à trilha.
      // Esta segunda cópia não serve a nada depois que o customer é apagado lá,
      // e a coluna é NOT NULL — daí sentinela em vez de nulo.
      const { service, calls } = createService();

      await service.scrub(USER);

      expect(dataOf(calls, 'blindPayBlockchainWallet').address).toBe(
        'deleted:bw1',
      );
    });

    it('clears the pix key of every bank account', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);

      expect(dataOf(calls, 'blindPayBankAccount').pixKey).toBeNull();
    });

    it('skips blindpay entirely when the user never had a receiver', async () => {
      const { service, tx } = createService({ receiverId: null });

      await service.scrub(USER);

      expect(tx.blindPayReceiver.update).not.toHaveBeenCalled();
      expect(tx.blindPayBankAccount.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('intents and ramps', () => {
    it('clears the signing material of deposits and withdrawals', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);

      for (const model of ['depositIntent', 'withdrawalIntent']) {
        const data = dataOf(calls, model);
        expect(data.unsignedXdr).toBeNull();
        expect(data.signedXdr).toBeNull();
      }
    });

    it('keeps amounts, assets, statuses and dates on the intents', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);

      for (const model of ['depositIntent', 'withdrawalIntent']) {
        expect(Object.keys(dataOf(calls, model)).sort()).toEqual([
          'signedXdr',
          'unsignedXdr',
        ]);
      }
    });

    it('clears the pix payload and the delegation material of the ramps', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);

      expect(dataOf(calls, 'onrampTransaction').pixCode).toBeNull();
      const offramp = dataOf(calls, 'offrampTransaction');
      expect(offramp.unsignedDelegationXdr).toBeNull();
      expect(offramp.signedDelegationHash).toBeNull();
    });

    it('keeps the sender wallet address on the offramp, the counterparty of the operation', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);

      expect(dataOf(calls, 'offrampTransaction')).not.toHaveProperty(
        'senderWalletAddress',
      );
    });
  });

  describe('etherfuse', () => {
    it('clears the bank details and the burn signing material', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);

      const bank = dataOf(calls, 'etherfuseBankAccount');
      expect(bank.clabe).toBeNull();
      expect(bank.pixKey).toBeNull();

      const order = dataOf(calls, 'etherfuseOrder');
      expect(order.unsignedBurnXdr).toBeNull();
      expect(order.signedBurnXdr).toBeNull();
    });

    it('skips etherfuse entirely when the user never had a customer', async () => {
      const { service, tx } = createService({ customerId: null });

      await service.scrub(USER);

      expect(tx.etherfuseBankAccount.updateMany).not.toHaveBeenCalled();
      expect(tx.etherfuseOrder.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('gifts', () => {
    it('replaces the claim code with a sentinel', async () => {
      const { service, calls } = createService({
        gifts: [{ id: 'g1', status: 'CLAIMED' }],
      });

      await service.scrub(USER);

      expect(dataOf(calls, 'gift').code).toBe('deleted:g1');
    });

    it('expires a gift that was never funded, so it does not wait forever', async () => {
      const { service, calls } = createService({
        gifts: [{ id: 'g1', status: 'CREATED' }],
      });

      await service.scrub(USER);

      expect(dataOf(calls, 'gift').status).toBe('EXPIRED');
    });

    it('leaves the status of a gift that already reached the network', async () => {
      const { service, calls } = createService({
        gifts: [{ id: 'g1', status: 'CLAIMED' }],
      });

      await service.scrub(USER);

      expect(dataOf(calls, 'gift')).not.toHaveProperty('status');
    });

    it('keeps the memo, which ties the row to the on-chain transaction', async () => {
      const { service, calls } = createService({
        gifts: [{ id: 'g1', status: 'CLAIMED' }],
      });

      await service.scrub(USER);

      expect(dataOf(calls, 'gift')).not.toHaveProperty('memo');
    });

    it('only touches gifts the user sent', async () => {
      const { service, tx } = createService({
        gifts: [{ id: 'g1', status: 'CLAIMED' }],
      });

      await service.scrub(USER);

      expect(tx.gift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { senderUserId: USER } }),
      );
    });
  });

  describe('audit and credentials', () => {
    it('clears the telemetry that identifies, keeping the record that the action happened', async () => {
      const { service, calls } = createService();

      await service.scrub(USER);
      const data = dataOf(calls, 'apiAuditLog');

      expect(data.ipAddress).toBeNull();
      expect(data.userAgent).toBeNull();
      expect(data.payload).toBe(Prisma.DbNull);
      expect(data).not.toHaveProperty('action');
      expect(data).not.toHaveProperty('resource');
    });

    it('deletes the derived snapshots and the refresh tokens', async () => {
      const { service, tx } = createService();

      await service.scrub(USER);

      expect(tx.portfolioSnapshot.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER },
      });
      expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER },
      });
    });
  });

  describe('what is never deleted', () => {
    it('deletes rows from exactly two tables, and updates the rest', async () => {
      // Every other table keeps its rows: the counts of deposits, withdrawals,
      // transactions, ramps and gifts have to survive the deletion untouched.
      const { service, calls } = createService({
        gifts: [{ id: 'g1', status: 'CLAIMED' }],
      });

      await service.scrub(USER);

      const deletes = calls.filter((c) => c.op === 'deleteMany');
      expect(deletes.map((c) => c.model).sort()).toEqual([
        'portfolioSnapshot',
        'refreshToken',
      ]);
    });
  });
});
