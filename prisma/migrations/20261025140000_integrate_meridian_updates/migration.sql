-- Incremental extension of the already incorporated mobile schema.
ALTER TABLE "users" ADD COLUMN "usernameSetAt" TIMESTAMP(3);
ALTER TABLE "learning_modules" ADD COLUMN "proTitle" TEXT;
ALTER TABLE "learning_questions" ADD COLUMN "title" TEXT, ADD COLUMN "situation" JSONB;
-- reviewScreenKey, username constraints and Meridian policies already exist.
-- Preserve ledger history: completed lessons remain protected in the service.
