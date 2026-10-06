-- MIGRATION 65 — THE FIVE FOREIGN KEYS GO BACK TO CASCADE, AND THE SCHEMA SAYS SO
--
-- Migration 63 moved five organizationId foreign keys from CASCADE to RESTRICT,
-- on the reading that the schema (which named no `onDelete`) was deliberate and
-- the database was wrong. It was the other way round, and this is the grep that
-- would have shown it — written here BEFORE the apply this time, which is the
-- order the 2026-10-06 rule requires:
--
--   $ grep -E "organization +Organization +@relation" prisma/schema.prisma | grep -c "onDelete: Cascade"
--   49
--   $ grep -E "organization +Organization +@relation" prisma/schema.prisma | grep -vc "onDelete"
--   5
--     SettlementLoadLine · SettlementDeductionLine · RecurringDeduction ·
--     SettlementCharge · DriverEscrowEntry
--
-- Forty-nine to five. The five were the outliers in their own schema, not a
-- policy, and the database carried the convention the other forty-nine declare.
--
-- AND THE WRITERS RESTRICT REFUSES:
--
--   $ grep -rn "organization\.delete" src scripts tests --include=*.ts --include=*.tsx --include=*.mjs | grep -v src/generated
--   tests/integration/audit-trail.test.ts:86      (teardown)
--   tests/integration/audit.test.ts:513           (teardown)
--   tests/integration/counters.test.ts:65         (teardown)
--   tests/integration/documents.test.ts:112       (teardown)
--   tests/integration/facility-memory.test.ts:72  (teardown)
--   tests/integration/fixtures.ts:940             (the isolation fixture's teardown)
--   tests/integration/fleet.test.ts:305           (teardown)
--   tests/integration/load-warnings.test.ts:294   (teardown)
--
-- No production code deletes an Organization. What RESTRICT broke was
-- `tests/integration/isolation.test.ts` — "an organization can be removed ·
-- cascades through every child table without a trigger objecting" — a regression
-- test from 2026-07-28 whose comment ends "nothing can ever be deleted". That
-- guarantee was written down and tested; 63 overrode it on a reading of five
-- missing words.
--
-- The first integration run against 63 failed that test at t+127s. Nothing
-- reached dev or production from that chain.

ALTER TABLE "SettlementLoadLine" DROP CONSTRAINT "SettlementLoadLine_organizationId_fkey";
ALTER TABLE "SettlementDeductionLine" DROP CONSTRAINT "SettlementDeductionLine_organizationId_fkey";
ALTER TABLE "RecurringDeduction" DROP CONSTRAINT "RecurringDeduction_organizationId_fkey";
ALTER TABLE "SettlementCharge" DROP CONSTRAINT "SettlementCharge_organizationId_fkey";
ALTER TABLE "DriverEscrowEntry" DROP CONSTRAINT "DriverEscrowEntry_organizationId_fkey";

ALTER TABLE "SettlementLoadLine" ADD CONSTRAINT "SettlementLoadLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementDeductionLine" ADD CONSTRAINT "SettlementDeductionLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringDeduction" ADD CONSTRAINT "RecurringDeduction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementCharge" ADD CONSTRAINT "SettlementCharge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverEscrowEntry" ADD CONSTRAINT "DriverEscrowEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
