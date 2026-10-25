-- CreateEnum
CREATE TYPE "LearningContentType" AS ENUM ('INTRODUCTION', 'EXPLANATION', 'EXAMPLE', 'REFLECTION', 'PRACTICE', 'GLOSSARY');

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
ALTER TABLE "learning_content_items" ADD CONSTRAINT "learning_content_items_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "learning_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_questions" ADD CONSTRAINT "learning_questions_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "learning_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_question_options" ADD CONSTRAINT "learning_question_options_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "learning_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_learning_question_progress" ADD CONSTRAINT "user_learning_question_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_learning_question_progress" ADD CONSTRAINT "user_learning_question_progress_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "learning_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_learning_module_progress" ADD CONSTRAINT "user_learning_module_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_learning_module_progress" ADD CONSTRAINT "user_learning_module_progress_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "learning_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
