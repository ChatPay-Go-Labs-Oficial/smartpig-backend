import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExperienceXpSourceType, Prisma } from '@prisma/client';
import { ExperienceLedgerService } from '../experience/experience-ledger.service';
import { ConfigService } from '@nestjs/config';
import { calculateExperienceLevel } from '../experience/experience-level';
import { PrismaService } from '../infra/prisma/prisma.service';
import { VaultEligibilityService } from '../vault-eligibility/vault-eligibility.service';

const questionPublicSelect = {
  key: true,
  reviewScreenKey: true,
  stepOrder: true,
  contentVersion: true,
  prompt: true,
  xpReward: true,
  isRequired: true,
  displayOrder: true,
  options: {
    orderBy: { displayOrder: 'asc' as const },
    select: { key: true, text: true, displayOrder: true },
  },
};

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly experience: ExperienceLedgerService,
    private readonly vaultEligibility: VaultEligibilityService,
    private readonly config: ConfigService = new ConfigService(),
  ) {}

  async listStandaloneContent() {
    return this.prisma.learningContentItem.findMany({
      where: { moduleId: null, isActive: true, type: { not: 'PRACTICE' } },
      orderBy: { displayOrder: 'asc' },
      select: {
        key: true,
        type: true,
        contentVersion: true,
        title: true,
        content: true,
        displayOrder: true,
      },
    });
  }

  async listModules(userId: string) {
    const modules = await this.prisma.learningModule.findMany({
      where: { isPublished: true },
      orderBy: { displayOrder: 'asc' },
      select: {
        key: true,
        title: true,
        description: true,
        displayOrder: true,
        contentVersion: true,
        completionXp: true,
        _count: {
          select: {
            questions: { where: { isActive: true, isRequired: true } },
          },
        },
      },
    });

    const progress = await this.prisma.userLearningModuleProgress.findMany({
      where: { userId, module: { isPublished: true } },
      select: {
        completedAt: true,
        lastContentItemKey: true,
        module: { select: { key: true } },
      },
    });
    const byModule = new Map(progress.map((item) => [item.module.key, item]));

    return modules.map((module) => ({
      ...module,
      questionCount: module._count.questions,
      _count: undefined,
      completedAt: byModule.get(module.key)?.completedAt ?? null,
      lastContentItemKey: byModule.get(module.key)?.lastContentItemKey ?? null,
    }));
  }

  async getModule(userId: string, moduleKey: string) {
    const module = await this.prisma.learningModule.findUnique({
      where: { key: moduleKey },
      select: {
        id: true,
        key: true,
        title: true,
        description: true,
        displayOrder: true,
        contentVersion: true,
        completionXp: true,
        isPublished: true,
        contentItems: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          select: {
            key: true,
            type: true,
            contentVersion: true,
            title: true,
            content: true,
            displayOrder: true,
            isRequired: true,
          },
        },
        questions: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          select: questionPublicSelect,
        },
      },
    });

    if (!module?.isPublished) {
      throw new NotFoundException(`Learning module ${moduleKey} not found`);
    }

    const [questionProgress, moduleProgress] = await Promise.all([
      this.prisma.userLearningQuestionProgress.findMany({
        where: { userId, question: { moduleId: module.id } },
        select: {
          attempts: true,
          firstCorrectAt: true,
          lastAnsweredAt: true,
          question: { select: { key: true } },
        },
      }),
      this.prisma.userLearningModuleProgress.findUnique({
        where: { userId_moduleId: { userId, moduleId: module.id } },
        select: {
          completedAt: true,
          lastContentItemKey: true,
          startedAt: true,
        },
      }),
    ]);

    const progressByQuestion = new Map(
      questionProgress.map((item) => [item.question.key, item]),
    );

    return {
      ...module,
      catalogFormatVersion: '1.1.1',
      contentUpgradePending: true,
      id: undefined,
      isPublished: undefined,
      steps: [
        ...module.contentItems.map((item) => ({
          kind: 'SCREEN' as const,
          order: item.displayOrder * 2,
          ...item,
        })),
        ...module.questions.map((question) => ({
          kind: 'QUESTION' as const,
          order: question.stepOrder ?? question.displayOrder * 2 + 1,
          ...question,
        })),
      ].sort((a, b) => a.order - b.order),
      questions: module.questions.map((question) => ({
        ...question,
        progress: progressByQuestion.get(question.key) ?? null,
      })),
      progress: moduleProgress,
    };
  }

  async progress(userId: string) {
    const [profile, modules, completedQuestions, resume] = await Promise.all([
      this.experience.profile(userId),
      this.listModules(userId),
      this.prisma.userLearningQuestionProgress.findMany({
        where: {
          userId,
          firstCorrectAt: { not: null },
          question: { isActive: true, module: { isPublished: true } },
        },
        orderBy: { firstCorrectAt: 'asc' },
        select: { question: { select: { key: true } } },
      }),
      this.prisma.userLearningModuleProgress.findFirst({
        where: { userId, completedAt: null, module: { isPublished: true } },
        orderBy: { updatedAt: 'desc' },
        select: {
          lastContentItemKey: true,
          module: { select: { key: true } },
        },
      }),
    ]);
    return {
      profile,
      modules,
      completedQuestionIds: completedQuestions.map((item) => item.question.key),
      resume: resume
        ? {
            moduleId: resume.module.key,
            contentItemId: resume.lastContentItemKey,
          }
        : null,
    };
  }

  async markContent(userId: string, moduleKey: string, contentItemKey: string) {
    const module = await this.prisma.learningModule.findUnique({
      where: { key: moduleKey },
      select: {
        id: true,
        isPublished: true,
        contentItems: {
          where: { key: contentItemKey, isActive: true },
          select: { key: true },
        },
      },
    });
    if (!module?.isPublished || module.contentItems.length === 0) {
      throw new NotFoundException('Learning content not found');
    }

    return this.prisma.userLearningModuleProgress.upsert({
      where: { userId_moduleId: { userId, moduleId: module.id } },
      create: {
        userId,
        moduleId: module.id,
        lastContentItemKey: contentItemKey,
      },
      update: { lastContentItemKey: contentItemKey },
      select: { lastContentItemKey: true, startedAt: true, completedAt: true },
    });
  }

  async submitAnswer(
    userId: string,
    questionKey: string,
    optionKey: string,
    contentVersion: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // One lock across lessons and daily grants, so INTRO completion and level deltas are consistent.
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`experience:${userId}`}))`,
      );
      const before = calculateExperienceLevel(
        (await this.experienceProfile(tx, userId)).totalXp,
      );
      const question = await tx.learningQuestion.findUnique({
        where: { key: questionKey },
        include: {
          module: true,
          options: { select: { key: true } },
        },
      });
      if (!question?.isActive || !question.module.isPublished) {
        throw new NotFoundException(
          `Learning question ${questionKey} not found`,
        );
      }
      if (question.contentVersion !== contentVersion) {
        throw new ConflictException({
          statusCode: 409,
          code: 'LEARNING_CONTENT_VERSION_STALE',
          message: 'Learning content changed. Reload before answering.',
          details: {
            questionId: question.key,
            currentVersion: question.contentVersion,
          },
        });
      }
      if (!question.options.some((option) => option.key === optionKey)) {
        throw new NotFoundException(
          'Answer option not found for this question',
        );
      }

      // Two devices can answer the last two pending questions together. The
      // transaction-scoped lock serializes completion for this user/module so
      // the second transaction observes the first and awards the module bonus.
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`${userId}:${question.moduleId}`}))`,
      );

      const prior = await tx.userLearningQuestionProgress.findUnique({
        where: {
          userId_questionId: { userId, questionId: question.id },
        },
        select: { firstCorrectAt: true },
      });
      const correct = optionKey === question.correctOptionKey;
      const firstCorrect = correct && !prior?.firstCorrectAt;
      const answeredAt = new Date();

      await tx.userLearningQuestionProgress.upsert({
        where: {
          userId_questionId: { userId, questionId: question.id },
        },
        create: {
          userId,
          questionId: question.id,
          attempts: 1,
          firstCorrectAt: correct ? answeredAt : null,
          lastAnsweredAt: answeredAt,
          lastSelectedOptionKey: optionKey,
          lastContentVersion: question.contentVersion,
        },
        update: {
          attempts: { increment: 1 },
          ...(firstCorrect ? { firstCorrectAt: answeredAt } : {}),
          lastAnsweredAt: answeredAt,
          lastSelectedOptionKey: optionKey,
          lastContentVersion: question.contentVersion,
        },
      });

      let questionXpGranted = 0;
      if (correct && firstCorrect && question.xpReward > 0) {
        const grant = await this.experience.grant(tx, {
          userId,
          sourceType: ExperienceXpSourceType.LEARNING_QUESTION,
          sourceRef: question.key,
          points: question.xpReward,
          metadata: { contentVersion: question.contentVersion },
        });
        questionXpGranted = grant.pointsGranted;
      }

      const requiredCount = await tx.learningQuestion.count({
        where: {
          moduleId: question.moduleId,
          isActive: true,
          isRequired: true,
        },
      });
      const correctCount = await tx.userLearningQuestionProgress.count({
        where: {
          userId,
          firstCorrectAt: { not: null },
          question: {
            moduleId: question.moduleId,
            isActive: true,
            isRequired: true,
          },
        },
      });
      const lessonCompleted =
        requiredCount > 0 && correctCount >= requiredCount;
      let moduleXpGranted = 0;

      const priorModule = await tx.userLearningModuleProgress.findUnique({
        where: {
          userId_moduleId: { userId, moduleId: question.moduleId },
        },
        select: { completedAt: true },
      });

      await tx.userLearningModuleProgress.upsert({
        where: {
          userId_moduleId: { userId, moduleId: question.moduleId },
        },
        create: {
          userId,
          moduleId: question.moduleId,
          completedAt: lessonCompleted ? answeredAt : null,
        },
        update: lessonCompleted
          ? { completedAt: priorModule?.completedAt ?? answeredAt }
          : {},
      });

      if (
        correct &&
        lessonCompleted &&
        !priorModule?.completedAt &&
        question.module.completionXp > 0
      ) {
        const grant = await this.experience.grant(tx, {
          userId,
          sourceType: ExperienceXpSourceType.LEARNING_MODULE,
          sourceRef: `lesson:${question.module.key}`,
          points: question.module.completionXp,
          metadata: { contentVersion: question.module.contentVersion },
        });
        moduleXpGranted = grant.pointsGranted;
      }

      const introductoryKeys = ['M1', 'M2', 'M3', 'M4', 'M5'];
      const completedLessons = await tx.userLearningModuleProgress.count({
        where: {
          userId,
          completedAt: { not: null },
          module: { key: { in: introductoryKeys } },
        },
      });
      const moduleCompleted = completedLessons === introductoryKeys.length;
      let introXpGranted = 0;
      const introXp = this.config.get<number>('LEARNING_INTRO_XP', 45);
      if (correct && moduleCompleted && introXp > 0) {
        const grant = await this.experience.grant(tx, {
          userId,
          sourceType: ExperienceXpSourceType.LEARNING_MODULE,
          sourceRef: 'module:INTRO',
          points: introXp,
        });
        introXpGranted = grant.pointsGranted;
      }
      const profile = await this.experienceProfile(tx, userId);
      const after = calculateExperienceLevel(profile.totalXp);
      const unlocks = correct
        ? await this.vaultEligibility.refreshUnlocksForUser(userId, tx)
        : [];
      const xpAwarded = questionXpGranted + moduleXpGranted + introXpGranted;
      return {
        correct,
        feedback: correct ? question.successFeedback : question.retryFeedback,
        firstCorrect,
        xpGranted: xpAwarded,
        questionXpGranted,
        moduleXpGranted,
        introXpGranted,
        lessonCompleted,
        moduleCompleted,
        xpAwarded,
        totalXp: after.totalXp,
        levelBefore: before.level,
        levelAfter: after.level,
        tierAfter: after.tier,
        newUnlocks: unlocks.filter((unlock) => unlock.newlyUnlocked),
        progress: { correctRequired: correctCount, required: requiredCount },
        profile,
      };
    });
  }

  private async experienceProfile(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    const account = await tx.experienceAccount.findUnique({
      where: { userId },
      select: { totalXp: true, currentLevel: true },
    });
    return account ?? { totalXp: 0, currentLevel: 0 };
  }
}
