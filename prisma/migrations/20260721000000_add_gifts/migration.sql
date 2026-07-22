-- CreateEnum
CREATE TYPE "GiftStatus" AS ENUM ('CREATED', 'FUNDED', 'CLAIMING', 'CLAIMED', 'EXPIRED', 'REFUNDED');

-- CreateTable
CREATE TABLE "gifts" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderWalletId" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "amount" DECIMAL(30,8) NOT NULL,
    "assetSymbol" TEXT NOT NULL DEFAULT 'USDC',
    "status" "GiftStatus" NOT NULL DEFAULT 'CREATED',
    "balanceId" TEXT,
    "fundingTxHash" TEXT,
    "claimTxHash" TEXT,
    "memo" TEXT NOT NULL,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gifts_idempotencyKey_key" ON "gifts"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "gifts_code_key" ON "gifts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "gifts_memo_key" ON "gifts"("memo");

-- CreateIndex
CREATE INDEX "gifts_senderUserId_status_idx" ON "gifts"("senderUserId", "status");

-- CreateIndex
CREATE INDEX "gifts_status_expiresAt_idx" ON "gifts"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

