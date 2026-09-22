-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('REQUESTED', 'PENDING_SIGNATURE', 'CHAIN_CLOSED', 'LOCAL_SCRUBBED', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "wallet_accounts" ADD COLUMN     "archivedStellarAddress" TEXT;

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'REQUESTED',
    "closureUnsignedXdr" TEXT,
    "closureTxHash" TEXT,
    "sweptAmount" DECIMAL(30,8),
    "sweptAssetSymbol" TEXT,
    "acknowledgements" JSONB NOT NULL,
    "blindpayDeletedAt" TIMESTAMP(3),
    "privyDeletedAt" TIMESTAMP(3),
    "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_deletion_requests_idempotencyKey_key" ON "account_deletion_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "account_deletion_requests_status_idx" ON "account_deletion_requests"("status");

-- CreateIndex
CREATE INDEX "account_deletion_requests_userId_idx" ON "account_deletion_requests"("userId");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");
