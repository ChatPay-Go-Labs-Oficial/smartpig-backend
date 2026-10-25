-- CreateTable
CREATE TABLE "vault_eligibility_policies" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "minimumLevel" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_eligibility_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vault_eligibility_policies_version_check" CHECK ("version" > 0),
    CONSTRAINT "vault_eligibility_policies_minimumLevel_check" CHECK ("minimumLevel" BETWEEN 0 AND 50)
);

-- CreateTable
CREATE TABLE "vault_eligibility_required_modules" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,

    CONSTRAINT "vault_eligibility_required_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_vault_unlocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "levelAtUnlock" INTEGER NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_vault_unlocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_vault_unlocks_policyVersion_check" CHECK ("policyVersion" > 0),
    CONSTRAINT "user_vault_unlocks_levelAtUnlock_check" CHECK ("levelAtUnlock" BETWEEN 0 AND 50)
);

-- CreateIndex

CREATE UNIQUE INDEX "vault_eligibility_policies_vaultId_version_key" ON "vault_eligibility_policies"("vaultId", "version");
CREATE INDEX "vault_eligibility_policies_vaultId_isActive_publishedAt_idx" ON "vault_eligibility_policies"("vaultId", "isActive", "publishedAt");

-- Publishing is serialized in the service; this index is the final database
-- invariant if two operators still race from different application instances.
CREATE UNIQUE INDEX "vault_eligibility_policies_one_active_per_vault"
ON "vault_eligibility_policies"("vaultId") WHERE "isActive" = true;

CREATE UNIQUE INDEX "vault_eligibility_required_modules_policyId_moduleId_key" ON "vault_eligibility_required_modules"("policyId", "moduleId");
CREATE INDEX "vault_eligibility_required_modules_moduleId_idx" ON "vault_eligibility_required_modules"("moduleId");

CREATE UNIQUE INDEX "user_vault_unlocks_userId_vaultId_key" ON "user_vault_unlocks"("userId", "vaultId");
CREATE INDEX "user_vault_unlocks_vaultId_idx" ON "user_vault_unlocks"("vaultId");
CREATE INDEX "user_vault_unlocks_policyId_idx" ON "user_vault_unlocks"("policyId");

-- AddForeignKey
ALTER TABLE "vault_eligibility_policies" ADD CONSTRAINT "vault_eligibility_policies_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vault_eligibility_required_modules" ADD CONSTRAINT "vault_eligibility_required_modules_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "vault_eligibility_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vault_eligibility_required_modules" ADD CONSTRAINT "vault_eligibility_required_modules_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "learning_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_vault_unlocks" ADD CONSTRAINT "user_vault_unlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_vault_unlocks" ADD CONSTRAINT "user_vault_unlocks_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_vault_unlocks" ADD CONSTRAINT "user_vault_unlocks_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "vault_eligibility_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
