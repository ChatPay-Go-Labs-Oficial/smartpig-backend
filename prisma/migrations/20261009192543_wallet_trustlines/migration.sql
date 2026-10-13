-- CreateEnum
CREATE TYPE "TrustlineStatus" AS ENUM ('PENDING_SIGNATURE', 'ACTIVE', 'FAILED');

-- AlterTable
ALTER TABLE "account_deletion_requests" ADD COLUMN     "sweptAssets" JSONB;

-- CreateTable
CREATE TABLE "wallet_trustlines" (
    "id" TEXT NOT NULL,
    "walletAccountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "status" "TrustlineStatus" NOT NULL DEFAULT 'PENDING_SIGNATURE',
    "unsignedXdr" TEXT,
    "expiresAt" TIMESTAMP(3),
    "txHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_trustlines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_trustlines_walletAccountId_idx" ON "wallet_trustlines"("walletAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_trustlines_walletAccountId_assetId_key" ON "wallet_trustlines"("walletAccountId", "assetId");

-- AddForeignKey
ALTER TABLE "wallet_trustlines" ADD CONSTRAINT "wallet_trustlines_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
