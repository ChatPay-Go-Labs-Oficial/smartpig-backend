import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ExperienceXpSourceType, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ExperienceLedgerService } from '../experience/experience-ledger.service';
import { calculateExperienceLevel } from '../experience/experience-level';
import { PrismaService } from '../infra/prisma/prisma.service';
import { VaultEligibilityService } from '../vault-eligibility/vault-eligibility.service';

const questionPublicSelect = {
  key: true,
  contentVersion: true,
  title: true,
  situation: true,
  prompt: true,
  reviewContentItemKey: true,
  isRequired: true,
  displayOrder: true,
  options: {
    orderBy: { displayOrder: 'asc' as const },
    select: { key: true, text: true, displayOrder: true },
  },
};

const PRO_VOCABULARY = {
  dollarDigital: 'USDC',
  euroDigital: 'EURC',
  cryptocurrency: 'XLM',
  piggyBank: 'vault',
  network: 'Stellar',
  annualRate: 'APY',
  exchange: 'Swap',
  withdrawal: 'Resgate do vault',
  pixRamp: 'on-ramp e off-ramp via Pix',
};
const INTRO_LESSON_KEYS = ['M1', 'M2', 'M3', 'M4', 'M5'];

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly experience: ExperienceLedgerService,
    private readonly vaultEligibility: VaultEligibilityService,
    private readonly config: ConfigService,
  ) {}

  async listStandaloneContent(userId: string) {
    const [items, mode] = await Promise.all([
      this.prisma.learningContentItem.findMany({
        where: { moduleId: null, isActive: true },
        orderBy: { displayOrder: 'asc' },
        select: {
          key: true,
          type: true,
          contentVersion: true,
          title: true,
          content: true,
          displayOrder: true,
        },
      }),
      this.effectiveMode(userId),
    ]);
    return {
      presentationMode: mode,
      proVocabulary: mode === 'PRO' ? PRO_VOCABULARY : null,
      introModuleCompletionXp: this.config.get<number>(
        'LEARNING_INTRO_MODULE_COMPLETION_XP',
        45,
      ),
      items,
    };
  }

  async listModules(userId: string) {
    const modules = await this.prisma.learningModule.findMany({
      where: { isPublished: true },
      orderBy: { displayOrder: 'asc' },
      select: {
        key: true,
        title: true,
        proTitle: true,
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

    const [progress, mode] = await Promise.all([
      this.prisma.userLearningModuleProgress.findMany({
        where: { userId, module: { isPublished: true } },
        select: {
          completedAt: true,
          lastContentItemKey: true,
          module: { select: { key: true } },
        },
      }),
      this.effectiveMode(userId),
    ]);
    const byModule = new Map(progress.map((item) => [item.module.key, item]));

    return modules.map((module) => ({
      ...module,
      title: mode === 'PRO' && module.proTitle ? module.proTitle : module.title,
      liteTitle: module.title,
      presentationMode: mode,
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
        proTitle: true,
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

    const [questionProgress, moduleProgress, mode] = await Promise.all([
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
      this.effectiveMode(userId),
    ]);

    const progressByQuestion = new Map(
      questionProgress.map((item) => [item.question.key, item]),
    );

    const questions = module.questions.map((question) => ({
      ...question,
      progress: progressByQuestion.get(question.key) ?? null,
    }));
    const steps = [
      ...module.contentItems.map((item) => ({
        type: item.type === 'REFLECTION' ? 'reflection' : 'screen',
        key: item.key,
        displayOrder: item.displayOrder,
        content: item,
      })),
      ...questions.map((question) => ({
        type: 'question',
        key: question.key,
        displayOrder: question.displayOrder,
        reviewScreenKey: question.reviewContentItemKey,
        content: question,
      })),
    ].sort((left, right) => left.displayOrder - right.displayOrder);

    return {
      ...module,
      id: undefined,
      isPublished: undefined,
      title: mode === 'PRO' && module.proTitle ? module.proTitle : module.title,
      liteTitle: module.title,
      presentationMode: mode,
      proVocabulary: mode === 'PRO' ? PRO_VOCABULARY : null,
      questions,
      steps,
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
            stepKey: resume.lastContentItemKey,
            // Compatibility with the first mobile contract.
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
        questions: {
          where: { key: contentItemKey, isActive: true },
          select: { key: true },
        },
      },
    });
    if (
      !module?.isPublished ||
      (module.contentItems.length === 0 && module.questions.length === 0)
    ) {
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
    const result = await this.prisma.$transaction(async (tx) => {
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

      // One user-wide lock also covers the case where two devices complete two
      // different lessons together. The second transaction then observes the
      // first and can award the five-lesson module exactly once.
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`learning:${userId}`}))`,
      );

      const profileBefore = await this.experienceProfile(tx, userId);

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
      const lessonComplete = requiredCount > 0 && correctCount >= requiredCount;
      let lessonXpGranted = 0;

      const priorModule = await tx.userLearningModuleProgress.findUnique({
        where: {
          userId_moduleId: { userId, moduleId: question.moduleId },
        },
        select: { completedAt: true },
      });
      const lessonCompletedNow = lessonComplete && !priorModule?.completedAt;

      await tx.userLearningModuleProgress.upsert({
        where: {
          userId_moduleId: { userId, moduleId: question.moduleId },
        },
        create: {
          userId,
          moduleId: question.moduleId,
          completedAt: lessonComplete ? answeredAt : null,
        },
        update: lessonComplete
          ? { completedAt: priorModule?.completedAt ?? answeredAt }
          : {},
      });

      if (lessonComplete && question.module.completionXp > 0) {
        const grant = await this.experience.grant(tx, {
          userId,
          sourceType: ExperienceXpSourceType.LEARNING_MODULE,
          sourceRef: `lesson:${question.module.key}`,
          points: question.module.completionXp,
          metadata: { contentVersion: question.module.contentVersion },
        });
        lessonXpGranted = grant.pointsGranted;
      }

      const [publishedLessonCount, completedLessonCount] = await Promise.all([
        tx.learningModule.count({
          where: { key: { in: INTRO_LESSON_KEYS }, isPublished: true },
        }),
        tx.userLearningModuleProgress.count({
          where: {
            userId,
            completedAt: { not: null },
            module: {
              key: { in: INTRO_LESSON_KEYS },
              isPublished: true,
            },
          },
        }),
      ]);
      const introModuleComplete =
        publishedLessonCount === INTRO_LESSON_KEYS.length &&
        completedLessonCount >= INTRO_LESSON_KEYS.length;
      let introModuleXpGranted = 0;
      const introModuleXp = this.config.get<number>(
        'LEARNING_INTRO_MODULE_COMPLETION_XP',
        45,
      );
      if (lessonCompletedNow && introModuleComplete && introModuleXp > 0) {
        const grant = await this.experience.grant(tx, {
          userId,
          sourceType: ExperienceXpSourceType.LEARNING_MODULE,
          sourceRef: 'module:INTRO',
          points: introModuleXp,
          metadata: { catalog: 'INTRODUCTION' },
        });
        introModuleXpGranted = grant.pointsGranted;
      }

      const profileAfter = await this.experienceProfile(tx, userId);
      const xpAwarded = lessonXpGranted + introModuleXpGranted;

      return {
        correct,
        feedback: correct ? question.successFeedback : question.retryFeedback,
        firstCorrect,
        lessonCompleted: lessonCompletedNow,
        moduleCompleted: introModuleXpGranted > 0,
        xpAwarded,
        lessonXpAwarded: lessonXpGranted,
        introModuleXpAwarded: introModuleXpGranted,
        totalXp: profileAfter.totalXp,
        levelBefore: profileBefore.level,
        levelAfter: profileAfter.level,
        tierAfter: profileAfter.tier,
        // Compatibility aliases for the first mobile integration.
        xpGranted: xpAwarded,
        questionXpGranted: 0,
        moduleXpGranted: lessonXpGranted,
        progress: { correctRequired: correctCount, required: requiredCount },
        profile: profileAfter,
      };
    });

    let newUnlocks: string[] = [];
    if (result.correct) {
      // The deposit boundary always re-evaluates eligibility. A projection
      // refresh must therefore never turn an already committed answer/XP grant
      // into a misleading 500 response.
      try {
        const refresh =
          await this.vaultEligibility.refreshUnlocksForUser(userId);
        newUnlocks = refresh
          .filter((item) => item.newlyUnlocked)
          .map((item) => item.assetSymbol)
          .filter((symbol): symbol is string => Boolean(symbol));
      } catch (error) {
        this.logger.error(
          `Could not refresh vault unlocks for ${userId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return { ...result, newUnlocks };
  }

  private async experienceProfile(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    const account = await tx.experienceAccount.findUnique({
      where: { userId },
      select: { totalXp: true, currentLevel: true },
    });
    return calculateExperienceLevel(account?.totalXp ?? 0);
  }

  private async effectiveMode(userId: string): Promise<'LITE' | 'PRO'> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { experienceMode: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return user.experienceMode ?? 'PRO';
  }
}
