jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LearningService } from './learning.service';
import { LEARNING_LESSONS } from './learning.catalog';
import { PrismaService } from '../infra/prisma/prisma.service';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';

function setup(config: Record<string, unknown> = {}) {
  const rewards = new Map<
    string,
    { userId: string; questionId: string; points: number }
  >();
  const prisma = {
    learningReward: {
      findMany: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(
          [...rewards.values()].filter((r) => r.userId === where.userId),
        ),
      ),
      createMany: jest.fn(
        ({
          data,
        }: {
          data: { userId: string; questionId: string; points: number }[];
        }) => {
          const row = data[0];
          const key = `${row.userId}:${row.questionId}`;
          if (rewards.has(key)) return Promise.resolve({ count: 0 });
          rewards.set(key, row);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    walletAccount: {
      findFirst: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    },
  };
  const privy = {
    getStellarWalletAddresses: jest.fn().mockResolvedValue(['GVERIFIED']),
  };
  const service = new LearningService(
    prisma as unknown as PrismaService,
    new ConfigService(config),
    privy as unknown as PrivyAuthService,
  );
  return { service, prisma, privy, rewards };
}

describe('Learning rewards and vault access', () => {
  it('keeps the answer key out of the lesson catalog', () => {
    const publicCatalog = JSON.stringify(setup().service.catalog());
    expect(publicCatalog).not.toContain('correctOptionId');
    expect(publicCatalog).not.toContain('explanation');
    expect(
      setup()
        .service.catalog()
        .every((l) => l.cards.length > 0),
    ).toBe(true);
  });

  it('awards nothing for incorrect answers and permits a correct retry', async () => {
    const { service, prisma } = setup();
    const wrong = await service.answer('user-1', 1, 'lesson-1-q-1', 'b', 1);
    expect(wrong).toMatchObject({
      correct: false,
      awardedPoints: 0,
      progress: { points: 0 },
    });
    expect(prisma.learningReward.createMany).not.toHaveBeenCalled();
    expect(
      await service.answer('user-1', 1, 'lesson-1-q-1', 'a', 1),
    ).toMatchObject({
      correct: true,
      awardedPoints: 10,
      progress: { points: 10 },
    });
  });

  it('does not award twice on retries or concurrent submissions', async () => {
    const { service, prisma } = setup();
    const answers = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.answer('user-1', 1, 'lesson-1-q-1', 'a', 1),
      ),
    );
    expect(answers.reduce((sum, r) => sum + r.awardedPoints, 0)).toBe(10);
    expect((await service.progress('user-1')).points).toBe(10);
    expect(prisma.learningReward.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('persists separate progress per user and derives identity from verified wallets', async () => {
    const { service, prisma, privy } = setup();
    await service.answer('user-1', 1, 'lesson-1-q-1', 'a', 1);
    expect((await service.progress('user-2')).points).toBe(0);
    expect(await service.resolveUserId('did:privy:alice')).toBe('user-1');
    expect(privy.getStellarWalletAddresses).toHaveBeenCalledWith(
      'did:privy:alice',
    );
    expect(prisma.walletAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stellarAddress: { in: ['GVERIFIED'] }, isActive: true },
      }),
    );
    prisma.walletAccount.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.resolveUserId('did:privy:unknown'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unknown options, stale content and skipping prerequisite lessons', async () => {
    const { service } = setup();
    await expect(
      service.answer('u', 1, 'lesson-1-q-1', 'z', 1),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.answer('u', 1, 'lesson-1-q-1', 'a', 2),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.answer('u', 4, 'lesson-4-q-1', 'b', 1),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('unlocks EURC at 90 and XLM at 150 unique points, with USDC always available', async () => {
    const { service } = setup();
    expect((await service.progress('u')).vaultAccess.USDC.unlocked).toBe(true);
    for (const lesson of LEARNING_LESSONS) {
      for (const q of lesson.questions)
        await service.answer(
          'u',
          lesson.id,
          q.id,
          q.correctOptionId,
          lesson.version,
        );
      const progress = await service.progress('u');
      expect(progress.vaultAccess.EURC.unlocked).toBe(lesson.id >= 3);
      expect(progress.vaultAccess.XLM.unlocked).toBe(lesson.id === 5);
    }
    expect((await service.progress('u')).completedLessonIds).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('supports configurable thresholds and native XLM naming; fails closed for unknown assets', () => {
    const { service } = setup({
      EDUCATION_EURC_POINTS: 40,
      EDUCATION_XLM_POINTS: 120,
    });
    expect(service.access('EURC', 39).unlocked).toBe(false);
    expect(service.access('EURC', 40).unlocked).toBe(true);
    expect(service.access('native', 120).unlocked).toBe(true);
    expect(service.access('OTHER', 99999).unlocked).toBe(false);
  });

  it('enforces configuration and education on deposits; USDC does not require a points query', async () => {
    const { service, prisma } = setup({
      ALLOWED_VAULT_IDS: ' v1, v2 ',
      DISABLED_DEPOSIT_VAULT_IDS: 'v2',
    });
    await expect(
      service.assertDepositAccess('u', {
        id: 'v1',
        isActive: true,
        assetSymbol: 'USDC',
      }),
    ).resolves.toBeUndefined();
    expect(prisma.learningReward.findMany).not.toHaveBeenCalled();
    for (const vault of [
      { id: 'v1', isActive: true, assetSymbol: 'XLM' },
      { id: 'v1', isActive: false, assetSymbol: 'USDC' },
      { id: 'v2', isActive: true, assetSymbol: 'USDC' },
      { id: 'v3', isActive: true, assetSymbol: 'USDC' },
    ])
      await expect(
        service.assertDepositAccess('u', vault),
      ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
