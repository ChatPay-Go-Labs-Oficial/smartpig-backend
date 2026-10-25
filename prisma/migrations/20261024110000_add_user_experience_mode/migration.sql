-- CreateEnum
CREATE TYPE "ExperienceMode" AS ENUM ('LITE', 'PRO');

-- AlterTable
-- Null deliberately means a legacy user who has not selected a mode yet.
ALTER TABLE "users"
ADD COLUMN "experienceMode" "ExperienceMode",
ADD COLUMN "experienceModeUpdatedAt" TIMESTAMP(3);
