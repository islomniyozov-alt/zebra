-- THE TWO THINGS A YEAR OF DATATRUCK FREIGHT NEEDS BEFORE IT CAN LAND.
--
-- ── 1. THE IDEMPOTENCY KEY ────────────────────────────────────────────────
--
-- `Shipment ID` — `DT-016082` — is unique across all 14,451 rows of the
-- export, blank on none of them, and is the only column that is. `Load ID`
-- looks like a key and is not: it is the customer's own reference, typed by a
-- human, and it repeats (`last settlement` fourteen times) and is blank on 7.
-- Keying on it would merge 26 loads and drop 7.
--
-- ADDITIVE AND NULLABLE, exactly like `Driver.externalId` before it. Every
-- existing row gets NULL, which is correct: the live Relay loads were not
-- migrated from anywhere.
ALTER TABLE "Load" ADD COLUMN "externalId" TEXT;

-- UNIQUE PER ORGANIZATION, NOT PER COMPANY. A load belongs to one authority,
-- but the Datatruck id space is one space across all five of them, and two
-- authorities must never both claim `DT-016082`. NULLs are distinct to
-- Postgres, so any number of loads may carry none — which is the common case
-- from here on, since this is a migration key and not something the interface
-- ever asks anybody for.
CREATE UNIQUE INDEX "Load_organizationId_externalId_key"
  ON "Load"("organizationId", "externalId");

-- ── 2. A BILLING STATE FOR FREIGHT THIS SYSTEM WILL NEVER BILL ────────────
--
-- 14,345 of the imported loads were delivered, invoiced or paid in Datatruck.
-- None of that happened in Zebra: there are no Invoice rows, no Payment rows
-- and no PaymentLoadApplication rows behind them, and inventing 588 invoices
-- and 2,299 payments with numbers and dates nobody has would be fabricating
-- an AR history.
--
-- WHY NOT JUST WRITE `PAID`. `Load.billingStatus` is a STORED column whose
-- value is owned by `billingStatusFor` — a pure rule over facts — and
-- `npm run check:drift` runs `findBillingStatusDrift` against production. With
-- no invoice and no payment behind them, the rule computes `UNINVOICED` for
-- every one of these loads, so a hand-written `PAID` would be 14,345 drift
-- rows on the very next check.
--
-- WHY NOT `UNINVOICED` EITHER, WHICH THE RULE WOULD AGREE WITH TODAY. Because
-- of what is already planned: a job will pull every Datatruck POD into R2. The
-- moment those documents land, `isReady` turns true for delivered freight that
-- has a rate, a truck and a driver — and the same drift check would reclassify
-- a year of settled freight as READY_TO_INVOICE. A queue of 14,345 loads to
-- invoice a second time, discovered by a checker rather than by a person.
--
-- SO IT JOINS `DECIDED`, the set `billingStatusFor` does not own. DISPUTED and
-- WRITTEN_OFF are there because they are decisions somebody made rather than
-- arithmetic; this is the same kind of fact — the billing happened in another
-- system and Zebra will not act on it. The writer skips it and the drift check
-- skips it, so the POD import cannot move it and no recomputation can either.
--
-- WHY NOT REUSE `WRITTEN_OFF`, which would need no migration: it means bad
-- debt. $17.2M of freight that was actually collected would read as written
-- off on every screen and in any revenue figure that trusts the column.
--
-- `ADD VALUE` OUTSIDE A TRANSACTION IS NOT NEEDED HERE. Postgres 12+ permits
-- it inside one provided the new value is not USED before commit, and nothing
-- in this migration uses it — the seed does, later, in its own connection.
ALTER TYPE "LoadBillingStatus" ADD VALUE 'CLOSED_IN_DATATRUCK';

-- NO GRANT AND NO POLICY NEEDED: a column and an index on a table that already
-- carries its grants and its org_isolation policy from 20260728224443_init.
