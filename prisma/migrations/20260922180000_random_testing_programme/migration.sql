-- ITEM 15 — THE RANDOM TESTING PROGRAMME, 49 CFR 382.305.
--
-- Four tables. A carrier must randomly test a minimum percentage of its driver
-- positions each year for drugs and for alcohol, and must be able to show an
-- auditor that the selections were genuinely random — which is a statement
-- about evidence, not about a random number generator.

-- ── THE RATE IS A ROW, NOT A CONSTANT ───────────────────────────────────
--
-- §382.305(b) sets a MINIMUM annual percentage rate and the Administrator
-- ADJUSTS IT by notice in the Federal Register. It has moved between 25% and
-- 50% for drugs within living memory and it moved again for 2024. A constant
-- in the source would be correct until the morning it silently was not, and
-- the carrier would under-test for a year with nothing saying so.
--
-- SO A PERSON READS THE NOTICE AND ENTERS THE NUMBER, WITH THE CITATION. The
-- citation is NOT NULL on purpose: a rate with no notice behind it is a number
-- somebody remembered, and this is the row an auditor asks about first.
--
-- BASIS POINTS, like every other percentage in this schema. 50% is 5000.
-- Storing 0.5 would make the year-end arithmetic float arithmetic.
--
-- ORG-SCOPED THOUGH THE RATE IS FEDERAL. The number is the same for everybody;
-- what is per-tenant is WHICH NOTICE THIS CARRIER IS OPERATING UNDER and when
-- they recorded it. A shared table would have no tenant column, no policy, and
-- no answer to "who entered this".
CREATE TABLE "RandomTestingRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "drugRateBps" INTEGER NOT NULL,
    "alcoholRateBps" INTEGER NOT NULL,
    -- e.g. "89 FR 1234 (Jan 2024)". Printed on the year-end summary.
    "citation" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RandomTestingRate_pkey" PRIMARY KEY ("id")
);

-- One rate per year per tenant. Two rows for 2026 is two answers to a question
-- with one answer, and the one that got read would be whichever came back
-- first.
CREATE UNIQUE INDEX "RandomTestingRate_org_year"
  ON "RandomTestingRate"("organizationId", "year");

-- A rate outside 0–100% is a typo, and a typo here under-tests or over-tests a
-- whole fleet for a year.
ALTER TABLE "RandomTestingRate"
  ADD CONSTRAINT "RandomTestingRate_rates_are_percentages"
  CHECK ("drugRateBps" BETWEEN 0 AND 10000
     AND "alcoholRateBps" BETWEEN 0 AND 10000);

-- ── THE POOL, WHEN IT COMES FROM A CONSORTIUM ───────────────────────────
--
-- Membership is DERIVED from the roster by default — active drivers with a CDL
-- on file — and derived membership needs no table. A carrier in a consortium
-- or TPA is tested from the CONSORTIUM'S pool, which is a list that arrives
-- from outside and is entered as data.
--
-- `driverId` IS NULLABLE BECAUSE THE LIST IS NOT OURS. A consortium pool
-- contains drivers from other carriers; those lines have a name and no row in
-- this system, and inventing a Driver for them would put strangers on the
-- roster. The name is kept either way, because the draw records who was in the
-- pool and a driver who later leaves must not erase that.
CREATE TABLE "RandomPoolEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "driverId" TEXT,
    "name" TEXT NOT NULL,
    "consortiumName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RandomPoolEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RandomPoolEntry_companyId_year_idx"
  ON "RandomPoolEntry"("companyId", "year");
CREATE INDEX "RandomPoolEntry_organizationId_idx"
  ON "RandomPoolEntry"("organizationId");

-- ── THE DRAW, WHICH IS THE WHOLE AUDIT ──────────────────────────────────
--
-- "Random" to an auditor means "you cannot have chosen who got tested". A
-- selection nobody can re-derive is indistinguishable from a list somebody
-- typed, so three things are stored and the selection is a pure function of
-- them: the SEED, the ALGORITHM by name, and THE POOL AS IT STOOD.
--
-- `poolSnapshot` is the pool at the moment of the draw, in full. Not a count,
-- not a reference to a query that would return something different today — a
-- driver hired in July changes the derived pool, and a draw from April must
-- still recompute to the same names in December.
--
-- THE ALGORITHM IS NAMED AND VERSIONED so that changing it is a new name
-- rather than an old draw quietly becoming unverifiable. `sha256-rank-v1`
-- scores each member by SHA-256(seed:key) and takes the lowest — independent
-- of the order the snapshot is read in, which a seeded shuffle is not.
CREATE TABLE "RandomDraw" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "poolSnapshot" JSONB NOT NULL,
    "poolSize" INTEGER NOT NULL,
    "drawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drawnByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RandomDraw_pkey" PRIMARY KEY ("id")
);

