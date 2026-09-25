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

describe('Withdrawal availability', () => {
  it('allows an existing position to exit a vault disabled for new deposits', async () => {
    const prisma = {
      withdrawalIntent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'withdrawal-1' }),
      },
      vaultCatalog: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'vault-1', isActive: false }),
      },
      walletAccount: {
        findFirst: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
      },
    };
    const orchestrator = {
      buildWithdrawXdr: jest.fn().mockResolvedValue('unsigned-xdr'),
    };
    const service = new WithdrawalsService(
      prisma as unknown as PrismaService,
      orchestrator as unknown as DefindexOrchestrator,
    );
    await expect(
      service.createWithdrawal({
        idempotencyKey: 'exit',
        userId: 'u',
        walletAccountId: 'wallet-1',
        vaultId: 'vault-1',
        shareAmount: '1',
      }),
    ).resolves.toMatchObject({ unsignedXdr: 'unsigned-xdr' });
  });
});

describe('Withdrawal ownership', () => {
  it('rejects reading or submitting another user intent before broadcasting', async () => {
    const prisma = {
      withdrawalIntent: {
        findUnique: jest.fn().mockResolvedValue({ id: 'i', userId: 'owner' }),
      },
    };
    const orchestrator = { submitWithdrawal: jest.fn() };
    const service = new WithdrawalsService(
      prisma as unknown as PrismaService,
      orchestrator as unknown as DefindexOrchestrator,
    );
    await expect(service.getWithdrawal('i', 'other')).rejects.toThrow(
      'Withdrawal not found',
    );
    await expect(
      service.submitSignedXdr('i', { signedXdr: 'signed' }, 'other'),
    ).rejects.toThrow('Withdrawal not found');
    expect(orchestrator.submitWithdrawal).not.toHaveBeenCalled();
    await expect(service.getWithdrawal('i', 'owner')).resolves.toMatchObject({
      id: 'i',
    });
  });
  it('does not expose another user intent via an idempotency collision', async () => {
    const prisma = {
      withdrawalIntent: {
        findUnique: jest.fn().mockResolvedValue({ id: 'i', userId: 'owner' }),
      },
    };
    const service = new WithdrawalsService(
      prisma as unknown as PrismaService,
      {} as DefindexOrchestrator,
    );
    await expect(
      service.createWithdrawal({
        idempotencyKey: 'collision',
        userId: 'other',
        walletAccountId: 'w',
        vaultId: 'v',
        shareAmount: '1',
      }),
    ).rejects.toThrow('Idempotency key already used');
  });
});
