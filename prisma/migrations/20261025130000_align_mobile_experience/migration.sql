ALTER TABLE "users" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_username_case_insensitive_key" ON "users"(lower("username"));
ALTER TABLE "users" ADD CONSTRAINT "users_username_format" CHECK ("username" IS NULL OR "username" ~ '^[a-z][a-z0-9._]{2,19}$');
CREATE FUNCTION preserve_username() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."username" IS NOT NULL AND NEW."username" IS DISTINCT FROM OLD."username" THEN
    RAISE EXCEPTION 'USERNAME_ALREADY_SET';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "users_username_immutable" BEFORE UPDATE OF "username" ON "users"
FOR EACH ROW EXECUTE FUNCTION preserve_username();

ALTER TABLE "learning_questions" ADD COLUMN "reviewScreenKey" TEXT, ADD COLUMN "stepOrder" INTEGER;
ALTER TABLE "learning_questions" ADD CONSTRAINT "learning_questions_review_screen_fkey"
  FOREIGN KEY ("reviewScreenKey") REFERENCES "learning_content_items"("key") ON DELETE SET NULL;
ALTER TABLE "learning_questions" ADD CONSTRAINT "learning_questions_step_order_positive" CHECK ("stepOrder" IS NULL OR "stepOrder" > 0);
ALTER TABLE "learning_questions" ALTER COLUMN "xpReward" SET DEFAULT 0;
ALTER TABLE "learning_modules" ALTER COLUMN "completionXp" SET DEFAULT 15;
UPDATE "learning_modules" SET "completionXp" = 15 WHERE "key" IN ('M1','M2','M3','M4','M5');
UPDATE "learning_questions" SET "xpReward" = 0 WHERE "moduleId" IN
  (SELECT "id" FROM "learning_modules" WHERE "key" IN ('M1','M2','M3','M4','M5'));
UPDATE "learning_content_items" SET "isActive" = false WHERE "key" IN ('H-A01','H-A02','H-A03');
-- Preserve earned XP; refresh only the level projection for the rounded curve.
UPDATE "experience_accounts" a SET "currentLevel" = (
  SELECT COALESCE(MAX(level), 0) FROM generate_series(1,50) AS level
  WHERE round(40 * power(level::numeric, 1.8)) <= a."totalXp"
);

-- Publish a new version only where the catalog is already seeded. The seed
-- handles fresh databases; published requirements and existing unlocks survive.
DO $$
DECLARE v RECORD; required_keys TEXT[]; new_version INTEGER; policy_id TEXT;
BEGIN
  FOR v IN SELECT "id", "assetSymbol" FROM "vault_catalog" WHERE "assetSymbol" IN ('EURC','XLM') LOOP
    required_keys := CASE WHEN v."assetSymbol" = 'EURC' THEN ARRAY['M1','M2','M3'] ELSE ARRAY['M1','M2','M3','M4','M5'] END;
    IF (SELECT count(*) FROM "learning_modules" WHERE "key" = ANY(required_keys)) <> cardinality(required_keys) THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('vault-policy:' || v."id"));
    SELECT COALESCE(MAX("version"),0)+1 INTO new_version FROM "vault_eligibility_policies" WHERE "vaultId" = v."id";
    policy_id := 'meridian-' || md5(v."id" || ':' || new_version::text);
    UPDATE "vault_eligibility_policies" SET "isActive" = false WHERE "vaultId" = v."id" AND "isActive";
    INSERT INTO "vault_eligibility_policies" ("id","vaultId","version","minimumLevel","isActive","publishedAt","createdAt","updatedAt")
      VALUES (policy_id,v."id",new_version,0,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "vault_eligibility_required_modules" ("id","policyId","moduleId")
      SELECT 'meridian-' || md5(policy_id || ':' || "id"),policy_id,"id" FROM "learning_modules" WHERE "key" = ANY(required_keys);
    INSERT INTO "user_vault_unlocks" ("id","userId","vaultId","policyId","policyVersion","levelAtUnlock","unlockedAt")
      SELECT 'meridian-' || md5(u."id" || ':' || v."id"),u."id",v."id",policy_id,new_version,COALESCE(a."currentLevel",0),CURRENT_TIMESTAMP
      FROM "users" u LEFT JOIN "experience_accounts" a ON a."userId"=u."id"
      WHERE u."experienceMode"='LITE' AND u."deletedAt" IS NULL AND
      (SELECT count(*) FROM "user_learning_module_progress" p JOIN "learning_modules" m ON m."id"=p."moduleId"
        WHERE p."userId"=u."id" AND p."completedAt" IS NOT NULL AND m."key"=ANY(required_keys))=cardinality(required_keys)
      ON CONFLICT ("userId","vaultId") DO NOTHING;
  END LOOP;
END;
$$;
