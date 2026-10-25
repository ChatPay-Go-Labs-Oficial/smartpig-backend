import { ConflictException } from '@nestjs/common';
import { VaultEligibilityService } from './vault-eligibility.service';

function createService(options?: {
  mode?: 'LITE' | 'PRO' | null;
  asset?: string;
  unlock?: { policyVersion: number; levelAtUnlock: number } | null;
  policy?: Record<string, unknown> | null;
  level?: number;
  completedModuleIds?: string[];
  enforce?: boolean;
}) {
  const policy =
    options?.policy === undefined
      ? {
          id: 'policy-1',
          version: 2,
          minimumLevel: 5,
          requiredModules: [
            { moduleId: 'module-1', module: { key: 'M1' } },
            { moduleId: 'module-2', module: { key: 'M2' } },
            { moduleId: 'module-3', module: { key: 'M3' } },
          ],
        }
      : options.policy;
  const completed = options?.completedModuleIds ?? [
    'module-1',
    'module-2',
    'module-3',
  ];

  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        experienceMode: options?.mode === undefined ? 'LITE' : options.mode,
      }),
    },
    userVaultUnlock: {
      findUnique: jest.fn().mockResolvedValue(options?.unlock ?? null),
      upsert: jest.fn().mockResolvedValue({ id: 'unlock-1' }),
    },
    vaultEligibilityPolicy: {
      findFirst: jest.fn().mockResolvedValue(policy),
      findMany: jest.fn().mockResolvedValue([]),
    },
    experienceAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ currentLevel: options?.level ?? 5 }),
    },
    userLearningModuleProgress: {
      findMany: jest
        .fn()
        .mockResolvedValue(completed.map((moduleId) => ({ moduleId }))),
    },
  };

  return {
    prisma,
    asset: options?.asset ?? 'EURC',
    service: new VaultEligibilityService(
      prisma as never,
      {
        get: jest.fn().mockReturnValue(options?.enforce ?? true),
      } as never,
    ),
  };
}

describe('VaultEligibilityService', () => {
  it('treats a legacy null mode as PRO and preserves the current flow', async () => {
    const { service, prisma } = createService({ mode: null });

    const result = await service.assertEligibleForDeposit(
      'user-1',
      'vault-1',
      'EURC',
    );

    expect(result).toMatchObject({
      eligible: true,
      mode: 'PRO',
      source: 'PRO_BYPASS',
    });
    expect(prisma.vaultEligibilityPolicy.findFirst).not.toHaveBeenCalled();
  });

  it('keeps USDC open for Lite without requiring a policy', async () => {
    const { service, prisma } = createService({ mode: 'LITE' });

    const result = await service.assertEligibleForDeposit(
      'user-1',
      'vault-usdc',
      'usdc',
    );

    expect(result.source).toBe('USDC_OPEN');
    expect(prisma.vaultEligibilityPolicy.findFirst).not.toHaveBeenCalled();
  });

  it('returns an acquired unlock before evaluating a newer policy', async () => {
    const { service, prisma } = createService({
      unlock: { policyVersion: 1, levelAtUnlock: 5 },
    });

    const result = await service.assertEligibleForDeposit(
      'user-1',
      'vault-1',
      'EURC',
    );

    expect(result.source).toBe('PERSISTED_UNLOCK');
    expect(prisma.vaultEligibilityPolicy.findFirst).not.toHaveBeenCalled();
  });

  it('persists an unlock when level and all modules satisfy the policy', async () => {
    const { service, prisma } = createService({ level: 5 });

    const result = await service.assertEligibleForDeposit(
      'user-1',
      'vault-1',
      'EURC',
    );

    expect(result.eligible).toBe(true);
    expect(prisma.userVaultUnlock.upsert).toHaveBeenCalledWith({
      where: { userId_vaultId: { userId: 'user-1', vaultId: 'vault-1' } },
      create: {
        userId: 'user-1',
        vaultId: 'vault-1',
        policyId: 'policy-1',
        policyVersion: 2,
        levelAtUnlock: 5,
      },
      update: {},
    });
  });

  it('rejects with actionable 409 details when requirements are missing', async () => {
    const { service, prisma } = createService({
      level: 4,
      completedModuleIds: ['module-1', 'module-2'],
    });

    const error = await service
      .assertEligibleForDeposit('user-1', 'vault-1', 'EURC')
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'VAULT_EDUCATION_LOCKED',
      details: {
        currentLevel: 4,
        minimumLevel: 5,
        missingModules: ['M3'],
        policyVersion: 2,
      },
    });
    expect(prisma.userVaultUnlock.upsert).not.toHaveBeenCalled();
  });

  it('fails closed for Lite when no education policy is published', async () => {
    const { service } = createService({ policy: null, enforce: true });

    const error = await service
      .assertEligibleForDeposit('user-1', 'vault-1', 'EURC')
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'VAULT_EDUCATION_LOCKED',
      details: {
        vaultId: 'vault-1',
        minimumLevel: null,
        policyVersion: null,
      },
    });
  });

  it('evaluates but does not block during the staged rollout', async () => {
    const { service, prisma } = createService({
      level: 4,
      completedModuleIds: ['module-1'],
      enforce: false,
    });

    await expect(
      service.assertEligibleForDeposit('user-1', 'vault-1', 'EURC'),
    ).resolves.toMatchObject({
      eligible: false,
      currentLevel: 4,
      missingModules: ['M2', 'M3'],
    });
    expect(prisma.userVaultUnlock.upsert).not.toHaveBeenCalled();
  });

  it('refreshes and persists newly qualified Lite policies outside deposits', async () => {
    const { service, prisma } = createService({ level: 5 });
    prisma.vaultEligibilityPolicy.findMany.mockResolvedValue([
      { vaultId: 'vault-1', vault: { assetSymbol: 'EURC' } },
    ]);

    const results = await service.refreshUnlocksForUser('user-1');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ eligible: true, source: 'POLICY' });
    expect(prisma.userVaultUnlock.upsert).toHaveBeenCalled();
  });

  it('does not persist an unlock from the visibility read model', async () => {
    const { service, prisma } = createService({ level: 5 });

    const result = await service.getEligibility('user-1', 'vault-1', 'EURC');

    expect(result.eligible).toBe(true);
    expect(prisma.userVaultUnlock.upsert).not.toHaveBeenCalled();
  });
});
