/* eslint-disable no-console */
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const {
  ExperienceLedgerService,
} = require('../dist/experience/experience-ledger.service');
const { LearningService } = require('../dist/learning/learning.service');
const {
  VaultEligibilityService,
} = require('../dist/vault-eligibility/vault-eligibility.service');

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.create({
    data: {
      email: `experience-concurrency-${Date.now()}@example.invalid`,
      experienceMode: 'LITE',
      experienceModeUpdatedAt: new Date(),
    },
  });

  try {
    const questions = await prisma.learningQuestion.findMany({
      where: { module: { key: 'M1' }, isRequired: true, isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: {
        key: true,
        correctOptionKey: true,
        contentVersion: true,
      },
    });
    assert.equal(questions.length, 6, 'M1 must contain six required questions');

    const ledger = new ExperienceLedgerService(prisma);
    const eligibility = { refreshUnlocksForUser: async () => [] };
    const config = { get: (_key, fallback) => fallback };
    const learning = new LearningService(prisma, ledger, eligibility, config);

    for (const question of questions.slice(0, 4)) {
      await learning.submitAnswer(
        user.id,
        question.key,
        question.correctOptionKey,
        question.contentVersion,
      );
    }

    await Promise.all(
      questions
        .slice(4)
        .map((question) =>
          learning.submitAnswer(
            user.id,
            question.key,
            question.correctOptionKey,
            question.contentVersion,
          ),
        ),
    );

    await learning.submitAnswer(
      user.id,
      questions[0].key,
      questions[0].correctOptionKey,
      questions[0].contentVersion,
    );
    const publicModule = await learning.getModule(user.id, 'M1');
    assert.equal(
      JSON.stringify(publicModule).includes('correctOptionKey'),
      false,
      'public learning payload must not expose answer keys',
    );

    const [account, ledgerEntries, moduleProgress] = await Promise.all([
      prisma.experienceAccount.findUnique({ where: { userId: user.id } }),
      prisma.experienceXpLedgerEntry.findMany({
        where: { userId: user.id },
      }),
      prisma.userLearningModuleProgress.findFirst({
        where: { userId: user.id, module: { key: 'M1' } },
      }),
    ]);

    assert.equal(account.totalXp, 15, 'one lesson completion credit');
    assert.equal(ledgerEntries.length, 1, 'questions do not receive XP');
    assert.ok(moduleProgress.completedAt, 'M1 must be completed');

    const xlmVault = await prisma.vaultCatalog.findFirstOrThrow({
      where: { assetSymbol: 'XLM' },
      select: { id: true },
    });
    const latestPolicy = await prisma.vaultEligibilityPolicy.findFirst({
      where: { vaultId: xlmVault.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const policyVersion = (latestPolicy?.version ?? 0) + 1;
    const policyService = new VaultEligibilityService(prisma, {
      get: () => true,
    });
    await policyService.upsertPolicy(xlmVault.id, {
      version: policyVersion,
      minimumLevel: 0,
      requiredModuleKeys: ['M1'],
      publish: true,
    });
    const unlock = await prisma.userVaultUnlock.findUnique({
      where: { userId_vaultId: { userId: user.id, vaultId: xlmVault.id } },
    });
    assert.equal(
      unlock?.policyVersion,
      policyVersion,
      'publishing must backfill users who already qualify',
    );
    await assert.rejects(
      () =>
        policyService.upsertPolicy(xlmVault.id, {
          version: policyVersion,
          minimumLevel: 1,
          requiredModuleKeys: ['M1'],
          publish: true,
        }),
      (error) =>
        error?.response?.code === 'PUBLISHED_ELIGIBILITY_POLICY_IMMUTABLE',
    );
    await Promise.all([
      policyService.upsertPolicy(xlmVault.id, {
        version: policyVersion + 1,
        minimumLevel: 0,
        requiredModuleKeys: ['M1'],
        publish: true,
      }),
      policyService.upsertPolicy(xlmVault.id, {
        version: policyVersion + 2,
        minimumLevel: 0,
        requiredModuleKeys: ['M1'],
        publish: true,
      }),
    ]);
    assert.equal(
      await prisma.vaultEligibilityPolicy.count({
        where: { vaultId: xlmVault.id, isActive: true },
      }),
      1,
      'concurrent publications must leave exactly one active policy',
    );

    console.log(
      'PostgreSQL checks passed: concurrent XP, policy backfill and immutable publication.',
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
