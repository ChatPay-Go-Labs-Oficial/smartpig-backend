-- CreateEnum
CREATE TYPE "ExperienceMode" AS ENUM ('LITE', 'PRO');

-- CreateEnum
CREATE TYPE "LearningContentType" AS ENUM ('INTRODUCTION', 'EXPLANATION', 'EXAMPLE', 'REFLECTION', 'PRACTICE', 'GLOSSARY');

-- CreateEnum
CREATE TYPE "ExperienceXpSourceType" AS ENUM ('LEARNING_QUESTION', 'LEARNING_MODULE', 'STREAK', 'SAVINGS_GOAL', 'DAILY_ACTIVITY', 'LEGACY_MIGRATION', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ExperienceRewardType" AS ENUM ('PROFILE_FRAME', 'TITLE', 'BADGE', 'COSMETIC');

-- AlterTable
-- Null deliberately means a legacy user who has not selected a mode yet.
ALTER TABLE "users"
ADD COLUMN "experienceMode" "ExperienceMode",
ADD COLUMN "experienceModeUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "learning_modules" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "completionXp" INTEGER NOT NULL DEFAULT 40,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_modules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "learning_modules_contentVersion_check" CHECK ("contentVersion" > 0),
    CONSTRAINT "learning_modules_completionXp_check" CHECK ("completionXp" >= 0)
);

-- CreateTable
CREATE TABLE "learning_content_items" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "moduleId" TEXT,
    "type" "LearningContentType" NOT NULL,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT,
    "content" JSONB NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_content_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "learning_content_items_contentVersion_check" CHECK ("contentVersion" > 0)
);

-- CreateTable
CREATE TABLE "learning_questions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "prompt" TEXT NOT NULL,
    "correctOptionKey" TEXT NOT NULL,
    "successFeedback" TEXT NOT NULL,
    "retryFeedback" TEXT NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 10,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "learning_questions_contentVersion_check" CHECK ("contentVersion" > 0),
    CONSTRAINT "learning_questions_xpReward_check" CHECK ("xpReward" >= 0)
);

-- CreateTable
CREATE TABLE "learning_question_options" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "learning_question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_learning_question_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstCorrectAt" TIMESTAMP(3),
    "lastAnsweredAt" TIMESTAMP(3),
    "lastSelectedOptionKey" TEXT,
    "lastContentVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_learning_question_progress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_learning_question_progress_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "user_learning_question_progress_lastContentVersion_check" CHECK ("lastContentVersion" IS NULL OR "lastContentVersion" > 0)
);

-- CreateTable
CREATE TABLE "user_learning_module_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "lastContentItemKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_learning_module_progress_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "vault_eligibility_policies" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "minimumLevel" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_eligibility_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vault_eligibility_policies_version_check" CHECK ("version" > 0),
    CONSTRAINT "vault_eligibility_policies_minimumLevel_check" CHECK ("minimumLevel" BETWEEN 0 AND 50)
);

-- CreateTable
CREATE TABLE "vault_eligibility_required_modules" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,

    CONSTRAINT "vault_eligibility_required_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_vault_unlocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "levelAtUnlock" INTEGER NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_vault_unlocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_vault_unlocks_policyVersion_check" CHECK ("policyVersion" > 0),
    CONSTRAINT "user_vault_unlocks_levelAtUnlock_check" CHECK ("levelAtUnlock" BETWEEN 0 AND 50)
);

-- CreateIndex
CREATE UNIQUE INDEX "learning_modules_key_key" ON "learning_modules"("key");
CREATE UNIQUE INDEX "learning_modules_displayOrder_key" ON "learning_modules"("displayOrder");
CREATE INDEX "learning_modules_isPublished_displayOrder_idx" ON "learning_modules"("isPublished", "displayOrder");

CREATE UNIQUE INDEX "learning_content_items_key_key" ON "learning_content_items"("key");
CREATE INDEX "learning_content_items_moduleId_isActive_displayOrder_idx" ON "learning_content_items"("moduleId", "isActive", "displayOrder");

CREATE UNIQUE INDEX "learning_questions_key_key" ON "learning_questions"("key");
CREATE UNIQUE INDEX "learning_questions_moduleId_displayOrder_key" ON "learning_questions"("moduleId", "displayOrder");
CREATE INDEX "learning_questions_moduleId_isActive_displayOrder_idx" ON "learning_questions"("moduleId", "isActive", "displayOrder");

CREATE UNIQUE INDEX "learning_question_options_questionId_key_key" ON "learning_question_options"("questionId", "key");
CREATE UNIQUE INDEX "learning_question_options_questionId_displayOrder_key" ON "learning_question_options"("questionId", "displayOrder");

