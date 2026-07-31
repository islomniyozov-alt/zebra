-- ---------------------------------------------------------------------------
-- UNIQUENESS THAT UNDERSTANDS A SOFT DELETE
--
-- Flagged in Step 2, resolved here. `@@unique([companyId, unitNumber])` carried
-- no predicate, so a REMOVED truck 101 kept holding the number against a new
-- one: a row the user cannot see blocking a row they are trying to create. The
-- service layer explained that collision politely, which is right for a genuine
-- clash and wrong for this one — the number should simply have been free.
--
-- Prisma cannot express a `WHERE` predicate on an index, so the plain unique
-- constraints are dropped and partial ones created by hand. Exactly the shape
-- already used for the AssetAssignment open-period indexes in
-- 20260728224900_rls_and_isolation.
--
-- NOT DONE FOR `Load`. `@@unique([companyId, loadNumber])` stays whole on
-- purpose: load numbers come from a Counter, are never reused, and a cancelled
-- or deleted load keeps its number reserved forever. A broker holding load 1043
-- on a rate confirmation must never be shown a different load 1043.
-- ---------------------------------------------------------------------------

-- DropIndex
DROP INDEX "Trailer_companyId_unitNumber_key";

-- DropIndex
DROP INDEX "Truck_companyId_unitNumber_key";

-- CreateIndex
CREATE INDEX "Trailer_companyId_unitNumber_idx" ON "Trailer"("companyId", "unitNumber");

-- CreateIndex
CREATE INDEX "Truck_companyId_unitNumber_idx" ON "Truck"("companyId", "unitNumber");

-- ---------------------------------------------------------------------------
-- The uniqueness itself. Live rows only.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "truck_unit_per_company"
  ON "Truck"("companyId", "unitNumber") WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "trailer_unit_per_company"
  ON "Trailer"("companyId", "unitNumber") WHERE "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Fail the migration if either index did not land.
--
-- Standing rule 8: a guardrail nobody has watched fail might be misconfigured.
-- A partial index is invisible to Prisma, so nothing downstream would notice
-- its absence until two live trucks shared a unit number in production.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(expected, ', ')
    INTO missing
    FROM (VALUES ('truck_unit_per_company'), ('trailer_unit_per_company')) AS t(expected)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname = t.expected
   );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Partial unique index missing: %', missing;
  END IF;
END $$;
