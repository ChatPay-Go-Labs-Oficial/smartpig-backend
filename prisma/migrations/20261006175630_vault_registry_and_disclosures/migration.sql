-- AlterTable
ALTER TABLE "deposit_intents" ADD COLUMN     "failureCode" TEXT;

-- AlterTable
ALTER TABLE "vault_catalog" ADD COLUMN     "assetContractId" TEXT,
ADD COLUMN     "configRecord" JSONB,
ADD COLUMN     "configSchemaVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "depositsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "discoveredAssetSymbol" TEXT,
ADD COLUMN     "discoveredName" TEXT,
ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "isCurated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "protocol" TEXT NOT NULL DEFAULT 'DEFINDEX';

-- AlterTable
ALTER TABLE "withdrawal_intents" ADD COLUMN     "failureCode" TEXT;

-- CreateTable
CREATE TABLE "vault_disclosures" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "risks" JSONB NOT NULL,
    "sections" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_disclosures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_disclosure_acknowledgments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "disclosureId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context" JSONB,

    CONSTRAINT "vault_disclosure_acknowledgments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vault_disclosures_vaultId_publishedAt_idx" ON "vault_disclosures"("vaultId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "vault_disclosures_vaultId_version_key" ON "vault_disclosures"("vaultId", "version");

-- CreateIndex
CREATE INDEX "vault_disclosure_acknowledgments_userId_vaultId_idx" ON "vault_disclosure_acknowledgments"("userId", "vaultId");

-- CreateIndex
CREATE INDEX "vault_disclosure_acknowledgments_disclosureId_idx" ON "vault_disclosure_acknowledgments"("disclosureId");

-- CreateIndex
CREATE UNIQUE INDEX "vault_disclosure_acknowledgments_userId_vaultId_version_key" ON "vault_disclosure_acknowledgments"("userId", "vaultId", "version");

-- CreateIndex
CREATE INDEX "vault_catalog_isActive_displayOrder_idx" ON "vault_catalog"("isActive", "displayOrder");

-- AddForeignKey
ALTER TABLE "vault_disclosures" ADD CONSTRAINT "vault_disclosures_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_disclosure_acknowledgments" ADD CONSTRAINT "vault_disclosure_acknowledgments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_disclosure_acknowledgments" ADD CONSTRAINT "vault_disclosure_acknowledgments_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_disclosure_acknowledgments" ADD CONSTRAINT "vault_disclosure_acknowledgments_disclosureId_fkey" FOREIGN KEY ("disclosureId") REFERENCES "vault_disclosures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
