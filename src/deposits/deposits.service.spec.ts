import { BadRequestException } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexOrchestrator } from '../defindex/defindex.orchestrator';

describe('DepositsService', () => {
  const dto = {
    idempotencyKey: 'deposit-key',
    userId: 'user-1',
    walletAccountId: 'wallet-1',
    vaultId: 'vault-1',
    amount: '2',
    assetSymbol: 'EURC',
  };

  it('rejects an asset that does not match the vault', async () => {
    const prisma = {
      depositIntent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      vaultCatalog: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vault-1',
          isActive: true,
          assetSymbol: 'USDC',
          assetDecimals: 7,
        }),
      },
    } as unknown as PrismaService;
    const service = new DepositsService(prisma, {} as DefindexOrchestrator);

    await expect(service.createDeposit(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.depositIntent.create).not.toHaveBeenCalled();
  });
});
