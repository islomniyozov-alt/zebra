-- MONEY-DESIGN item 3 — batch settle, one company's Sunday-to-Saturday week.
--
-- SAFE TO RESHAPE, AND THAT WAS ASKED RATHER THAN ASSUMED. `Settlement` and
-- `SettlementLine` have existed since Phase 3 with a screen and a PDF route
-- behind them. `scripts/inspect-settlement-rows.mjs` asked production on
-- 2026-09-11: ZERO settlements, ZERO lines. Nobody has been paid through Zebra,
-- so nothing here rewrites money somebody received. Everything below is additive
-- regardless — no column is dropped and no row is touched.

CREATE TYPE "SettlementBatchStatus" AS ENUM ('DRAFT', 'FINAL', 'PAID');

CREATE TABLE "SettlementBatch" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "periodStart"       TIMESTAMP(3) NOT NULL,
  "periodEnd"         TIMESTAMP(3) NOT NULL,
  "statementDate"     TIMESTAMP(3) NOT NULL,
  "checkDate"         TIMESTAMP(3) NOT NULL,
  "status"            "SettlementBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "batchNumber"       TEXT,
  "finalizedAt"       TIMESTAMP(3),
  "finalizedByUserId" TEXT,
  "paidAt"            TIMESTAMP(3),
  "paidByUserId"      TEXT,
  "notes"             TEXT,
  "deletedAt"         TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SettlementBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SettlementLoadLine" (
  "id"              TEXT NOT NULL,
  "settlementId"    TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "loadId"          TEXT NOT NULL,
  "loadNumber"      TEXT NOT NULL,
  "puPlace"         TEXT NOT NULL,
  "delPlace"        TEXT NOT NULL,
  "puDate"          TIMESTAMP(3) NOT NULL,
  "delDate"         TIMESTAMP(3) NOT NULL,
  "grossCents"      INTEGER NOT NULL,
  "milesHundredths" INTEGER NOT NULL,
  "amountCents"     INTEGER NOT NULL,
  "settledBasis"    TEXT NOT NULL,
  "payRuleSnapshot" JSONB,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementLoadLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SettlementDeductionLine" (
  "id"                   TEXT NOT NULL,
  "settlementId"         TEXT NOT NULL,
  "organizationId"       TEXT NOT NULL,
  "type"                 TEXT NOT NULL,
  "description"          TEXT NOT NULL,
  "quantity"             INTEGER NOT NULL DEFAULT 1,
  "rateCents"            INTEGER NOT NULL,
  "totalCents"           INTEGER NOT NULL,
  "recurringDeductionId" TEXT,
  "settlementChargeId"   TEXT,
  "sortOrder"            INTEGER NOT NULL DEFAULT 0,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementDeductionLine_pkey" PRIMARY KEY ("id")
);

-- The batch flow's columns on the existing per-driver settlement. All
-- nullable or defaulted: the Phase 3 flow keeps working with `batchId` null.
ALTER TABLE "Settlement"
  ADD COLUMN "batchId"         TEXT,
  ADD COLUMN "unitNumber"      TEXT,
  ADD COLUMN "payTariffLabel"  TEXT,
  ADD COLUMN "payRuleSnapshot" JSONB,
  ADD COLUMN "payoutDate"      TIMESTAMP(3),
  ADD COLUMN "earningsCents"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "advancesCents"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "otherPayCents"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "milesHundredths" INTEGER NOT NULL DEFAULT 0;

-- The driver's payout lag. Zero for everybody until somebody states otherwise.
ALTER TABLE "Driver" ADD COLUMN "payoutLagWeeks" INTEGER NOT NULL DEFAULT 0;

-- ONE SB-/ST- SERIES ACROSS BOTH CARRIERS, so this is unique on the
-- organization and not the company. Read off the artefact: SB-000436 RAM,
-- 437 Dolphins, 438 RAM, 439 Dolphins, 440 RAM — one ascending, interleaved run.
CREATE UNIQUE INDEX "SettlementBatch_organizationId_batchNumber_key"
  ON "SettlementBatch"("organizationId", "batchNumber");
CREATE INDEX "SettlementBatch_companyId_periodStart_idx"
  ON "SettlementBatch"("companyId", "periodStart");
CREATE INDEX "SettlementBatch_organizationId_status_idx"
  ON "SettlementBatch"("organizationId", "status");

-- A LOAD SETTLES ONCE, and the database is what refuses the second one. Code
-- that remembers to check is code that can forget; a driver paid twice for one
-- load is money out of the door that reconciles against nothing.
CREATE UNIQUE INDEX "SettlementLoadLine_loadId_key"
  ON "SettlementLoadLine"("loadId");
CREATE INDEX "SettlementLoadLine_settlementId_idx"
  ON "SettlementLoadLine"("settlementId");
CREATE INDEX "SettlementLoadLine_organizationId_idx"
  ON "SettlementLoadLine"("organizationId");
CREATE INDEX "SettlementDeductionLine_settlementId_idx"
  ON "SettlementDeductionLine"("settlementId");
CREATE INDEX "SettlementDeductionLine_organizationId_idx"
  ON "SettlementDeductionLine"("organizationId");
CREATE INDEX "Settlement_batchId_idx" ON "Settlement"("batchId");

ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_finalizedByUserId_fkey"
  FOREIGN KEY ("finalizedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_paidByUserId_fkey"
  FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "SettlementBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SettlementLoadLine" ADD CONSTRAINT "SettlementLoadLine_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementLoadLine" ADD CONSTRAINT "SettlementLoadLine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementLoadLine" ADD CONSTRAINT "SettlementLoadLine_loadId_fkey"
  FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementDeductionLine" ADD CONSTRAINT "SettlementDeductionLine_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementDeductionLine" ADD CONSTRAINT "SettlementDeductionLine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security. `app.current_org_id` is the name `withOrg` sets — the
-- deduction-engine migration used `app.organization_id`, a name NOTHING sets,
-- and every policy written against it denied every row including the tenant's
-- own. `tests/structure.test.ts` now fails by table name for exactly this.
ALTER TABLE "SettlementBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SettlementBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "SettlementBatch"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SettlementLoadLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SettlementLoadLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "SettlementLoadLine"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SettlementDeductionLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SettlementDeductionLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "SettlementDeductionLine"
  USING ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "SettlementBatch" TO zebra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "SettlementLoadLine" TO zebra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "SettlementDeductionLine" TO zebra_app;
