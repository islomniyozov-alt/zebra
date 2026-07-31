-- ---------------------------------------------------------------------------
-- A FACILITY'S OWN TIMEZONE, AND A PLACE TO KEEP PER-USER PREFERENCES.
--
-- `Location.timezone` closes the gap flagged in Step 5. Design-system rule 3
-- wants an appointment rendered in the STOP's zone; until now that zone was
-- derived from the state, which is right for most of the country and wrong for
-- the thirteen states that span two. The derivation stays as the fallback —
-- this is the override.
--
-- `UserPreference` is the saved-view store (§7.4) and, from Step 7, the density
-- store (§5.1). Key/value rather than columns because the two are the same
-- shape of fact and neither deserves a table.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPreference_organizationId_idx" ON "UserPreference"("organizationId");

-- CreateIndex
CREATE INDEX "UserPreference_userId_organizationId_idx" ON "UserPreference"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_organizationId_key_key" ON "UserPreference"("userId", "organizationId", "key");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY. A new table carrying organizationId is a new tenant
-- table, and a tenant table without a policy is a leak. ENABLE and FORCE, one
-- policy shape, FOR ALL with no WITH CHECK so USING governs reads and writes
-- alike — identical to every other table in 20260728224900.
--
-- The structure audit promoted into tests/structure.test.ts fails the build if
-- this is forgotten, which is how it was not forgotten.
-- ---------------------------------------------------------------------------

ALTER TABLE "UserPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserPreference" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "UserPreference"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ALTER DEFAULT PRIVILEGES in the RLS migration already grants zebra_app on
-- new tables, but only for tables created by the same role. Stated explicitly
-- so this does not depend on who ran the migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON "UserPreference" TO zebra_app;

-- ---------------------------------------------------------------------------
-- BACKFILL, for the states that have exactly one zone.
--
-- The thirteen split states are deliberately left NULL: AK, FL, ID, IN, KS,
-- KY, MI, ND, NE, OR, SD, TN, TX. Guessing for them would replace a visible
-- approximation — the interface marks derived zones as approximate — with an
-- invisible one stored as fact, which is worse. They get a real zone when
-- somebody who knows the dock enters it.
-- ---------------------------------------------------------------------------

UPDATE "Location" SET "timezone" = zones.zone
  FROM (VALUES
    ('AL','America/Chicago'), ('AZ','America/Phoenix'), ('AR','America/Chicago'),
    ('CA','America/Los_Angeles'), ('CO','America/Denver'), ('CT','America/New_York'),
    ('DE','America/New_York'), ('DC','America/New_York'), ('GA','America/New_York'),
    ('HI','Pacific/Honolulu'), ('IL','America/Chicago'), ('IA','America/Chicago'),
    ('LA','America/Chicago'), ('ME','America/New_York'), ('MD','America/New_York'),
    ('MA','America/New_York'), ('MN','America/Chicago'), ('MS','America/Chicago'),
    ('MO','America/Chicago'), ('MT','America/Denver'), ('NV','America/Los_Angeles'),
    ('NH','America/New_York'), ('NJ','America/New_York'), ('NM','America/Denver'),
    ('NY','America/New_York'), ('NC','America/New_York'), ('OH','America/New_York'),
    ('OK','America/Chicago'), ('PA','America/New_York'), ('PR','America/Puerto_Rico'),
    ('RI','America/New_York'), ('SC','America/New_York'), ('UT','America/Denver'),
    ('VT','America/New_York'), ('VA','America/New_York'), ('WA','America/Los_Angeles'),
    ('WV','America/New_York'), ('WI','America/Chicago'), ('WY','America/Denver'),
    ('AB','America/Edmonton'), ('BC','America/Vancouver'), ('MB','America/Winnipeg'),
    ('ON','America/Toronto'), ('QC','America/Toronto'), ('SK','America/Regina')
  ) AS zones(state, zone)
 WHERE upper("Location"."state") = zones.state
   AND "Location"."timezone" IS NULL;

-- ---------------------------------------------------------------------------
-- Fail the migration if the policy did not land.
--
-- Standing rule 8: a guardrail nobody has watched fail might be misconfigured.
-- An RLS policy is invisible until the day it is missing, and that day is the
-- day one tenant reads another's saved views.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = current_schema()
       AND tablename = 'UserPreference'
       AND policyname = 'org_isolation'
  ) THEN
    RAISE EXCEPTION 'UserPreference has no org_isolation policy';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE relname = 'UserPreference' AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'UserPreference does not have RLS enabled AND forced';
  END IF;
END $$;
