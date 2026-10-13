-- Rows present when the registry feature is deployed were already selected and
-- named by an operator. Protect that metadata from the discovery job, which only
-- follows upstream names/symbols for newly discovered, uncurated rows.
UPDATE "vault_catalog"
SET "isCurated" = true;

-- Establish a deterministic product order for the initial multi-vault catalog.
-- Unknown/future assets retain the neutral default and can be ordered by admin.
UPDATE "vault_catalog"
SET "displayOrder" = CASE UPPER("assetSymbol")
    WHEN 'USDC' THEN 10
    WHEN 'EURC' THEN 20
    WHEN 'XLM' THEN 30
    ELSE 100
END;

-- The dollar vault is the house vault. Pick exactly one deterministically in case
-- production happens to contain more than one active USDC vault.
UPDATE "vault_catalog"
SET "isFeatured" = false;

WITH "house_vault" AS (
    SELECT "id"
    FROM "vault_catalog"
    WHERE "isActive" = true
      AND UPPER("assetSymbol") = 'USDC'
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT 1
)
UPDATE "vault_catalog"
SET "isFeatured" = true
WHERE "id" = (SELECT "id" FROM "house_vault");
