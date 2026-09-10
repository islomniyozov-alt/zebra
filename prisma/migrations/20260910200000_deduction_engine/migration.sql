-- Standing deductions, one-off charges, and the escrow ledger.
--
-- `type` is TEXT, not an enum, and that is the ruling rather than a shortcut:
-- Datatruck prints a label with `Other` as the escape hatch, so adding a kind
-- of charge is typing a description, never a migration.

CREATE TYPE "DeductionCadence" AS ENUM ('WEEKLY', 'MONTHLY_SPLIT_WEEKLY');

CREATE TABLE "RecurringDeduction" (
  "id"                TEXT NOT NULL,
  "driverId"          TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "type"              TEXT NOT NULL,
  "description"       TEXT,
  "amountCents"       INTEGER NOT NULL,
  "cadence"           "DeductionCadence" NOT NULL,
  "monthlyTotalCents" INTEGER,
  "targetCents"       INTEGER,
  "effectiveFrom"     TIMESTAMP(3) NOT NULL,
  "effectiveTo"       TIMESTAMP(3),
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringDeduction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SettlementCharge" (
  "id"             TEXT NOT NULL,
  "driverId"       TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "description"    TEXT NOT NULL,
  "amountCents"    INTEGER NOT NULL,
  "loadId"         TEXT,
  "appliesOn"      TIMESTAMP(3) NOT NULL,
  "settledAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementCharge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverEscrowEntry" (
  "id"             TEXT NOT NULL,
  "driverId"       TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "amountCents"    INTEGER NOT NULL,
  "settlementId"   TEXT,
  "occurredAt"     TIMESTAMP(3) NOT NULL,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverEscrowEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecurringDeduction_driverId_effectiveFrom_idx"
  ON "RecurringDeduction"("driverId", "effectiveFrom");
CREATE INDEX "RecurringDeduction_organizationId_idx"
  ON "RecurringDeduction"("organizationId");
CREATE INDEX "SettlementCharge_driverId_appliesOn_idx"
  ON "SettlementCharge"("driverId", "appliesOn");
CREATE INDEX "SettlementCharge_loadId_idx" ON "SettlementCharge"("loadId");
CREATE INDEX "SettlementCharge_organizationId_idx"
  ON "SettlementCharge"("organizationId");
CREATE INDEX "DriverEscrowEntry_driverId_occurredAt_idx"
  ON "DriverEscrowEntry"("driverId", "occurredAt");
CREATE INDEX "DriverEscrowEntry_organizationId_idx"
  ON "DriverEscrowEntry"("organizationId");

ALTER TABLE "RecurringDeduction" ADD CONSTRAINT "RecurringDeduction_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringDeduction" ADD CONSTRAINT "RecurringDeduction_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SettlementCharge" ADD CONSTRAINT "SettlementCharge_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementCharge" ADD CONSTRAINT "SettlementCharge_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementCharge" ADD CONSTRAINT "SettlementCharge_loadId_fkey"
  FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DriverEscrowEntry" ADD CONSTRAINT "DriverEscrowEntry_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverEscrowEntry" ADD CONSTRAINT "DriverEscrowEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, the shape every tenant table carries.
ALTER TABLE "RecurringDeduction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringDeduction" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "RecurringDeduction"
  USING ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "SettlementCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SettlementCharge" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "SettlementCharge"
  USING ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "DriverEscrowEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriverEscrowEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "DriverEscrowEntry"
  USING ("organizationId" = current_setting('app.organization_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "RecurringDeduction" TO zebra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "SettlementCharge" TO zebra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "DriverEscrowEntry" TO zebra_app;
