-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('CREATED', 'XDR_GENERATED', 'SIGNED_XDR_RECEIVED', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntentType" AS ENUM ('DEPOSIT', 'WITHDRAWAL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "googleId" TEXT,
    "appleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stellarAddress" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_catalog" (
    "id" TEXT NOT NULL,
    "defindexVaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "description" TEXT,
    "apy" DECIMAL(10,4),
    "tvl" DECIMAL(30,8),
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_intents" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAccountId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "amount" DECIMAL(30,8) NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "status" "IntentStatus" NOT NULL DEFAULT 'CREATED',
    "unsignedXdr" TEXT,
    "signedXdr" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_intents" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAccountId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "shareAmount" DECIMAL(30,8) NOT NULL,
    "status" "IntentStatus" NOT NULL DEFAULT 'CREATED',
    "unsignedXdr" TEXT,
    "signedXdr" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intentType" "IntentType" NOT NULL,
    "depositIntentId" TEXT,
    "withdrawalIntentId" TEXT,
    "txHash" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "blockchainResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "transaction_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "balanceAmount" DECIMAL(30,8) NOT NULL,
    "balanceUsd" DECIMAL(20,4),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "users_appleId_key" ON "users"("appleId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "wallet_accounts_userId_idx" ON "wallet_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_accounts_userId_stellarAddress_key" ON "wallet_accounts"("userId", "stellarAddress");

-- CreateIndex
CREATE UNIQUE INDEX "vault_catalog_defindexVaultId_key" ON "vault_catalog"("defindexVaultId");

-- CreateIndex
CREATE INDEX "vault_catalog_isActive_idx" ON "vault_catalog"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_intents_idempotencyKey_key" ON "deposit_intents"("idempotencyKey");

-- CreateIndex
CREATE INDEX "deposit_intents_userId_status_idx" ON "deposit_intents"("userId", "status");

-- CreateIndex
CREATE INDEX "deposit_intents_status_expiresAt_idx" ON "deposit_intents"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_intents_idempotencyKey_key" ON "withdrawal_intents"("idempotencyKey");

-- CreateIndex
CREATE INDEX "withdrawal_intents_userId_status_idx" ON "withdrawal_intents"("userId", "status");

-- CreateIndex
CREATE INDEX "withdrawal_intents_status_expiresAt_idx" ON "withdrawal_intents"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_records_depositIntentId_key" ON "transaction_records"("depositIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_records_withdrawalIntentId_key" ON "transaction_records"("withdrawalIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_records_txHash_key" ON "transaction_records"("txHash");

-- CreateIndex
CREATE INDEX "transaction_records_userId_idx" ON "transaction_records"("userId");

-- CreateIndex
CREATE INDEX "transaction_records_txHash_idx" ON "transaction_records"("txHash");

-- CreateIndex
CREATE INDEX "transaction_records_status_idx" ON "transaction_records"("status");

-- CreateIndex
CREATE INDEX "portfolio_snapshots_userId_capturedAt_idx" ON "portfolio_snapshots"("userId", "capturedAt");

-- CreateIndex
CREATE INDEX "portfolio_snapshots_vaultId_capturedAt_idx" ON "portfolio_snapshots"("vaultId", "capturedAt");

-- CreateIndex
CREATE INDEX "api_audit_logs_userId_createdAt_idx" ON "api_audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "api_audit_logs_action_resource_idx" ON "api_audit_logs"("action", "resource");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_intents" ADD CONSTRAINT "withdrawal_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_intents" ADD CONSTRAINT "withdrawal_intents_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_intents" ADD CONSTRAINT "withdrawal_intents_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_depositIntentId_fkey" FOREIGN KEY ("depositIntentId") REFERENCES "deposit_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_withdrawalIntentId_fkey" FOREIGN KEY ("withdrawalIntentId") REFERENCES "withdrawal_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_audit_logs" ADD CONSTRAINT "api_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
