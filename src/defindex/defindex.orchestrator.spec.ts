import { Decimal } from '@prisma/client/runtime/library';
import { DefindexOrchestrator } from './defindex.orchestrator';
import { DefindexService } from './defindex.service';
import { PrismaService } from '../infra/prisma/prisma.service';

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
    const defindex = {
      generateDepositXdr: jest.fn().mockResolvedValue({ xdr: 'unsigned-xdr' }),
    } as unknown as DefindexService;
    const orchestrator = new DefindexOrchestrator(defindex, prisma);

    await expect(orchestrator.buildDepositXdr('deposit-1')).resolves.toBe(
      'unsigned-xdr',
    );
    expect(defindex.generateDepositXdr).toHaveBeenCalledWith({
      vaultAddress: 'vault-address',
      callerAddress: 'wallet-address',
      amounts: [25_000_000],
    });
  });
});
