import {
  ExperienceRewardType,
  LearningContentType,
  Prisma,
} from '@prisma/client';
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
        proTitle:
          'proTitle' in editorialModule ? editorialModule.proTitle : null,
        description: editorialModule.description,
        displayOrder: editorialModule.order,
        contentVersion: LEARNING_CATALOG_VERSION,
        completionXp: 15,
        isPublished: true,
        publishedAt: new Date('2026-10-21T00:00:00.000Z'),
      },
      create: {
        key: editorialModule.key,
        title: editorialModule.title,
        proTitle:
          'proTitle' in editorialModule ? editorialModule.proTitle : null,
        description: editorialModule.description,
        displayOrder: editorialModule.order,
        contentVersion: LEARNING_CATALOG_VERSION,
        completionXp: 15,
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
      const currentQuestion = await prisma.learningQuestion.findUnique({
        where: { key: editorialQuestion.key },
        select: { id: true },
      });
      if (!currentQuestion) {
        await prisma.learningQuestion.updateMany({
          where: { key: editorialQuestion.legacyKey },
          data: { key: editorialQuestion.key },
        });
      }

      const question = await prisma.learningQuestion.upsert({
        where: { key: editorialQuestion.key },
        update: {
          moduleId: module.id,
          title: editorialQuestion.title,
          situation: {
            ...editorialQuestion.situation,
            valuesExample: editorialQuestion.valuesExample ?? false,
            ...(editorialQuestion.proSuccessAddition
              ? { proSuccessAddition: editorialQuestion.proSuccessAddition }
              : {}),
          } as Prisma.InputJsonValue,
          prompt: editorialQuestion.prompt,
          reviewContentItemKey: editorialQuestion.reviewScreenKey,
          correctOptionKey: editorialQuestion.correct,
          successFeedback: editorialQuestion.success,
          retryFeedback: editorialQuestion.retry,
          displayOrder: editorialQuestion.order,
          xpReward: 0,
          isRequired: true,
          isActive: true,
          contentVersion: LEARNING_CATALOG_VERSION,
        },
        create: {
          key: editorialQuestion.key,
          moduleId: module.id,
          title: editorialQuestion.title,
          situation: {
            ...editorialQuestion.situation,
            valuesExample: editorialQuestion.valuesExample ?? false,
            ...(editorialQuestion.proSuccessAddition
              ? { proSuccessAddition: editorialQuestion.proSuccessAddition }
              : {}),
          } as Prisma.InputJsonValue,
          prompt: editorialQuestion.prompt,
          reviewContentItemKey: editorialQuestion.reviewScreenKey,
          correctOptionKey: editorialQuestion.correct,
          successFeedback: editorialQuestion.success,
          retryFeedback: editorialQuestion.retry,
          displayOrder: editorialQuestion.order,
          xpReward: 0,
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
    await prisma.userLearningModuleProgress.updateMany({
      where: {
        moduleId: module.id,
        lastContentItemKey: {
          notIn: [
            ...editorialModule.content.map((item) => item.key),
            ...editorialModule.questions.map((question) => question.key),
          ],
        },
      },
      data: { lastContentItemKey: editorialModule.content[0]?.key ?? null },
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

  await seedDefaultEligibilityPolicies(prisma);

  // Every level advances the profile frame. Tier boundaries add the larger
  // identity rewards from the product document on top of that frame.
  for (let level = 1; level <= 50; level += 1) {
    const key = `LEVEL_${String(level).padStart(2, '0')}_FRAME`;
    await prisma.experienceRewardDefinition.upsert({
      where: { key },
      update: {
        type: ExperienceRewardType.PROFILE_FRAME,
        name: `Moldura nível ${level}`,
        minimumLevel: level,
        payload: { frameIndex: level },
        isActive: true,
      },
      create: {
        key,
        type: ExperienceRewardType.PROFILE_FRAME,
        name: `Moldura nível ${level}`,
        minimumLevel: level,
        payload: { frameIndex: level },
        isActive: true,
      },
    });
  }

  const tierRewards = [
    [
      10,
      'BEGINNER_BADGE_AND_FRAME',
      ExperienceRewardType.PROFILE_FRAME,
      'Porquinho Iniciante',
      'BEGINNER',
    ],
    [
      25,
      'CONSISTENT_NAME_BADGE',
      ExperienceRewardType.BADGE,
      'Emblema Consistente',
      'CONSISTENT',
    ],
    [
      40,
      'DEDICATED_PIG_VARIANTS',
      ExperienceRewardType.COSMETIC,
      'Variações do porquinho',
      'DEDICATED',
    ],
    [
      50,
      'VETERAN_EXCLUSIVE_SKIN',
      ExperienceRewardType.COSMETIC,
      'Skin Veterano',
      'VETERAN',
    ],
  ] as const;
  for (const [level, key, type, name, tier] of tierRewards) {
    await prisma.experienceRewardDefinition.upsert({
      where: { key },
      update: { type, name, minimumLevel: level, tier, isActive: true },
      create: { key, type, name, minimumLevel: level, tier, isActive: true },
    });
  }
}

async function seedDefaultEligibilityPolicies(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const defaults = [
    { assetSymbol: 'EURC', minimumLevel: 0, moduleKeys: ['M1', 'M2', 'M3'] },
    {
      assetSymbol: 'XLM',
      minimumLevel: 0,
      moduleKeys: ['M1', 'M2', 'M3', 'M4', 'M5'],
    },
  ];
  const meridianPolicyVersion = 2;

  for (const definition of defaults) {
    const [vaults, modules] = await Promise.all([
      prisma.vaultCatalog.findMany({
        where: { assetSymbol: definition.assetSymbol },
        select: { id: true },
      }),
      prisma.learningModule.findMany({
        where: { key: { in: definition.moduleKeys } },
        select: { id: true },
      }),
    ]);

    for (const vault of vaults) {
      const latestPolicy = await prisma.vaultEligibilityPolicy.findFirst({
        where: { vaultId: vault.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      // A later operator-owned version always wins. Re-running the seed must not
      // roll production policy back to the temporary Meridian rule.
      if (latestPolicy && latestPolicy.version > meridianPolicyVersion)
        continue;

      const existingMeridian = await prisma.vaultEligibilityPolicy.findUnique({
        where: {
          vaultId_version: {
            vaultId: vault.id,
            version: meridianPolicyVersion,
          },
        },
        select: { id: true, publishedAt: true },
      });
      if (existingMeridian?.publishedAt) continue;

      await prisma.vaultEligibilityPolicy.updateMany({
        where: { vaultId: vault.id, isActive: true },
        data: { isActive: false },
      });

      const policy = await prisma.vaultEligibilityPolicy.upsert({
        where: {
          vaultId_version: {
            vaultId: vault.id,
            version: meridianPolicyVersion,
          },
        },
        create: {
          vaultId: vault.id,
          version: meridianPolicyVersion,
          minimumLevel: definition.minimumLevel,
          isActive: true,
          publishedAt: new Date('2026-10-25T00:00:00.000Z'),
        },
        update: {
          minimumLevel: definition.minimumLevel,
          isActive: true,
          publishedAt: new Date('2026-10-25T00:00:00.000Z'),
        },
      });
      await prisma.vaultEligibilityRequiredModule.deleteMany({
        where: { policyId: policy.id },
      });
      await prisma.vaultEligibilityRequiredModule.createMany({
        data: modules.map((module) => ({
          policyId: policy.id,
          moduleId: module.id,
        })),
      });
      await materializeSeedPolicyUnlocks(prisma, {
        id: policy.id,
        vaultId: vault.id,
        version: policy.version,
        minimumLevel: policy.minimumLevel,
        requiredModuleIds: modules.map((module) => module.id),
      });
    }
  }
}

async function materializeSeedPolicyUnlocks(
  prisma: Prisma.TransactionClient,
  policy: {
    id: string;
    vaultId: string;
    version: number;
    minimumLevel: number;
    requiredModuleIds: string[];
  },
): Promise<void> {
  const candidates = await prisma.user.findMany({
    where: {
      experienceMode: 'LITE',
      experienceAccount: {
        is: { currentLevel: { gte: policy.minimumLevel } },
      },
      vaultUnlocks: { none: { vaultId: policy.vaultId } },
    },
    select: {
      id: true,
      experienceAccount: { select: { currentLevel: true } },
      learningModules: {
        where: {
          moduleId: { in: policy.requiredModuleIds },
          completedAt: { not: null },
        },
        select: { moduleId: true },
      },
    },
  });
  const required = new Set(policy.requiredModuleIds);
  const qualified = candidates.filter((candidate) => {
    const completed = new Set(
      candidate.learningModules.map((progress) => progress.moduleId),
    );
    return [...required].every((moduleId) => completed.has(moduleId));
  });

  if (qualified.length > 0) {
    await prisma.userVaultUnlock.createMany({
      data: qualified.map((candidate) => ({
        userId: candidate.id,
        vaultId: policy.vaultId,
        policyId: policy.id,
        policyVersion: policy.version,
        levelAtUnlock: candidate.experienceAccount?.currentLevel ?? 0,
      })),
      skipDuplicates: true,
    });
  }
}

function validateCatalog(): void {
  const allKeys = new Set<string>();
  let screenCount = 0;
  let questionCount = 0;
  let reflectionCount = 0;
  for (const module of learningCatalog) {
    if (module.questions.length !== 6) {
      throw new Error(`${module.key} must contain exactly six questions`);
    }
    for (const item of module.content) {
      if (allKeys.has(item.key)) throw new Error(`Duplicate key ${item.key}`);
      allKeys.add(item.key);
      if (item.type === LearningContentType.EXPLANATION) screenCount += 1;
      if (item.type === LearningContentType.REFLECTION) reflectionCount += 1;
    }
    for (const question of module.questions) {
      if (allKeys.has(question.key)) {
        throw new Error(`Duplicate key ${question.key}`);
      }
      allKeys.add(question.key);
      questionCount += 1;
      if (
        !module.content.some((item) => item.key === question.reviewScreenKey)
      ) {
        throw new Error(
          `${question.key} reviews missing screen ${question.reviewScreenKey}`,
        );
      }
      const optionKeys = question.options.map((option) => option.key);
      if (new Set(optionKeys).size !== optionKeys.length) {
        throw new Error(`Duplicate option key in ${question.key}`);
      }
      if (!optionKeys.includes(question.correct)) {
        throw new Error(`Correct option is missing in ${question.key}`);
      }
    }
  }
  if (screenCount !== 28 || questionCount !== 30 || reflectionCount !== 5) {
    throw new Error(
      `Intro catalog must contain 28 screens, 30 questions and 5 reflections; got ${screenCount}/${questionCount}/${reflectionCount}`,
    );
  }
  for (const item of standaloneContent) {
    if (allKeys.has(item.key)) throw new Error(`Duplicate key ${item.key}`);
    allKeys.add(item.key);
  }
}

export { LearningContentType };