CREATE UNIQUE INDEX "user_learning_question_progress_userId_questionId_key" ON "user_learning_question_progress"("userId", "questionId");
CREATE INDEX "user_learning_question_progress_userId_firstCorrectAt_idx" ON "user_learning_question_progress"("userId", "firstCorrectAt");

CREATE UNIQUE INDEX "user_learning_module_progress_userId_moduleId_key" ON "user_learning_module_progress"("userId", "moduleId");
CREATE INDEX "user_learning_module_progress_userId_completedAt_idx" ON "user_learning_module_progress"("userId", "completedAt");

CREATE UNIQUE INDEX "experience_accounts_userId_key" ON "experience_accounts"("userId");
CREATE INDEX "experience_accounts_currentLevel_idx" ON "experience_accounts"("currentLevel");

CREATE UNIQUE INDEX "experience_xp_ledger_dedupeKey_key" ON "experience_xp_ledger"("dedupeKey");
CREATE UNIQUE INDEX "experience_xp_ledger_userId_sourceType_sourceRef_key" ON "experience_xp_ledger"("userId", "sourceType", "sourceRef");
CREATE INDEX "experience_xp_ledger_userId_createdAt_idx" ON "experience_xp_ledger"("userId", "createdAt");

CREATE UNIQUE INDEX "experience_reward_definitions_key_key" ON "experience_reward_definitions"("key");
CREATE INDEX "experience_reward_definitions_isActive_minimumLevel_idx" ON "experience_reward_definitions"("isActive", "minimumLevel");

CREATE UNIQUE INDEX "user_experience_reward_unlocks_userId_rewardId_key" ON "user_experience_reward_unlocks"("userId", "rewardId");
CREATE INDEX "user_experience_reward_unlocks_userId_unlockedAt_idx" ON "user_experience_reward_unlocks"("userId", "unlockedAt");

CREATE UNIQUE INDEX "vault_eligibility_policies_vaultId_version_key" ON "vault_eligibility_policies"("vaultId", "version");
CREATE INDEX "vault_eligibility_policies_vaultId_isActive_publishedAt_idx" ON "vault_eligibility_policies"("vaultId", "isActive", "publishedAt");

-- Publishing is serialized in the service; this index is the final database
-- invariant if two operators still race from different application instances.
CREATE UNIQUE INDEX "vault_eligibility_policies_one_active_per_vault"
ON "vault_eligibility_policies"("vaultId") WHERE "isActive" = true;

CREATE UNIQUE INDEX "vault_eligibility_required_modules_policyId_moduleId_key" ON "vault_eligibility_required_modules"("policyId", "moduleId");
CREATE INDEX "vault_eligibility_required_modules_moduleId_idx" ON "vault_eligibility_required_modules"("moduleId");

CREATE UNIQUE INDEX "user_vault_unlocks_userId_vaultId_key" ON "user_vault_unlocks"("userId", "vaultId");
CREATE INDEX "user_vault_unlocks_vaultId_idx" ON "user_vault_unlocks"("vaultId");
CREATE INDEX "user_vault_unlocks_policyId_idx" ON "user_vault_unlocks"("policyId");

-- AddForeignKey
ALTER TABLE "learning_content_items" ADD CONSTRAINT "learning_content_items_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "learning_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_questions" ADD CONSTRAINT "learning_questions_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "learning_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_question_options" ADD CONSTRAINT "learning_question_options_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "learning_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_learning_question_progress" ADD CONSTRAINT "user_learning_question_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_learning_question_progress" ADD CONSTRAINT "user_learning_question_progress_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "learning_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_learning_module_progress" ADD CONSTRAINT "user_learning_module_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_learning_module_progress" ADD CONSTRAINT "user_learning_module_progress_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "learning_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "experience_accounts" ADD CONSTRAINT "experience_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "experience_xp_ledger" ADD CONSTRAINT "experience_xp_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_experience_reward_unlocks" ADD CONSTRAINT "user_experience_reward_unlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_experience_reward_unlocks" ADD CONSTRAINT "user_experience_reward_unlocks_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "experience_reward_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vault_eligibility_policies" ADD CONSTRAINT "vault_eligibility_policies_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vault_eligibility_required_modules" ADD CONSTRAINT "vault_eligibility_required_modules_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "vault_eligibility_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vault_eligibility_required_modules" ADD CONSTRAINT "vault_eligibility_required_modules_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "learning_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_vault_unlocks" ADD CONSTRAINT "user_vault_unlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_vault_unlocks" ADD CONSTRAINT "user_vault_unlocks_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_vault_unlocks" ADD CONSTRAINT "user_vault_unlocks_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "vault_eligibility_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
