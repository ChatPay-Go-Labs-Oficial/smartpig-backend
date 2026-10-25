import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';

const questionPublicSelect = {
  key: true,
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
  constructor(private readonly prisma: PrismaService) {}

  async listStandaloneContent() {
    return this.prisma.learningContentItem.findMany({
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
      id: undefined,
      isPublished: undefined,
      questions: module.questions.map((question) => ({
        ...question,
        progress: progressByQuestion.get(question.key) ?? null,
      })),
      progress: moduleProgress,
    };
  }
}
