-- CreateEnum
CREATE TYPE "ManagedVaultStatus" AS ENUM ('PENDING_SIGNATURE', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "managed_vaults" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "callerAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "vaultFeeBps" INTEGER NOT NULL DEFAULT 25,
    "roles" JSONB NOT NULL,
    "assets" JSONB NOT NULL,
    "status" "ManagedVaultStatus" NOT NULL DEFAULT 'PENDING_SIGNATURE',
    "unsignedXdr" TEXT,
    "signedXdr" TEXT,
    "predictedVaultAddress" TEXT,
    "txHash" TEXT,
    "vaultCatalogId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "managed_vaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "managed_vaults_txHash_key" ON "managed_vaults"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "managed_vaults_vaultCatalogId_key" ON "managed_vaults"("vaultCatalogId");

-- CreateIndex
CREATE INDEX "managed_vaults_creatorUserId_idx" ON "managed_vaults"("creatorUserId");

-- CreateIndex
CREATE INDEX "managed_vaults_status_idx" ON "managed_vaults"("status");

-- AddForeignKey
ALTER TABLE "managed_vaults" ADD CONSTRAINT "managed_vaults_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "managed_vaults" ADD CONSTRAINT "managed_vaults_vaultCatalogId_fkey" FOREIGN KEY ("vaultCatalogId") REFERENCES "vault_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
