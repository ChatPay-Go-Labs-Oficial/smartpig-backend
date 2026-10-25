import { ConflictException, NotFoundException } from '@nestjs/common';
import { LearningService } from './learning.service';

function setup(
  options: {
    correctCount?: number;
    completedLessons?: number;
    priorCompleted?: boolean;
    priorCorrect?: boolean;
  } = {},
) {
  const question = {
    id: 'q1',
    key: 'M1-Q01',
    moduleId: 'm1',
    contentVersion: 3,
    correctOptionKey: 'B',
    successFeedback: 'yes',
    retryFeedback: 'retry',
    xpReward: 0,
    isActive: true,
    module: {
      id: 'm1',
      key: 'M1',
      isPublished: true,
      completionXp: 15,
      contentVersion: 3,
    },
    options: [{ key: 'A' }, { key: 'B' }],
  };
  let totalXp = 0;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    learningQuestion: {
      findUnique: jest.fn().mockResolvedValue(question),
      count: jest.fn().mockResolvedValue(6),
    },
    userLearningQuestionProgress: {
      findUnique: jest.fn().mockResolvedValue({
        firstCorrectAt: options.priorCorrect ? new Date() : null,
      }),
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(options.correctCount ?? 0),
    },
    userLearningModuleProgress: {
      findUnique: jest.fn().mockResolvedValue({
        completedAt: options.priorCompleted ? new Date() : null,
      }),
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(options.completedLessons ?? 0),
    },
    experienceAccount: {
      findUnique: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ totalXp, currentLevel: 0 }),
        ),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (db: typeof tx) => unknown) => fn(tx)),
  };
  const ledger = {
    grant: jest
      .fn()
      .mockImplementation((_db: unknown, input: { points: number }) => {
        totalXp += input.points;
        return Promise.resolve({ pointsGranted: input.points });
      }),
  };
  const eligibility = {
    refreshUnlocksForUser: jest.fn().mockResolvedValue([
      { vaultId: 'eurc', newlyUnlocked: true },
      { vaultId: 'old', newlyUnlocked: false },
    ]),
  };
  return {
    service: new LearningService(
      prisma as never,
      ledger as never,
      eligibility as never,
    ),
    tx,
    ledger,
    eligibility,
  };
}

describe('Learning answers mobile integration', () => {
  it('rejects stale content with the expected code before recording attempts', async () => {
    const { service, tx } = setup();
    await expect(
      service.submitAnswer('u', 'M1-Q01', 'B', 2),
    ).rejects.toMatchObject({
      response: { code: 'LEARNING_CONTENT_VERSION_STALE' },
    });
    expect(tx.userLearningQuestionProgress.upsert).not.toHaveBeenCalled();
  });
  it('rejects unknown alternatives', async () => {
    await expect(
      setup().service.submitAnswer('u', 'M1-Q01', 'X', 3),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('awards no XP for an incorrect answer', async () => {
    const { service, ledger, eligibility } = setup();
    await expect(
      service.submitAnswer('u', 'M1-Q01', 'A', 3),
    ).resolves.toMatchObject({ correct: false, xpAwarded: 0, newUnlocks: [] });
    expect(ledger.grant).not.toHaveBeenCalled();
    expect(eligibility.refreshUnlocksForUser).not.toHaveBeenCalled();
  });
  it('awards no individual-question XP', async () => {
    const { service, ledger } = setup({ correctCount: 1 });
    await expect(
      service.submitAnswer('u', 'M1-Q01', 'B', 3),
    ).resolves.toMatchObject({
      firstCorrect: true,
      xpAwarded: 0,
      lessonCompleted: false,
    });
    expect(ledger.grant).not.toHaveBeenCalled();
  });
  it('awards 15 XP once per lesson and returns newly created unlocks', async () => {
    const { service, ledger, tx } = setup({
      correctCount: 6,
      completedLessons: 1,
    });
    await expect(
      service.submitAnswer('u', 'M1-Q01', 'B', 3),
    ).resolves.toMatchObject({
      lessonCompleted: true,
      moduleCompleted: false,
      xpAwarded: 15,
      totalXp: 15,
      levelBefore: 0,
      levelAfter: 0,
      tierAfter: 'UNRANKED',
      newUnlocks: [{ vaultId: 'eurc', newlyUnlocked: true }],
    });
    expect(ledger.grant).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ sourceRef: 'lesson:M1', points: 15 }),
    );
  });
  it('adds the INTRO bonus only when all five lessons are complete', async () => {
    const { service, ledger, tx } = setup({
      correctCount: 6,
      completedLessons: 5,
    });
    await expect(
      service.submitAnswer('u', 'M1-Q01', 'B', 3),
    ).resolves.toMatchObject({
      xpAwarded: 60,
      moduleCompleted: true,
      levelAfter: 1,
    });
    expect(ledger.grant).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ sourceRef: 'module:INTRO', points: 45 }),
    );
  });
  it('does not re-credit a completed lesson', async () => {
    const { service, ledger } = setup({
      correctCount: 6,
      completedLessons: 1,
      priorCompleted: true,
      priorCorrect: true,
    });
    await expect(
      service.submitAnswer('u', 'M1-Q01', 'B', 3),
    ).resolves.toMatchObject({ xpAwarded: 0, firstCorrect: false });
    expect(ledger.grant).not.toHaveBeenCalled();
  });
  it('rolls the answer transaction back on unlock failure rather than losing a notification', async () => {
    const { service, eligibility } = setup({ correctCount: 6 });
    eligibility.refreshUnlocksForUser.mockRejectedValue(
      new ConflictException('retry'),
    );
    await expect(
      service.submitAnswer('u', 'M1-Q01', 'B', 3),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
