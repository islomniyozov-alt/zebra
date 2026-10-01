-- MIGRATION 61 — the bundle, 2026-10-01.
--
-- Five changes that each waited for a deploy ritual rather than taking one of
-- their own, plus the fuel and toll charge side they unblock:
--
--   1. Payment.isAdjustment            (ruled 2026-09-28)
--   2. RandomSelection.complianceItemId dropped (ruled 2026-09-28)
--   3. StandingCharge + StandingChargeExemption (ruled 2026-09-30, §6.2.4)
--   4. SettlementLoadLine.referenceNumber frozen (ruled 2026-09-30)
--   5. Fuel and toll charge side + DEDUCTION_TOLL (§6.2.3)
--
-- ── WRITTEN BY HAND, AND THAT IS DELIBERATE ────────────────────────────────
--
-- `prisma migrate diff` against dev produced these statements AND a dozen that
-- belong to nobody: six `organizationId` FOREIGN KEYS dropped, three indexes
-- dropped (`Settlement_batchId_idx` among them), and `teamWith`/`referralWith`
-- losing their defaults. That is PRE-EXISTING DRIFT between dev's live schema
-- and schema.prisma, not part of this change, and shipping it would quietly
-- remove tenancy constraints as a side effect of adding a boolean.
--
-- So this file contains only what was ruled. The drift is reported separately
-- and fixed, if it should be, by a migration that says it is doing that.

-- 1 ── Payment.isAdjustment -------------------------------------------------
-- Replaces ADJUSTMENT_NOTE_PREFIX matched against `notes`. Existing rows keep
-- their prefix and the reader still accepts it: a payment booked last month
-- does not get a flag retroactively from a migration.
ALTER TABLE "Payment" ADD COLUMN "isAdjustment" BOOLEAN NOT NULL DEFAULT false;

-- 2 ── RandomSelection.complianceItemId, dropped ----------------------------
-- A random test writes no ComplianceItem; the outcome is an event on the row.
-- Null in every environment, read and written by nothing.
ALTER TABLE "RandomSelection" DROP CONSTRAINT IF EXISTS "RandomSelection_complianceItemId_fkey";
ALTER TABLE "RandomSelection" DROP COLUMN "complianceItemId";

-- 3 ── Standing charges -----------------------------------------------------
CREATE TABLE "StandingCharge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "cadence" "DeductionCadence" NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'ALL',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandingCharge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StandingChargeExemption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "standingChargeId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandingChargeExemption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StandingCharge_organizationId_effectiveFrom_idx" ON "StandingCharge"("organizationId", "effectiveFrom");
CREATE UNIQUE INDEX "StandingChargeExemption_standingChargeId_driverId_key" ON "StandingChargeExemption"("standingChargeId", "driverId");
CREATE INDEX "StandingChargeExemption_organizationId_idx" ON "StandingChargeExemption"("organizationId");

ALTER TABLE "StandingCharge" ADD CONSTRAINT "StandingCharge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StandingChargeExemption" ADD CONSTRAINT "StandingChargeExemption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StandingChargeExemption" ADD CONSTRAINT "StandingChargeExemption_standingChargeId_fkey" FOREIGN KEY ("standingChargeId") REFERENCES "StandingCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StandingChargeExemption" ADD CONSTRAINT "StandingChargeExemption_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4 ── SettlementLoadLine.referenceNumber, frozen ---------------------------
-- The statement's Load number column printed this READ LIVE through Load from
-- 2026-09-30, which meant a broker reference corrected next year would change
-- what an issued statement printed. Nullable: a load can carry no reference,
-- and every row written before today has none.
ALTER TABLE "SettlementLoadLine" ADD COLUMN "referenceNumber" TEXT;

-- 5 ── The fuel and toll charge side ----------------------------------------
-- Retail and invoice are two amounts on one gallon of diesel — $339.92 at the
-- pump, $284.43 on the card invoice — and which one a driver is charged is a
-- policy on the authority, frozen onto the statement so a later switch cannot
-- restate what somebody was paid.
ALTER TABLE "FuelTransaction"
  ADD COLUMN "invoiceCents" INTEGER,
  ADD COLUMN "feesCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "product" TEXT,
  ADD COLUMN "isBillable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "settlementId" TEXT;

CREATE TABLE "TollTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "truckId" TEXT,
    "driverId" TEXT,
    "vendorName" TEXT,
    "state" TEXT,
    "totalCents" INTEGER NOT NULL,
    "invoiceCents" INTEGER,
    "feesCents" INTEGER NOT NULL DEFAULT 0,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "settlementId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TollTransaction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Document" ADD COLUMN "tollTransactionId" TEXT;

ALTER TABLE "CompanySettings"
  ADD COLUMN "showFuelOnStatement" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deductFuel" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "showTollsOnStatement" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deductTolls" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fuelMode" TEXT NOT NULL DEFAULT 'RETAIL';

ALTER TABLE "Settlement" ADD COLUMN "fuelMode" TEXT;

CREATE INDEX "FuelTransaction_driverId_settlementId_idx" ON "FuelTransaction"("driverId", "settlementId");
CREATE INDEX "TollTransaction_companyId_incurredAt_idx" ON "TollTransaction"("companyId", "incurredAt");
CREATE INDEX "TollTransaction_driverId_settlementId_idx" ON "TollTransaction"("driverId", "settlementId");
CREATE INDEX "TollTransaction_organizationId_idx" ON "TollTransaction"("organizationId");

ALTER TABLE "FuelTransaction" ADD CONSTRAINT "FuelTransaction_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_tollTransactionId_fkey" FOREIGN KEY ("tollTransactionId") REFERENCES "TollTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TollTransaction" ADD CONSTRAINT "TollTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TollTransaction" ADD CONSTRAINT "TollTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TollTransaction" ADD CONSTRAINT "TollTransaction_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TollTransaction" ADD CONSTRAINT "TollTransaction_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TollTransaction" ADD CONSTRAINT "TollTransaction_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── ROW-LEVEL SECURITY ON EVERY NEW TENANT TABLE ───────────────────────────
--
-- Three new tables carry organizationId, so three get the policy. FORCE as
-- well as ENABLE, because the table owner bypasses RLS otherwise and the
-- application connects as a role that would then see everything.
--
-- A POLICY IS NOT PROOF: tests/isolation-coverage.test.ts fails by name for
-- any tenant model the integration fixture never seeds, which is why all
-- three get a fixture row in this same commit.
ALTER TABLE "StandingCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StandingCharge" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "StandingCharge"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "StandingChargeExemption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StandingChargeExemption" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "StandingChargeExemption"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "TollTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TollTransaction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "TollTransaction"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ── THE ENUM VALUE, LAST ───────────────────────────────────────────────────
--
-- Postgres will not let a new enum value be USED in the same transaction that
-- adds it. Nothing below uses it, and the application only starts writing
-- DEDUCTION_TOLL after this migration has committed.
ALTER TYPE "SettlementLineType" ADD VALUE 'DEDUCTION_TOLL';