-- One draw per quarter per authority per year. Drawing Q2 twice produces two
-- sets of names and a rate that can be read two ways.
CREATE UNIQUE INDEX "RandomDraw_company_year_quarter"
  ON "RandomDraw"("companyId", "year", "quarter");

ALTER TABLE "RandomDraw"
  ADD CONSTRAINT "RandomDraw_quarter_is_a_quarter"
  CHECK ("quarter" BETWEEN 1 AND 4);

-- A DRAW WITH NO SEED OR NO SNAPSHOT IS NOT A RECORDED DRAW. The application
-- always writes both; this is what stops anything else not doing so, and it is
-- the guard named "a draw not recorded".
ALTER TABLE "RandomDraw"
  ADD CONSTRAINT "RandomDraw_is_recomputable"
  CHECK (length("seed") > 0
     AND length("algorithm") > 0
     AND jsonb_array_length("poolSnapshot") = "poolSize"
     AND "poolSize" >= 0);

CREATE INDEX "RandomDraw_organizationId_idx" ON "RandomDraw"("organizationId");

-- ── ONE NAME OUT OF ONE DRAW ────────────────────────────────────────────
--
-- `memberKey` is what the draw actually selected, and it is what ties the row
-- back to the snapshot. `driverId` is a convenience for the screens and is
-- null for a consortium line belonging to another carrier.
--
-- NOT_TESTED NEEDS A REASON. §382.305(j)(3) allows a selected driver to be
-- excused — on leave, no longer employed — but the carrier has to say why for
-- each one. "Not tested" with no reason is the line an auditor stops on, so
-- the database refuses it rather than a form being the only thing that asks.
CREATE TABLE "RandomSelection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "memberKey" TEXT NOT NULL,
    "driverId" TEXT,
    "name" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "testedAt" TIMESTAMP(3),
    -- The DRUG_TEST compliance item a completed test produced, where it did.
    "complianceItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RandomSelection_pkey" PRIMARY KEY ("id")
);

-- Drawn once per kind per draw. Testing the same driver twice in one quarter
-- meets no part of §382.305.
CREATE UNIQUE INDEX "RandomSelection_draw_kind_member"
  ON "RandomSelection"("drawId", "kind", "memberKey");

ALTER TABLE "RandomSelection"
  ADD CONSTRAINT "RandomSelection_not_tested_needs_reason"
  CHECK ("outcome" <> 'NOT_TESTED' OR ("reason" IS NOT NULL AND length("reason") > 0));

CREATE INDEX "RandomSelection_drawId_idx" ON "RandomSelection"("drawId");
CREATE INDEX "RandomSelection_driverId_idx" ON "RandomSelection"("driverId");
CREATE INDEX "RandomSelection_organizationId_idx"
  ON "RandomSelection"("organizationId");

-- ── FOREIGN KEYS ────────────────────────────────────────────────────────

ALTER TABLE "RandomTestingRate" ADD CONSTRAINT "RandomTestingRate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RandomPoolEntry" ADD CONSTRAINT "RandomPoolEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RandomPoolEntry" ADD CONSTRAINT "RandomPoolEntry_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RandomPoolEntry" ADD CONSTRAINT "RandomPoolEntry_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RandomDraw" ADD CONSTRAINT "RandomDraw_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RandomDraw" ADD CONSTRAINT "RandomDraw_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RandomDraw" ADD CONSTRAINT "RandomDraw_drawnByUserId_fkey"
  FOREIGN KEY ("drawnByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CASCADE FROM THE DRAW, and this is the one cascade worth arguing about: a
-- draw is never deleted by the application, and if one ever were, selections
-- that outlived it would be names nobody can explain.
ALTER TABLE "RandomSelection" ADD CONSTRAINT "RandomSelection_drawId_fkey"
  FOREIGN KEY ("drawId") REFERENCES "RandomDraw"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RandomSelection" ADD CONSTRAINT "RandomSelection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RandomSelection" ADD CONSTRAINT "RandomSelection_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RandomSelection" ADD CONSTRAINT "RandomSelection_complianceItemId_fkey"
  FOREIGN KEY ("complianceItemId") REFERENCES "ComplianceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── TENANT ISOLATION ────────────────────────────────────────────────────
--
-- FORCE on all four, and a fixture row for each in the same commit — a policy
-- over an empty table proves nothing, which is what `tests/isolation-coverage.
-- test.ts` exists to say out loud.
ALTER TABLE "RandomTestingRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RandomTestingRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "RandomTestingRate"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RandomPoolEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RandomPoolEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "RandomPoolEntry"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RandomDraw" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RandomDraw" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "RandomDraw"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RandomSelection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RandomSelection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "RandomSelection"
  USING ("organizationId" = current_setting('app.current_org_id', true));
