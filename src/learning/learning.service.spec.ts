import { LearningService } from './learning.service';
import { ConflictException } from '@nestjs/common';

function setup(options: {
  correctOption?: string;
  priorCorrect?: Date | null;
  correctCount?: number;
}) {
  const question = {
    id: 'question-id',
    key: 'M1-Q01',
    moduleId: 'module-id',
    contentVersion: 1,
    correctOptionKey: options.correctOption ?? 'B',
    successFeedback: 'Isso!',
    retryFeedback: 'Vamos ver um exemplo?',
    xpReward: 10,
    isActive: true,
    module: {
      id: 'module-id',
      key: 'M1',
      isPublished: true,
      completionXp: 40,
      contentVersion: 1,
    },
    options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }],
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
    learningQuestion: {
      findUnique: jest.fn().mockResolvedValue(question),
      count: jest.fn().mockResolvedValue(6),
    },
    userLearningQuestionProgress: {
      findUnique: jest.fn().mockResolvedValue({
        firstCorrectAt: options.priorCorrect ?? null,
      }),
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(options.correctCount ?? 0),
    },
    userLearningModuleProgress: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    experienceAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ totalXp: 100, currentLevel: 2 }),
    },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const experience = {
    grant: jest
      .fn()
      .mockResolvedValueOnce({ pointsGranted: 10 })
      .mockResolvedValueOnce({ pointsGranted: 40 }),
  };
  return {
    service: new LearningService(prisma as never, experience as never),
    tx,
    experience,
  };
}

describe('LearningService.submitAnswer', () => {
  it('rejects an answer produced from a stale content version', async () => {
    const { service, tx, experience } = setup({ correctCount: 0 });

    await expect(
      service.submitAnswer('user-a', 'M1-Q01', 'B', 2),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.userLearningQuestionProgress.upsert).not.toHaveBeenCalled();
    expect(experience.grant).not.toHaveBeenCalled();
  });

  it('records an incorrect attempt without granting XP', async () => {
    const { service, experience } = setup({ correctCount: 0 });

    await expect(
      service.submitAnswer('user-a', 'M1-Q01', 'A', 1),
    ).resolves.toMatchObject({
      correct: false,
      xpGranted: 0,
      moduleCompleted: false,
    });
    expect(experience.grant).not.toHaveBeenCalled();
  });

  it('grants question and module XP once the sixth answer is correct', async () => {
    const { service, experience } = setup({ correctCount: 6 });

    await expect(
      service.submitAnswer('user-a', 'M1-Q01', 'B', 1),
    ).resolves.toMatchObject({
      correct: true,
      firstCorrect: true,
      questionXpGranted: 10,
      moduleXpGranted: 40,
      moduleCompleted: true,
    });
    expect(experience.grant).toHaveBeenCalledTimes(2);
  });
});
