import { LearningService } from './learning.service';
import { ConflictException } from '@nestjs/common';

function setup(options: {
  correctOption?: string;
  priorCorrect?: Date | null;
  correctCount?: number;
  completedLessonCount?: number;
}) {
  const question = {
    id: 'question-id',
    key: 'L1-Q01',
    moduleId: 'module-id',
    contentVersion: 1,
    correctOptionKey: options.correctOption ?? 'B',
    successFeedback: 'Isso!',
    retryFeedback: 'Vamos ver um exemplo?',
    xpReward: 0,
    isActive: true,
    module: {
      id: 'module-id',
      key: 'M1',
      isPublished: true,
      completionXp: 15,
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
    learningModule: {
      count: jest.fn().mockResolvedValue(5),
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
      count: jest.fn().mockResolvedValue(options.completedLessonCount ?? 1),
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
    grant: jest.fn().mockResolvedValue({ pointsGranted: 15 }),
  };
  const eligibility = {
    refreshUnlocksForUser: jest.fn().mockResolvedValue([]),
  };
  const config = {
    get: jest.fn((_key: string, fallback: number) => fallback),
  };
  return {
    service: new LearningService(
      prisma as never,
      experience as never,
      eligibility as never,
      config as never,
    ),
    tx,
    experience,
    eligibility,
  };
}

describe('LearningService.submitAnswer', () => {
  it('rejects an answer produced from a stale content version', async () => {
    const { service, tx, experience } = setup({ correctCount: 0 });

    await expect(
      service.submitAnswer('user-a', 'L1-Q01', 'B', 2),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.userLearningQuestionProgress.upsert).not.toHaveBeenCalled();
    expect(experience.grant).not.toHaveBeenCalled();
  });

  it('records an incorrect attempt without granting XP', async () => {
    const { service, experience, eligibility } = setup({ correctCount: 0 });

    await expect(
      service.submitAnswer('user-a', 'L1-Q01', 'A', 1),
    ).resolves.toMatchObject({
      correct: false,
      xpGranted: 0,
      lessonCompleted: false,
      moduleCompleted: false,
    });
    expect(experience.grant).not.toHaveBeenCalled();
    expect(eligibility.refreshUnlocksForUser).not.toHaveBeenCalled();
  });

  it('grants lesson XP, but no question XP, once the sixth answer is correct', async () => {
    const { service, experience, eligibility } = setup({ correctCount: 6 });

    await expect(
      service.submitAnswer('user-a', 'L1-Q01', 'B', 1),
    ).resolves.toMatchObject({
      correct: true,
      firstCorrect: true,
      questionXpGranted: 0,
      moduleXpGranted: 15,
      xpAwarded: 15,
      lessonCompleted: true,
      moduleCompleted: false,
    });
    expect(experience.grant).toHaveBeenCalledTimes(1);
    expect(experience.grant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceRef: 'lesson:M1', points: 15 }),
    );
    expect(eligibility.refreshUnlocksForUser).toHaveBeenCalledWith('user-a');
  });

  it('adds the 45 XP introduction bonus when the fifth lesson completes', async () => {
    const { service, experience } = setup({
      correctCount: 6,
      completedLessonCount: 5,
    });
    experience.grant
      .mockResolvedValueOnce({ pointsGranted: 15 })
      .mockResolvedValueOnce({ pointsGranted: 45 });

    await expect(
      service.submitAnswer('user-a', 'L1-Q01', 'B', 1),
    ).resolves.toMatchObject({
      lessonCompleted: true,
      moduleCompleted: true,
      xpAwarded: 60,
    });
    expect(experience.grant).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceRef: 'module:INTRO', points: 45 }),
    );
  });

  it('returns the committed answer when the derived unlock refresh fails', async () => {
    const { service, eligibility } = setup({ correctCount: 6 });
    eligibility.refreshUnlocksForUser.mockRejectedValueOnce(
      new Error('temporary database failure'),
    );

    await expect(
      service.submitAnswer('user-a', 'L1-Q01', 'B', 1),
    ).resolves.toMatchObject({
      correct: true,
      xpGranted: 15,
      lessonCompleted: true,
    });
  });
});
