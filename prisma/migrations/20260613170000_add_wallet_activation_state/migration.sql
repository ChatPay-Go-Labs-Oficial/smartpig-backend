CREATE TYPE "WalletActivationStatus" AS ENUM (
  'NOT_STARTED',
  'PENDING_SIGNATURE',
  'SUBMITTING',
  'ACTIVATED',
  'FAILED'
);

ALTER TABLE "wallet_accounts"
  ADD COLUMN "activationStatus" "WalletActivationStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "activationUnsignedXdr" TEXT,
  ADD COLUMN "activationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "activationTxHash" TEXT,
  ADD COLUMN "activationErrorMessage" TEXT;

UPDATE "wallet_accounts"
SET "activationStatus" = 'ACTIVATED'
WHERE "isActivated" = true;
