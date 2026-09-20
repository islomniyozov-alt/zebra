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
-- TEXT, NOT A POSTGRES ENUM, and not a CHECK constraint either. Owner's
-- ruling, and the same reasoning as the deduction type: the vocabulary lives
-- in `src/lib/payment-types.ts`, so adding a fifth arrangement is an edit to a
-- list somebody can read — never a migration, never a deploy, never a
-- conversation about downtime.
--
-- The first draft of this migration created `LoadPaymentType` as an enum. It
-- was changed here rather than corrected in a later migration because nothing
-- had read it yet and production had never seen it; a fix stacked on top would
-- have left the enum in production's history for no reason.
--
-- Validation is the writer's job and happens against that list.
ALTER TABLE "Load" ADD COLUMN "paymentType" TEXT;
ALTER TABLE "Customer" ADD COLUMN "defaultPaymentType" TEXT;

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
