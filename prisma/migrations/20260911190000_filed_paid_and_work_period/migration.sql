-- Two questions the schema could not answer, and one migration for both.
--
-- ── WHEN WAS THIS FILED, AND WHEN WAS IT PAID ────────────────────────────
--
-- Filing a packet wrote `billingStatus` and recorded no timestamp, so the money
-- screen answered "the oldest unpaid filing" with `updatedAt` — right on the
-- day a load is filed, and wrong every time anything else touches the row. A
-- packet filed a fortnight ago looked filed this morning because somebody
-- corrected a city name. A status cannot answer a question about age.
--
-- ── WHICH WEEK DOES THIS REMITTANCE COVER ────────────────────────────────
--
-- `Payment` carried `receivedAt` and nothing saying which work period the money
-- was FOR, so the screen asked the question sideways: find a payment whose
-- applications land on loads delivered in the period. That is a real
-- relationship and never returns a wrong answer, but it cannot see a remittance
-- that paid nothing in the period, and it costs a join through two tables.
--
-- Amazon prints the period in the Payment Summary — "Aug 30 - Sep 5, 2026" —
-- and `parseWorkPeriod` turns it into these two days, refusing anything that is
-- not a Sunday-to-Saturday week. The application lookup stays as the fallback
-- for every payment entered by hand and every label this cannot read.
--
-- ADDITIVE AND NULLABLE THROUGHOUT. No column is dropped, no row is rewritten,
-- and on Postgres 11+ a nullable column on `Load`'s fourteen thousand rows is
-- a catalogue change rather than a table rewrite. Existing rows carry NULL,
-- which is the honest value: nobody recorded these facts at the time, and
-- backfilling them from `updatedAt` would manufacture a history.

ALTER TABLE "Load"
  ADD COLUMN "filedAt" TIMESTAMP(3),
  ADD COLUMN "paidAt"  TIMESTAMP(3);

ALTER TABLE "Payment"
  ADD COLUMN "periodStart" TIMESTAMP(3),
  ADD COLUMN "periodEnd"   TIMESTAMP(3);

-- The money screen asks "which remittance covers this period" on every open.
CREATE INDEX "Payment_companyId_periodStart_idx"
  ON "Payment"("companyId", "periodStart");

-- No policy or grant: both tables already carry theirs.
