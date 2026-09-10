-- What a driver had earned before Zebra was the book of record.
--
-- Zebra's revenue starts at the books cutover, so pre-cutover Amazon money
-- never becomes a Payment here. That breaks YTD and nothing else, and the fix
-- is a stated balance rather than a back-import: a balance adds to a query and
-- claims nothing about what this system processed.
--
-- Stated and dated, never derived. `source` names the statement each figure
-- was read off, because a number nobody can recompute has to be checkable
-- against the paper it came from.

CREATE TYPE "OpeningBalanceCategory" AS ENUM (
  'EARNINGS',
  'ADVANCES',
  'REIMBURSEMENTS',
  'DEDUCTIONS',
  'OTHER_PAY',
  'NET_PAY'
);

CREATE TABLE "DriverOpeningBalance" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "driverId"       TEXT NOT NULL,
  "year"           INTEGER NOT NULL,
  "category"       "OpeningBalanceCategory" NOT NULL,
  "amountCents"    INTEGER NOT NULL,
  "asOf"           TIMESTAMP(3) NOT NULL,
  "source"         TEXT NOT NULL,
  "enteredById"    TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DriverOpeningBalance_pkey" PRIMARY KEY ("id")
);

-- ONE FIGURE PER DRIVER PER YEAR PER CATEGORY. Two rows for the same three
-- would be two answers to one question and nothing downstream could choose.
CREATE UNIQUE INDEX "DriverOpeningBalance_driverId_year_category_key"
  ON "DriverOpeningBalance"("driverId", "year", "category");

CREATE INDEX "DriverOpeningBalance_organizationId_year_idx"
  ON "DriverOpeningBalance"("organizationId", "year");
CREATE INDEX "DriverOpeningBalance_driverId_year_idx"
  ON "DriverOpeningBalance"("driverId", "year");

ALTER TABLE "DriverOpeningBalance"
  ADD CONSTRAINT "DriverOpeningBalance_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverOpeningBalance"
  ADD CONSTRAINT "DriverOpeningBalance_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverOpeningBalance"
  ADD CONSTRAINT "DriverOpeningBalance_enteredById_fkey"
  FOREIGN KEY ("enteredById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security, the same shape every tenant table carries: ENABLE puts
-- the policy on, FORCE applies it to the table owner too.
ALTER TABLE "DriverOpeningBalance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriverOpeningBalance" FORCE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON "DriverOpeningBalance"
  USING ("organizationId" = current_setting('app.organization_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "DriverOpeningBalance" TO zebra_app;
