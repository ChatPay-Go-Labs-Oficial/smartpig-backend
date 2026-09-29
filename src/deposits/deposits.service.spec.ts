jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
import { LearningService } from '../learning/learning.service';
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
    };
    const service = new DepositsService(
      prisma as unknown as PrismaService,
      {} as DefindexOrchestrator,
      {} as LearningService,
    );

    await expect(service.createDeposit(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.depositIntent.create).not.toHaveBeenCalled();
  });
});

describe('Deposit access enforcement', () => {
  it('does not generate an XDR for a vault still locked by education', async () => {
    const prisma = {
      depositIntent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      vaultCatalog: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'v',
          isActive: true,
          assetSymbol: 'XLM',
          assetDecimals: 7,
        }),
      },
    };
    const orchestrator = { buildDepositXdr: jest.fn() };
    const learning = {
      assertDepositAccess: jest.fn().mockRejectedValue(new Error('locked')),
    };
    const service = new DepositsService(
      prisma as unknown as PrismaService,
      orchestrator as unknown as DefindexOrchestrator,
      learning as unknown as LearningService,
    );
    await expect(
      service.createDeposit({
        idempotencyKey: 'k',
        userId: 'u',
        walletAccountId: 'w',
        vaultId: 'v',
        amount: '10',
        assetSymbol: 'XLM',
      }),
    ).rejects.toThrow('locked');
    expect(prisma.depositIntent.create).not.toHaveBeenCalled();
    expect(orchestrator.buildDepositXdr).not.toHaveBeenCalled();
  });

  it('rechecks access before submitting a previously generated XDR', async () => {
    const prisma = {
      depositIntent: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'i',
          userId: 'u',
          vaultId: 'v',
          status: 'XDR_GENERATED',
          expiresAt: new Date(Date.now() + 60000),
        }),
      },
      vaultCatalog: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'v', isActive: false, assetSymbol: 'XLM' }),
      },
    };
    const orchestrator = { submitDeposit: jest.fn() };
    const learning = {
      assertDepositAccess: jest.fn().mockRejectedValue(new Error('paused')),
    };
    const service = new DepositsService(
      prisma as unknown as PrismaService,
      orchestrator as unknown as DefindexOrchestrator,
      learning as unknown as LearningService,
    );
    await expect(
      service.submitSignedXdr('i', { signedXdr: 'signed' }, 'u'),
    ).rejects.toThrow('paused');
    expect(orchestrator.submitDeposit).not.toHaveBeenCalled();
    await expect(
      service.submitSignedXdr('i', { signedXdr: 'signed' }, 'other-user'),
    ).rejects.toThrow('Deposit not found');
  });
});

describe('Deposit read ownership', () => {
  it('hides another user intent, including its unsigned XDR', async () => {
    const prisma = {
      depositIntent: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'i',
          userId: 'owner',
          unsignedXdr: 'private-intent',
        }),
      },
    };
    const service = new DepositsService(
      prisma as unknown as PrismaService,
      {} as DefindexOrchestrator,
      {} as LearningService,
    );
    await expect(service.getDeposit('i', 'other')).rejects.toThrow(
      'Deposit not found',
    );
    await expect(service.getDeposit('i', 'owner')).resolves.toMatchObject({
      id: 'i',
    });
  });
});
