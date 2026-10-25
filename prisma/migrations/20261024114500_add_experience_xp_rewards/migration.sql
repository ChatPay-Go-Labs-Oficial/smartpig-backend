-- CreateEnum
CREATE TYPE "ExperienceXpSourceType" AS ENUM ('LEARNING_QUESTION', 'LEARNING_MODULE', 'STREAK', 'SAVINGS_GOAL', 'DAILY_ACTIVITY', 'LEGACY_MIGRATION', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ExperienceRewardType" AS ENUM ('PROFILE_FRAME', 'TITLE', 'BADGE', 'COSMETIC');

-- CreateTable
CREATE TABLE "experience_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalXp" INTEGER NOT NULL DEFAULT 0,
    "currentLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experience_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "experience_accounts_totalXp_check" CHECK ("totalXp" >= 0),
    CONSTRAINT "experience_accounts_currentLevel_check" CHECK ("currentLevel" BETWEEN 0 AND 50)
);

-- CreateTable
CREATE TABLE "experience_xp_ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "ExperienceXpSourceType" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experience_xp_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "experience_xp_ledger_points_check" CHECK ("points" <> 0)
);

-- CreateTable
CREATE TABLE "experience_reward_definitions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "ExperienceRewardType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minimumLevel" INTEGER,
    "tier" TEXT,
    "payload" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experience_reward_definitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "experience_reward_definitions_minimumLevel_check" CHECK ("minimumLevel" IS NULL OR "minimumLevel" BETWEEN 0 AND 50)
);

-- CreateTable
CREATE TABLE "user_experience_reward_unlocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "sourceLevel" INTEGER,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_experience_reward_unlocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_experience_reward_unlocks_sourceLevel_check" CHECK ("sourceLevel" IS NULL OR "sourceLevel" BETWEEN 0 AND 50)
);

CREATE UNIQUE INDEX "experience_accounts_userId_key" ON "experience_accounts"("userId");
CREATE INDEX "experience_accounts_currentLevel_idx" ON "experience_accounts"("currentLevel");
CREATE UNIQUE INDEX "experience_xp_ledger_dedupeKey_key" ON "experience_xp_ledger"("dedupeKey");
CREATE UNIQUE INDEX "experience_xp_ledger_userId_sourceType_sourceRef_key" ON "experience_xp_ledger"("userId", "sourceType", "sourceRef");
CREATE INDEX "experience_xp_ledger_userId_createdAt_idx" ON "experience_xp_ledger"("userId", "createdAt");
CREATE UNIQUE INDEX "experience_reward_definitions_key_key" ON "experience_reward_definitions"("key");
CREATE INDEX "experience_reward_definitions_isActive_minimumLevel_idx" ON "experience_reward_definitions"("isActive", "minimumLevel");
CREATE UNIQUE INDEX "user_experience_reward_unlocks_userId_rewardId_key" ON "user_experience_reward_unlocks"("userId", "rewardId");
CREATE INDEX "user_experience_reward_unlocks_userId_unlockedAt_idx" ON "user_experience_reward_unlocks"("userId", "unlockedAt");
ALTER TABLE "experience_accounts" ADD CONSTRAINT "experience_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "experience_xp_ledger" ADD CONSTRAINT "experience_xp_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_experience_reward_unlocks" ADD CONSTRAINT "user_experience_reward_unlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_experience_reward_unlocks" ADD CONSTRAINT "user_experience_reward_unlocks_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "experience_reward_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
