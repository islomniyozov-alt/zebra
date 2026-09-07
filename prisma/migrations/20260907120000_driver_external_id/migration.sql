-- THE ID A DRIVER CARRIED IN THE SYSTEM THEY WERE MIGRATED FROM.
--
-- The Datatruck export carries a stable numeric id on all 54 rows and this
-- schema had nowhere to put it, so a re-run of the import had nothing to match
-- on. The alternative was (companyId, firstName, lastName), which is unique
-- across those 54 rows TODAY and stops being unique the first time somebody
-- marries or a second Ivanov is hired — silently merging two people, or
-- splitting one into two settlement cheques.
--
-- ADDITIVE AND NULLABLE. Every existing row gets NULL, which is correct: they
-- were not migrated from anywhere. No backfill, no default, no rewrite.
ALTER TABLE "Driver" ADD COLUMN "externalId" TEXT;

-- UNIQUE PER ORGANIZATION, NOT PER COMPANY. A driver moves between the sister
-- authorities — that is the whole point of AssetAssignment — and their id in
-- the old system does not change when they do. Scoping this to companyId would
-- let one Datatruck driver exist twice in one organization, which is the exact
-- failure the column was added to prevent.
--
-- NULLS ARE DISTINCT to Postgres in a unique index, so any number of drivers
-- may carry no external id. That is the common case from here on: this is a
-- migration key, not an identifier the interface asks anyone for.
--
-- Named exactly as Prisma names `@@unique([organizationId, externalId])`, so
-- migrate's drift detection sees the schema and the database agreeing.
CREATE UNIQUE INDEX "Driver_organizationId_externalId_key"
  ON "Driver"("organizationId", "externalId");

-- NO GRANT AND NO POLICY NEEDED: a column and an index on a table that already
-- carries its grants and its org_isolation policy from 20260728224443_init.
