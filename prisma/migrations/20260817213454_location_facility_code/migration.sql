-- The carrier's own code for a facility: "MEM1", "DXH5",
-- "KCDC_WAR_740370001_656". Exact lookup, never fuzzy — the address matcher in
-- facility-memory.ts exists because addresses are written six ways, and a code
-- is written one way or it is a different facility.
ALTER TABLE "Location" ADD COLUMN "facilityCode" TEXT;

-- ALSO THE SEED'S IDEMPOTENCY KEY. Re-importing the locations export upserts
-- on (organizationId, facilityCode) and cannot duplicate.
--
-- Nullable, and Postgres does not collide NULLs: the thousands of locations a
-- dispatcher typed have no code and never will, so they coexist here without
-- one blocking another.
CREATE UNIQUE INDEX "Location_organizationId_facilityCode_key"
  ON "Location"("organizationId", "facilityCode");

-- NO GRANT NEEDED: a column and an index on a table that already carries its
-- own grants from 20260728224443_init. "Location" keeps its RLS policy
-- untouched — this adds a column to a tenant table, not a new table.
