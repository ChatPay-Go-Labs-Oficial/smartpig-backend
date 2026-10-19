import { WalletsService } from './wallets.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { StellarService } from './stellar.service';

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
        // submitActivation/getWallet scope by owner, so the stub honours
        // `where.userId`; otherwise the scoping would not be exercised.
        findFirst: jest
          .fn()
          .mockImplementation(
            ({ where }: { where: { id: string; userId?: string } }) =>
              Promise.resolve(
                where.userId && where.userId !== wallet.userId
                  ? null
                  : { ...wallet },
              ),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: Partial<typeof wallet> }) => {
            Object.assign(wallet, data);
            return Promise.resolve({ ...wallet });
          }),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (client: typeof tx) => unknown) =>
          Promise.resolve(callback(tx)),
        ),
    };
    const stellar = {
      buildActivationXdr: jest.fn().mockResolvedValue('unsigned-xdr'),
      submitFeeBumpTransaction: jest
        .fn()
        .mockResolvedValue({ hash: 'tx-hash' }),
      isAccountActivated: jest.fn().mockResolvedValue(false),
    };

    return {
      service: new WalletsService(
        prisma as unknown as PrismaService,
        stellar as unknown as StellarService,
      ),
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
      service.submitActivation(
        {
          walletAccountId: walletId,
          signedXdr: 'signed-xdr',
        },
        userId,
      ),
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
      service.submitActivation(
        {
          walletAccountId: walletId,
          signedXdr: 'signed-xdr',
        },
        userId,
      ),
    ).resolves.toEqual({ success: true, txHash: '' });
    expect(wallet.isActivated).toBe(true);
  });

  it('does not submit an activation for a wallet owned by someone else', async () => {
    const { service, stellar } = createHarness();

    await expect(
      service.submitActivation(
        {
          walletAccountId: walletId,
          signedXdr: 'signed-xdr',
        },
        'user-2',
      ),
    ).rejects.toThrow(`Wallet ${walletId} not found`);
    expect(stellar.submitFeeBumpTransaction).not.toHaveBeenCalled();
  });
});
