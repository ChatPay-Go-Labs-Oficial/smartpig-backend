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
    { assetSymbol: 'EURC', minimumLevel: 5, moduleKeys: ['M1', 'M2', 'M3'] },
    {
      assetSymbol: 'XLM',
      minimumLevel: 10,
      moduleKeys: ['M1', 'M2', 'M3', 'M4', 'M5'],
    },
  ];

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
      const policyCount = await prisma.vaultEligibilityPolicy.count({
        where: { vaultId: vault.id },
      });
      if (policyCount > 0) continue;

      const policy = await prisma.vaultEligibilityPolicy.create({
        data: {
          vaultId: vault.id,
          version: 1,
          minimumLevel: definition.minimumLevel,
          isActive: true,
          publishedAt: new Date('2026-10-21T00:00:00.000Z'),
        },
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
