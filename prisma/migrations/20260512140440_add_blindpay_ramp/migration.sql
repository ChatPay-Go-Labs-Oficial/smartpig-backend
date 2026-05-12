-- CreateEnum
CREATE TYPE "RampStatus" AS ENUM ('PENDING', 'AWAITING_PAYMENT', 'PROCESSING', 'DELEGATION_NEEDED', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "blindpay_receivers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blindpayReceiverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blindpay_receivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blindpay_bank_accounts" (
    "id" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "blindpayBankAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "pixKey" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blindpay_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blindpay_blockchain_wallets" (
    "id" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "blindpayWalletId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blindpay_blockchain_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onramp_transactions" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "blockchainWalletId" TEXT NOT NULL,
    "blindpayPayinId" TEXT,
    "blindpayQuoteId" TEXT,
    "amountBrl" DECIMAL(20,2) NOT NULL,
    "amountUsdc" DECIMAL(20,6),
    "pixCode" TEXT,
    "status" "RampStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onramp_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offramp_transactions" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "blindpayPayoutId" TEXT,
    "blindpayQuoteId" TEXT,
    "amountUsdc" DECIMAL(20,6) NOT NULL,
    "amountBrl" DECIMAL(20,2),
    "senderWalletAddress" TEXT NOT NULL,
    "unsignedDelegationXdr" TEXT,
    "signedDelegationHash" TEXT,
    "status" "RampStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offramp_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blindpay_receivers_userId_key" ON "blindpay_receivers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "blindpay_receivers_blindpayReceiverId_key" ON "blindpay_receivers"("blindpayReceiverId");

-- CreateIndex
CREATE UNIQUE INDEX "blindpay_bank_accounts_blindpayBankAccountId_key" ON "blindpay_bank_accounts"("blindpayBankAccountId");

-- CreateIndex
CREATE INDEX "blindpay_bank_accounts_receiverId_idx" ON "blindpay_bank_accounts"("receiverId");

-- CreateIndex
CREATE UNIQUE INDEX "blindpay_blockchain_wallets_blindpayWalletId_key" ON "blindpay_blockchain_wallets"("blindpayWalletId");

-- CreateIndex
CREATE INDEX "blindpay_blockchain_wallets_receiverId_idx" ON "blindpay_blockchain_wallets"("receiverId");

-- CreateIndex
CREATE UNIQUE INDEX "onramp_transactions_idempotencyKey_key" ON "onramp_transactions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "onramp_transactions_blindpayPayinId_key" ON "onramp_transactions"("blindpayPayinId");

-- CreateIndex
CREATE INDEX "onramp_transactions_userId_status_idx" ON "onramp_transactions"("userId", "status");

-- CreateIndex
CREATE INDEX "onramp_transactions_blindpayPayinId_idx" ON "onramp_transactions"("blindpayPayinId");

-- CreateIndex
CREATE UNIQUE INDEX "offramp_transactions_idempotencyKey_key" ON "offramp_transactions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "offramp_transactions_blindpayPayoutId_key" ON "offramp_transactions"("blindpayPayoutId");

-- CreateIndex
CREATE INDEX "offramp_transactions_userId_status_idx" ON "offramp_transactions"("userId", "status");

-- CreateIndex
CREATE INDEX "offramp_transactions_blindpayPayoutId_idx" ON "offramp_transactions"("blindpayPayoutId");

-- AddForeignKey
ALTER TABLE "blindpay_receivers" ADD CONSTRAINT "blindpay_receivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blindpay_bank_accounts" ADD CONSTRAINT "blindpay_bank_accounts_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "blindpay_receivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blindpay_blockchain_wallets" ADD CONSTRAINT "blindpay_blockchain_wallets_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "blindpay_receivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onramp_transactions" ADD CONSTRAINT "onramp_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onramp_transactions" ADD CONSTRAINT "onramp_transactions_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "blindpay_receivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onramp_transactions" ADD CONSTRAINT "onramp_transactions_blockchainWalletId_fkey" FOREIGN KEY ("blockchainWalletId") REFERENCES "blindpay_blockchain_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offramp_transactions" ADD CONSTRAINT "offramp_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offramp_transactions" ADD CONSTRAINT "offramp_transactions_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "blindpay_receivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offramp_transactions" ADD CONSTRAINT "offramp_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "blindpay_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
