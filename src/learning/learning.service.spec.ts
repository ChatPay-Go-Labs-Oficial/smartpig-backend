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
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  return {
    service: new LearningService(prisma as never),
    tx,
  };
}

describe('LearningService.submitAnswer', () => {
  it('rejects an answer produced from a stale content version', async () => {
    const { service, tx } = setup({ correctCount: 0 });

    await expect(
      service.submitAnswer('user-a', 'M1-Q01', 'B', 2),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.userLearningQuestionProgress.upsert).not.toHaveBeenCalled();
  });

  it('records an incorrect attempt without completing the module', async () => {
    const { service } = setup({ correctCount: 0 });

    await expect(
      service.submitAnswer('user-a', 'M1-Q01', 'A', 1),
    ).resolves.toMatchObject({
      correct: false,
      moduleCompleted: false,
    });
  });

  it('completes the module once the sixth answer is correct', async () => {
    const { service } = setup({ correctCount: 6 });

    await expect(
      service.submitAnswer('user-a', 'M1-Q01', 'B', 1),
    ).resolves.toMatchObject({
      correct: true,
      firstCorrect: true,
      moduleCompleted: true,
    });
  });
});
