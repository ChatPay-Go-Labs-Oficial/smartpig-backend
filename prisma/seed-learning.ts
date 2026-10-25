import { LearningContentType, Prisma } from '@prisma/client';
import {
  LEARNING_CATALOG_VERSION,
  learningCatalog,
  standaloneContent,
} from './learning-catalog';

export async function seedLearning(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  validateCatalog();

  for (const editorialModule of learningCatalog) {
    const module = await prisma.learningModule.upsert({
      where: { key: editorialModule.key },
      update: {
        title: editorialModule.title,
        description: editorialModule.description,
        displayOrder: editorialModule.order,
        contentVersion: LEARNING_CATALOG_VERSION,
        completionXp: 40,
        isPublished: true,
        publishedAt: new Date('2026-10-21T00:00:00.000Z'),
      },
      create: {
        key: editorialModule.key,
        title: editorialModule.title,
        description: editorialModule.description,
        displayOrder: editorialModule.order,
        contentVersion: LEARNING_CATALOG_VERSION,
        completionXp: 40,
        isPublished: true,
        publishedAt: new Date('2026-10-21T00:00:00.000Z'),
      },
    });

    for (const item of editorialModule.content) {
      await prisma.learningContentItem.upsert({
        where: { key: item.key },
        update: {
          moduleId: module.id,
          type: item.type,
          title: item.title,
          content: item.content as Prisma.InputJsonValue,
          displayOrder: item.order,
          isRequired: item.required ?? false,
          isActive: true,
          contentVersion: LEARNING_CATALOG_VERSION,
        },
        create: {
          key: item.key,
          moduleId: module.id,
          type: item.type,
          title: item.title,
          content: item.content as Prisma.InputJsonValue,
          displayOrder: item.order,
          isRequired: item.required ?? false,
          isActive: true,
          contentVersion: LEARNING_CATALOG_VERSION,
        },
      });
    }

    for (const editorialQuestion of editorialModule.questions) {
      const question = await prisma.learningQuestion.upsert({
        where: { key: editorialQuestion.key },
        update: {
          moduleId: module.id,
          prompt: editorialQuestion.prompt,
          correctOptionKey: editorialQuestion.correct,
          successFeedback: editorialQuestion.success,
          retryFeedback: editorialQuestion.retry,
          displayOrder: editorialQuestion.order,
          xpReward: 10,
          isRequired: true,
          isActive: true,
          contentVersion: LEARNING_CATALOG_VERSION,
        },
        create: {
          key: editorialQuestion.key,
          moduleId: module.id,
          prompt: editorialQuestion.prompt,
          correctOptionKey: editorialQuestion.correct,
          successFeedback: editorialQuestion.success,
          retryFeedback: editorialQuestion.retry,
          displayOrder: editorialQuestion.order,
          xpReward: 10,
          isRequired: true,
          isActive: true,
          contentVersion: LEARNING_CATALOG_VERSION,
        },
      });

      for (const [index, option] of editorialQuestion.options.entries()) {
        await prisma.learningQuestionOption.upsert({
          where: {
            questionId_key: { questionId: question.id, key: option.key },
          },
          update: { text: option.text, displayOrder: index + 1 },
          create: {
            questionId: question.id,
            key: option.key,
            text: option.text,
            displayOrder: index + 1,
          },
        });
      }

      await prisma.learningQuestionOption.deleteMany({
        where: {
          questionId: question.id,
          key: { notIn: editorialQuestion.options.map((option) => option.key) },
        },
      });
    }

    await prisma.learningContentItem.updateMany({
      where: {
        moduleId: module.id,
        key: { notIn: editorialModule.content.map((item) => item.key) },
      },
      data: { isActive: false },
    });
    await prisma.learningQuestion.updateMany({
      where: {
        moduleId: module.id,
        key: {
          notIn: editorialModule.questions.map((question) => question.key),
        },
      },
      data: { isActive: false },
    });
  }

  await prisma.learningModule.updateMany({
    where: { key: { notIn: learningCatalog.map((module) => module.key) } },
    data: { isPublished: false },
  });

  for (const item of standaloneContent) {
    await prisma.learningContentItem.upsert({
      where: { key: item.key },
      update: {
        moduleId: null,
        type: item.type,
        title: item.title,
        content: item.content as Prisma.InputJsonValue,
        displayOrder: item.order,
        isRequired: false,
        isActive: true,
        contentVersion: LEARNING_CATALOG_VERSION,
      },
      create: {
        key: item.key,
        type: item.type,
        title: item.title,
        content: item.content as Prisma.InputJsonValue,
        displayOrder: item.order,
        isRequired: false,
        isActive: true,
        contentVersion: LEARNING_CATALOG_VERSION,
      },
    });
  }

  await prisma.learningContentItem.updateMany({
    where: {
      moduleId: null,
      key: { notIn: standaloneContent.map((item) => item.key) },
    },
    data: { isActive: false },
  });
}

function validateCatalog(): void {
  const allKeys = new Set<string>();
  for (const module of learningCatalog) {
    if (module.questions.length !== 6) {
      throw new Error(`${module.key} must contain exactly six questions`);
    }
    for (const item of module.content) {
      if (allKeys.has(item.key)) throw new Error(`Duplicate key ${item.key}`);
      allKeys.add(item.key);
    }
    for (const question of module.questions) {
      if (allKeys.has(question.key)) {
        throw new Error(`Duplicate key ${question.key}`);
      }
      allKeys.add(question.key);
      const optionKeys = question.options.map((option) => option.key);
      if (new Set(optionKeys).size !== optionKeys.length) {
        throw new Error(`Duplicate option key in ${question.key}`);
      }
      if (!optionKeys.includes(question.correct)) {
        throw new Error(`Correct option is missing in ${question.key}`);
      }
    }
  }
  for (const item of standaloneContent) {
    if (allKeys.has(item.key)) throw new Error(`Duplicate key ${item.key}`);
    allKeys.add(item.key);
  }
}

export { LearningContentType };
