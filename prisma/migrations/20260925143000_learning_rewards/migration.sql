CREATE TABLE "learning_rewards" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "lessonId" INTEGER NOT NULL,
  "contentVersion" INTEGER NOT NULL,
  "points" INTEGER NOT NULL CHECK ("points" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "learning_rewards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learning_rewards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "learning_rewards_userId_questionId_key" ON "learning_rewards"("userId", "questionId");
