import { Decimal } from '@prisma/client/runtime/library';
import { DefindexOrchestrator } from './defindex.orchestrator';
import { DefindexService } from './defindex.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { StellarService } from '../wallets/stellar.service';

describe('DefindexOrchestrator', () => {
  it('sends deposit amounts to DeFindex in minimum asset units', async () => {
    const prisma = {
      depositIntent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'deposit-1',
          amount: new Decimal('2.50'),
          vault: {
            defindexVaultId: 'vault-address',
            assetDecimals: 7,
          },
          walletAccount: { stellarAddress: 'wallet-address' },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
    const generateDepositXdr = jest
      .fn()
      .mockResolvedValue({ xdr: 'unsigned-xdr' });
    const defindex = {
      generateDepositXdr,
    } as unknown as DefindexService;
    const orchestrator = new DefindexOrchestrator(
      defindex,
      prisma,
      {} as StellarService,
    );

    await expect(orchestrator.buildDepositXdr('deposit-1')).resolves.toBe(
      'unsigned-xdr',
    );
    expect(generateDepositXdr).toHaveBeenCalledWith({
      vaultAddress: 'vault-address',
      callerAddress: 'wallet-address',
      amounts: [25_000_000],
    });
  });

  it('wraps a signed deposit in a treasury-sponsored fee bump', async () => {
    const updateDepositIntent = jest.fn().mockResolvedValue({});
    const prisma = {
      depositIntent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          unsignedXdr: 'unsigned-xdr',
        }),
        update: updateDepositIntent,
      },
      transactionRecord: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
    const submitSignedTransaction = jest.fn().mockResolvedValue({
      txHash: 'tx-hash',
      success: true,
    });
    const buildSponsoredFeeBumpXdr = jest.fn().mockReturnValue('fee-bump-xdr');
    const defindex = {
      submitSignedTransaction,
    } as unknown as DefindexService;
    const stellar = {
      buildSponsoredFeeBumpXdr,
    } as unknown as StellarService;
    const orchestrator = new DefindexOrchestrator(defindex, prisma, stellar);

    await expect(
      orchestrator.submitDeposit('deposit-1', 'user-signed-xdr'),
    ).resolves.toEqual({ txHash: 'tx-hash' });
    expect(buildSponsoredFeeBumpXdr).toHaveBeenCalledWith(
      'user-signed-xdr',
      'unsigned-xdr',
    );
    expect(submitSignedTransaction).toHaveBeenCalledWith({
      xdr: 'fee-bump-xdr',
    });
    expect(updateDepositIntent).toHaveBeenCalledWith({
      where: { id: 'deposit-1' },
      data: {
        signedXdr: 'fee-bump-xdr',
        status: 'SIGNED_XDR_RECEIVED',
      },
    });
  });

  it('wraps a signed withdrawal in a treasury-sponsored fee bump', async () => {
    const prisma = {
      withdrawalIntent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          unsignedXdr: 'unsigned-withdraw-xdr',
          userId: 'user-1',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      transactionRecord: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
    const submitSignedTransaction = jest.fn().mockResolvedValue({
      txHash: 'withdraw-tx-hash',
      success: true,
    });
    const buildSponsoredFeeBumpXdr = jest
      .fn()
      .mockReturnValue('withdraw-fee-bump-xdr');
    const defindex = {
      submitSignedTransaction,
    } as unknown as DefindexService;
    const stellar = {
      buildSponsoredFeeBumpXdr,
    } as unknown as StellarService;
    const orchestrator = new DefindexOrchestrator(defindex, prisma, stellar);

    await expect(
      orchestrator.submitWithdrawal('withdrawal-1', 'user-signed-withdraw-xdr'),
    ).resolves.toEqual({ txHash: 'withdraw-tx-hash' });
    expect(buildSponsoredFeeBumpXdr).toHaveBeenCalledWith(
      'user-signed-withdraw-xdr',
      'unsigned-withdraw-xdr',
    );
    expect(submitSignedTransaction).toHaveBeenCalledWith({
      xdr: 'withdraw-fee-bump-xdr',
    });
  });
});
