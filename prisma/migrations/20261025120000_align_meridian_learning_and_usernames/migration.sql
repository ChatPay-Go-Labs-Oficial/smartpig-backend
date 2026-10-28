-- HackMeridian alignment: permanent public username and richer lesson steps.
ALTER TABLE "users"
ADD COLUMN "username" TEXT,
ADD COLUMN "usernameSetAt" TIMESTAMP(3);

ALTER TABLE "learning_questions"
ADD COLUMN "title" TEXT,
ADD COLUMN "situation" JSONB,
ADD COLUMN "reviewContentItemKey" TEXT;

ALTER TABLE "learning_modules" ADD COLUMN "proTitle" TEXT;

ALTER TABLE "learning_questions" ALTER COLUMN "xpReward" SET DEFAULT 0;
ALTER TABLE "learning_modules" ALTER COLUMN "completionXp" SET DEFAULT 15;
UPDATE "learning_questions" SET "xpReward" = 0;
UPDATE "learning_modules" SET "completionXp" = 15;

-- Preserve old one-time lesson awards under the new logical source key.
-- Otherwise a completed lesson could earn a second award after this release.
UPDATE "experience_xp_ledger"
SET
  "sourceRef" = 'lesson:' || "sourceRef",
  "dedupeKey" = regexp_replace(
    "dedupeKey",
    ':LEARNING_MODULE:(M[1-5])$',
    ':LEARNING_MODULE:lesson:\1'
  )
WHERE
  "sourceType" = 'LEARNING_MODULE'
  AND "sourceRef" IN ('M1', 'M2', 'M3', 'M4', 'M5');

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- The service normalizes before writing; the database keeps the invariant for
-- imports, scripts and future writers too.
ALTER TABLE "users"
ADD CONSTRAINT "users_username_format_check"
CHECK (
  "username" IS NULL OR
  "username" ~ '^[a-z][a-z0-9._]{2,19}$'
);

-- Publish the temporary Meridian policy even on Railway deployments that run
-- migrations without running the editorial seed. A future operator-owned
-- version (> 2) is always preserved.
UPDATE "vault_eligibility_policies" AS policy
SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
FROM "vault_catalog" AS vault
WHERE
  policy."vaultId" = vault."id"
  AND policy."isActive" = true
  AND vault."assetSymbol" IN ('EURC', 'XLM')
  AND (
    (vault."assetSymbol" = 'EURC' AND (
      SELECT count(*) FROM "learning_modules"
      WHERE "key" IN ('M1', 'M2', 'M3')
    ) = 3)
    OR
    (vault."assetSymbol" = 'XLM' AND (
      SELECT count(*) FROM "learning_modules"
      WHERE "key" IN ('M1', 'M2', 'M3', 'M4', 'M5')
    ) = 5)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "vault_eligibility_policies" AS later
    WHERE later."vaultId" = vault."id" AND later."version" > 2
  );

INSERT INTO "vault_eligibility_policies" (
  "id", "vaultId", "version", "minimumLevel", "isActive",
  "publishedAt", "createdAt", "updatedAt"
)
SELECT
  'meridian-v2-' || vault."id",
  vault."id",
  2,
  0,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "vault_catalog" AS vault
WHERE
  vault."assetSymbol" IN ('EURC', 'XLM')
  AND (
    (vault."assetSymbol" = 'EURC' AND (
      SELECT count(*) FROM "learning_modules"
      WHERE "key" IN ('M1', 'M2', 'M3')
    ) = 3)
    OR
    (vault."assetSymbol" = 'XLM' AND (
      SELECT count(*) FROM "learning_modules"
      WHERE "key" IN ('M1', 'M2', 'M3', 'M4', 'M5')
    ) = 5)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "vault_eligibility_policies" AS later
    WHERE later."vaultId" = vault."id" AND later."version" > 2
  )
ON CONFLICT ("vaultId", "version") DO UPDATE SET
  "minimumLevel" = 0,
  "isActive" = true,
  "publishedAt" = COALESCE(
    "vault_eligibility_policies"."publishedAt",
    CURRENT_TIMESTAMP
  ),
  "updatedAt" = CURRENT_TIMESTAMP;

DELETE FROM "vault_eligibility_required_modules" AS requirement
USING "vault_eligibility_policies" AS policy, "vault_catalog" AS vault
WHERE
  requirement."policyId" = policy."id"
  AND policy."vaultId" = vault."id"
  AND policy."version" = 2
  AND policy."isActive" = true
  AND vault."assetSymbol" IN ('EURC', 'XLM')
  AND (
    (vault."assetSymbol" = 'EURC' AND (
      SELECT count(*) FROM "learning_modules"
      WHERE "key" IN ('M1', 'M2', 'M3')
    ) = 3)
    OR
    (vault."assetSymbol" = 'XLM' AND (
      SELECT count(*) FROM "learning_modules"
      WHERE "key" IN ('M1', 'M2', 'M3', 'M4', 'M5')
    ) = 5)
  );

INSERT INTO "vault_eligibility_required_modules" (
  "id", "policyId", "moduleId"
)
SELECT
  'meridian-v2-req-' || policy."id" || '-' || module."id",
  policy."id",
  module."id"
FROM "vault_eligibility_policies" AS policy
JOIN "vault_catalog" AS vault ON vault."id" = policy."vaultId"
JOIN "learning_modules" AS module ON (
  (vault."assetSymbol" = 'EURC' AND module."key" IN ('M1', 'M2', 'M3'))
  OR
  (vault."assetSymbol" = 'XLM' AND module."key" IN ('M1', 'M2', 'M3', 'M4', 'M5'))
)
WHERE policy."version" = 2 AND policy."isActive" = true
ON CONFLICT ("policyId", "moduleId") DO NOTHING;

-- Persist every entitlement already earned under the new policy. The level is
-- evidence only here because the Meridian minimum is zero.
INSERT INTO "user_vault_unlocks" (
  "id", "userId", "vaultId", "policyId", "policyVersion",
  "levelAtUnlock", "unlockedAt"
)
SELECT
  'meridian-v2-unlock-' || usr."id" || '-' || policy."vaultId",
  usr."id",
  policy."vaultId",
  policy."id",
  policy."version",
  COALESCE(account."currentLevel", 0),
  CURRENT_TIMESTAMP
FROM "users" AS usr
CROSS JOIN "vault_eligibility_policies" AS policy
JOIN "vault_catalog" AS vault ON vault."id" = policy."vaultId"
LEFT JOIN "experience_accounts" AS account ON account."userId" = usr."id"
WHERE
  usr."experienceMode" = 'LITE'
  AND policy."version" = 2
  AND policy."isActive" = true
  AND vault."assetSymbol" IN ('EURC', 'XLM')
  AND (
    (vault."assetSymbol" = 'EURC' AND (
      SELECT count(*)
      FROM "vault_eligibility_required_modules"
      WHERE "policyId" = policy."id"
    ) = 3)
    OR
    (vault."assetSymbol" = 'XLM' AND (
      SELECT count(*)
      FROM "vault_eligibility_required_modules"
      WHERE "policyId" = policy."id"
    ) = 5)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "vault_eligibility_required_modules" AS requirement
    WHERE
      requirement."policyId" = policy."id"
      AND NOT EXISTS (
        SELECT 1
        FROM "user_learning_module_progress" AS progress
        WHERE
          progress."userId" = usr."id"
          AND progress."moduleId" = requirement."moduleId"
          AND progress."completedAt" IS NOT NULL
      )
  )
ON CONFLICT ("userId", "vaultId") DO NOTHING;
