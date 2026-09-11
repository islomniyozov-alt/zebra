-- Settlement becomes org-wide. Islom's ruling, 2026-09-11.
--
-- The sister companies are ONE operation: one `SettlementBatch` per period for
-- the whole organization, one SB- number per week, one statement per driver
-- whatever authority the freight was pulled under. This supersedes item 3's
-- "batch per company per week", which was read off Datatruck's own shape.
--
-- ── SAFE BECAUSE NOBODY HAS BEEN PAID YET ────────────────────────────────
--
-- Asked before writing, as for every change to these tables:
-- `scripts/inspect-settlement-rows.mjs` against production, 2026-09-11 —
-- ZERO settlements, ZERO settlement lines. Dropping a NOT NULL column here
-- strands nothing and rewrites nothing. The same question will have a
-- different answer the week after the first batch is finalised, and this
-- migration would not be writable then.
--
-- ── WHAT MOVES WHERE ─────────────────────────────────────────────────────
--
-- `SettlementBatch.companyId` goes: the batch is the organization's.
-- `Settlement.companyId` STAYS and is redefined — it is now the LETTERHEAD,
-- the authority that owns the truck the settlement is frozen on, resolved once
-- at generation beside `unitNumber`.
-- `SettlementLoadLine` gains the authority its load belonged to, frozen, so a
-- statement carrying two companies can group its lines under sub-headings
-- without re-reading loads that may since have moved.

-- Backfill before the constraint, so this is re-runnable against a database
-- that somehow has rows. With zero rows it is a no-op.
ALTER TABLE "SettlementLoadLine"
  ADD COLUMN "companyId"   TEXT,
  ADD COLUMN "companyName" TEXT;

UPDATE "SettlementLoadLine" sll
   SET "companyId"   = l."companyId",
       "companyName" = c."name"
  FROM "Load" l
  JOIN "Company" c ON c.id = l."companyId"
 WHERE sll."loadId" = l.id AND sll."companyId" IS NULL;

ALTER TABLE "SettlementLoadLine"
  ALTER COLUMN "companyId"   SET NOT NULL,
  ALTER COLUMN "companyName" SET NOT NULL;

ALTER TABLE "SettlementLoadLine" ADD CONSTRAINT "SettlementLoadLine_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "SettlementLoadLine_companyId_idx"
  ON "SettlementLoadLine"("companyId");

-- ST- IS ONE SERIES ACROSS THE ORGANIZATION, so its unique must be too. Keyed
-- on the company it permitted two ST-000441s in different authorities, which
-- is precisely what a shared counter must not allow.
DROP INDEX IF EXISTS "Settlement_companyId_settlementNumber_key";
CREATE UNIQUE INDEX "Settlement_organizationId_settlementNumber_key"
  ON "Settlement"("organizationId", "settlementNumber");

-- The batch stops belonging to an authority.
ALTER TABLE "SettlementBatch" DROP CONSTRAINT IF EXISTS "SettlementBatch_companyId_fkey";
DROP INDEX IF EXISTS "SettlementBatch_companyId_periodStart_idx";
ALTER TABLE "SettlementBatch" DROP COLUMN "companyId";

-- The money screen asks this on every open: is there a batch for this period.
CREATE INDEX "SettlementBatch_organizationId_periodStart_idx"
  ON "SettlementBatch"("organizationId", "periodStart");

-- NO UNIQUE ON (organizationId, periodStart), and that is the ruling rather
-- than an omission. One batch per period is enforced by the ACTION, which
-- refuses a second one; the database stays permissive because a held line
-- confirmed after FINAL has to land somewhere, and post-FINAL money is a
-- next-week line by a ruling that still stands.
