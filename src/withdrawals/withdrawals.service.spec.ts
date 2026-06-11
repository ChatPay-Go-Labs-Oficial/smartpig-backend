import { BadRequestException } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexOrchestrator } from '../defindex/defindex.orchestrator';

describe('WithdrawalsService', () => {
  it('rejects share precision beyond the 7 dfToken decimals', async () => {
    const createWithdrawalIntent = jest.fn();
    const prisma = {
      withdrawalIntent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: createWithdrawalIntent,
      },
      vaultCatalog: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vault-1',
          isActive: true,
        }),
      },
      walletAccount: {
        findFirst: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
      },
    } as unknown as PrismaService;
    const service = new WithdrawalsService(prisma, {} as DefindexOrchestrator);

    await expect(
      service.createWithdrawal({
        idempotencyKey: 'withdrawal-key',
        userId: 'user-1',
        walletAccountId: 'wallet-1',
        vaultId: 'vault-1',
        shareAmount: '1.00000001',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createWithdrawalIntent).not.toHaveBeenCalled();
  });
});
