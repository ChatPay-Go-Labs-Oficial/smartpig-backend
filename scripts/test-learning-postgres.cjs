// Run after npm run build and migrations against a disposable local database.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { LearningService } = require('../dist/learning/learning.service');
const { LEARNING_LESSONS } = require('../dist/learning/learning.catalog');
const url = process.env.LEARNING_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/pigfi_learning_test') {
  throw new Error('Set LEARNING_TEST_DATABASE_URL to a disposable local /pigfi_learning_test database');
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  const user = await prisma.user.create({ data: {} });
  try {
    const learning = new LearningService(prisma, new ConfigService(), {});
    const results = await Promise.all(Array.from({ length: 20 }, () => learning.answer(user.id, 1, 'lesson-1-q-1', 'a', 1)));
    assert.equal(results.reduce((sum, r) => sum + r.awardedPoints, 0), 10);
    assert.equal(await prisma.learningReward.count({ where: { userId: user.id } }), 1);
    for (const lesson of LEARNING_LESSONS) {
      for (const question of lesson.questions) await learning.answer(user.id, lesson.id, question.id, question.correctOptionId, lesson.version);
    }
    // New service instance reads the persisted score, with no in-memory store.
    const restarted = new LearningService(prisma, new ConfigService(), {});
    const progress = await restarted.progress(user.id);
    assert.equal(progress.points, 150);
    assert.equal(progress.vaultAccess.XLM.unlocked, true);
    assert.equal(progress.vaultAccess.EURC.unlocked, true);
    assert.equal(await prisma.learningReward.count({ where: { userId: user.id } }), 15);
    console.log('PASS PostgreSQL: 20 concurrent answers award once; 150 points persist across service instances; EURC and XLM unlock.');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exitCode = 1; });
