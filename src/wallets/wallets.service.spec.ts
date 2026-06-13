import { WalletsService } from './wallets.service';

describe('WalletsService activation idempotency', () => {
  const walletId = 'wallet-1';
  const userId = 'user-1';
  const stellarAddress = 'G'.padEnd(56, 'A');

  function createHarness() {
    const wallet = {
      id: walletId,
      userId,
      stellarAddress,
      isActivated: false,
      activationUnsignedXdr: null as string | null,
      activationExpiresAt: null as Date | null,
      activationTxHash: null as string | null,
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      walletAccount: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ ...wallet })),
        update: jest.fn().mockImplementation(({ data }) => {
          Object.assign(wallet, data);
          return Promise.resolve({ ...wallet });
        }),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    };
    const stellar = {
      buildActivationXdr: jest.fn().mockResolvedValue('unsigned-xdr'),
      submitFeeBumpTransaction: jest
        .fn()
        .mockResolvedValue({ hash: 'tx-hash' }),
      isAccountActivated: jest.fn().mockResolvedValue(false),
    };

    return {
      service: new WalletsService(prisma as any, stellar as any),
      wallet,
      stellar,
    };
  }

  it('reuses a pending activation XDR instead of generating another transaction', async () => {
    const { service, stellar } = createHarness();
    const dto = { userId, walletAccountId: walletId, stellarAddress };

    await expect(service.activateWallet(dto)).resolves.toEqual({
      unsignedXdr: 'unsigned-xdr',
    });
    await expect(service.activateWallet(dto)).resolves.toEqual({
      unsignedXdr: 'unsigned-xdr',
    });

    expect(stellar.buildActivationXdr).toHaveBeenCalledTimes(1);
  });

  it('returns the stored result when activation was already completed', async () => {
    const { service, wallet, stellar } = createHarness();
    wallet.isActivated = true;
    wallet.activationTxHash = 'existing-hash';

    await expect(
      service.submitActivation({
        walletAccountId: walletId,
        signedXdr: 'signed-xdr',
      }),
    ).resolves.toEqual({ success: true, txHash: 'existing-hash' });
    expect(stellar.submitFeeBumpTransaction).not.toHaveBeenCalled();
  });

  it('reconciles an activation that reached Stellar despite a submission error', async () => {
    const { service, wallet, stellar } = createHarness();
    wallet.activationUnsignedXdr = 'unsigned-xdr';
    stellar.submitFeeBumpTransaction.mockRejectedValueOnce(
      new Error('timeout'),
    );
    stellar.isAccountActivated.mockResolvedValueOnce(true);

    await expect(
      service.submitActivation({
        walletAccountId: walletId,
        signedXdr: 'signed-xdr',
      }),
    ).resolves.toEqual({ success: true, txHash: '' });
    expect(wallet.isActivated).toBe(true);
  });
});
