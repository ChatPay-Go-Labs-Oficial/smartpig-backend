-- CreateEnum
CREATE TYPE "EtherfuseKycStatus" AS ENUM ('NOT_STARTED', 'PROPOSED', 'APPROVED', 'APPROVED_CHAIN_DEPLOYING', 'REJECTED');

-- CreateEnum
CREATE TYPE "EtherfuseOrderDirection" AS ENUM ('ONRAMP', 'OFFRAMP');

-- CreateEnum
CREATE TYPE "EtherfuseOrderStatus" AS ENUM ('CREATED', 'PENDING_SIGNATURE', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "etherfuse_customers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "etherfuseOrgId" TEXT NOT NULL,
    "kycStatus" "EtherfuseKycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etherfuse_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etherfuse_bank_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "etherfuseBankId" TEXT NOT NULL,
    "clabe" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "isCompliant" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etherfuse_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etherfuse_orders" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "etherfuseOrderId" TEXT,
    "etherfuseQuoteId" TEXT NOT NULL,
    "direction" "EtherfuseOrderDirection" NOT NULL,
    "status" "EtherfuseOrderStatus" NOT NULL DEFAULT 'CREATED',
    "sourceAsset" TEXT NOT NULL,
    "targetAsset" TEXT NOT NULL,
    "sourceAmount" DECIMAL(30,8) NOT NULL,
    "destinationAmount" DECIMAL(30,8) NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "unsignedBurnXdr" TEXT,
    "signedBurnXdr" TEXT,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etherfuse_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "etherfuse_customers_userId_key" ON "etherfuse_customers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "etherfuse_customers_etherfuseOrgId_key" ON "etherfuse_customers"("etherfuseOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "etherfuse_bank_accounts_etherfuseBankId_key" ON "etherfuse_bank_accounts"("etherfuseBankId");

-- CreateIndex
CREATE INDEX "etherfuse_bank_accounts_customerId_idx" ON "etherfuse_bank_accounts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "etherfuse_orders_idempotencyKey_key" ON "etherfuse_orders"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "etherfuse_orders_etherfuseOrderId_key" ON "etherfuse_orders"("etherfuseOrderId");

-- CreateIndex
CREATE INDEX "etherfuse_orders_customerId_status_idx" ON "etherfuse_orders"("customerId", "status");

-- AddForeignKey
ALTER TABLE "etherfuse_customers" ADD CONSTRAINT "etherfuse_customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etherfuse_bank_accounts" ADD CONSTRAINT "etherfuse_bank_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "etherfuse_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etherfuse_orders" ADD CONSTRAINT "etherfuse_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "etherfuse_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etherfuse_orders" ADD CONSTRAINT "etherfuse_orders_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "etherfuse_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
