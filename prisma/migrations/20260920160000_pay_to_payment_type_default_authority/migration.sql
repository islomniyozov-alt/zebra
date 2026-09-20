-- ITEM 10: PAY TO, PAYMENT TYPE, DEFAULT AUTHORITY.

-- ── 1. WHO THE CHEQUE IS MADE OUT TO ─────────────────────────────────────
--
-- An owner-operator drives for us and invoices through their own LLC.
-- Datatruck's driver export carries a `Pay to` column for exactly this —
-- present in drivers_2026_09_07 and EMPTY in all 54 rows, so the importer has
-- somewhere to put it and nothing yet to bring.
ALTER TABLE "Driver" ADD COLUMN "payToName" TEXT;
ALTER TABLE "Driver" ADD COLUMN "payToAddress" TEXT;

-- ── 2. AND FROZEN ONTO THE STATEMENT ─────────────────────────────────────
--
-- Like `unitNumber`, and for the same reason: a statement is a document
-- somebody was paid on. Reading the driver's payee back at render time would
-- let an owner-operator who changed LLC in November restate every statement
-- they were paid on in March.
ALTER TABLE "Settlement" ADD COLUMN "payToName" TEXT;
ALTER TABLE "Settlement" ADD COLUMN "payToAddress" TEXT;

-- ── 3. THE ARRANGEMENT A LOAD WAS BOOKED UNDER ───────────────────────────
--
-- Not the instrument: `PaymentMethod` is how money physically moves, and the
-- two overlap on ACH without meaning the same thing.
CREATE TYPE "LoadPaymentType" AS ENUM ('QUICKPAY', 'FACTORED', 'ACH', 'DIRECT');

ALTER TABLE "Load" ADD COLUMN "paymentType" "LoadPaymentType";
ALTER TABLE "Customer" ADD COLUMN "defaultPaymentType" "LoadPaymentType";

-- ── 4. THE ONE AUTHORITY A NEW LOAD LANDS ON ─────────────────────────────
--
-- Create Load defaulted to the first authority alphabetically, which is how a
-- draft opened from an inbound email got booked under whichever carrier
-- happened to sort first.
ALTER TABLE "Company" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AT MOST ONE PER ORGANIZATION, SAID BY THE DATABASE. A partial unique index
-- rather than application code: "exactly one default" is the kind of rule
-- that survives every code path only if nothing can write the second row.
--
-- At LEAST one is not something an index can promise — a fresh organization
-- has none until somebody picks one — so the form falls back to
-- first-alphabetical, which is the behaviour this replaces rather than a new
-- hole.
CREATE UNIQUE INDEX "Company_one_default_per_org"
  ON "Company" ("organizationId")
  WHERE "isDefault";
