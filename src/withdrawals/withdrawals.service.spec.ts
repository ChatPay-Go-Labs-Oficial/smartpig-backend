import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { WithdrawalsService } from './withdrawals.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexOrchestrator } from '../defindex/defindex.orchestrator';

describe('WithdrawalsService', () => {
  it('stores the requested asset amount separately from vault shares', async () => {
    const createWithdrawalIntent = jest.fn().mockResolvedValue({
      id: 'withdrawal-1',
    });
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
    const orchestrator = {
      buildWithdrawXdr: jest.fn().mockResolvedValue('unsigned-xdr'),
    } as unknown as DefindexOrchestrator;
    const service = new WithdrawalsService(prisma, orchestrator);

    await service.createWithdrawal({
      idempotencyKey: 'withdrawal-key',
      userId: 'user-1',
      walletAccountId: 'wallet-1',
      vaultId: 'vault-1',
      shareAmount: '0.9800000',
      requestedAmount: '1.0000000',
    });

    const [{ data }] = createWithdrawalIntent.mock.calls[0] as [
      { data: { shareAmount: Decimal; requestedAmount: Decimal } },
    ];
    expect(data.shareAmount.toString()).toBe('0.98');
    expect(data.requestedAmount.toString()).toBe('1');
  });

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
