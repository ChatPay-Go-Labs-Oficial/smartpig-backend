-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('CREATED', 'XDR_GENERATED', 'SIGNED_XDR_RECEIVED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "asset_conversions" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAccountId" TEXT NOT NULL,
    "depositIntentId" TEXT,
    "plannedDeposit" JSONB,
    "sourceAssetId" TEXT NOT NULL,
    "targetAssetId" TEXT NOT NULL,
    "sourceSymbol" TEXT NOT NULL,
    "targetSymbol" TEXT NOT NULL,
    "sendAmount" DECIMAL(30,8) NOT NULL,
    "quotedDestAmount" DECIMAL(30,8) NOT NULL,
    "destMin" DECIMAL(30,8) NOT NULL,
    "slippageBps" INTEGER NOT NULL,
    "receivedAmount" DECIMAL(30,8),
    "path" JSONB NOT NULL,
    "status" "ConversionStatus" NOT NULL DEFAULT 'CREATED',
    "unsignedXdr" TEXT,
    "signedXdr" TEXT,
    "txHash" TEXT,
    "failureCode" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_conversions_idempotencyKey_key" ON "asset_conversions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "asset_conversions_depositIntentId_key" ON "asset_conversions"("depositIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_conversions_txHash_key" ON "asset_conversions"("txHash");

-- CreateIndex
CREATE INDEX "asset_conversions_userId_status_idx" ON "asset_conversions"("userId", "status");

-- CreateIndex
CREATE INDEX "asset_conversions_status_expiresAt_idx" ON "asset_conversions"("status", "expiresAt");
