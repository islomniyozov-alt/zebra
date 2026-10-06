-- MIGRATION 63 — THE SCHEMA DRIFT, RULED ITEM BY ITEM
--
-- `migrate dev --create-only` produced eleven changes alongside migration 62's
-- payroll work, every one of them pre-existing drift between the committed schema
-- and the dev database. The owner's ruling, 2026-10-05, was NOT "accept what
-- migrate dev proposes": each item was ruled on individually, and this file is
-- those rulings as SQL. Rehearsed on dev with a row count on every table it
-- touches, before and after — the two readings are in the commit.
--
-- ── RULED: KEEP, BY FIXING THE SCHEMA ──────────────────────────────────────
--
-- `Settlement_batchId_idx` and `SettlementLoadLine_companyId_idx` are indexes
-- the batches screen reads. The database has carried them all along; the schema
-- never declared them, so the generator proposed dropping them. The fix is two
-- `@@index` lines in `schema.prisma`, not a change here — which is why neither
-- appears below and the regenerated drift no longer mentions them.
--
-- ── RULED: ACCEPT ──────────────────────────────────────────────────────────
--
-- 1. CASCADE → RESTRICT on five organizationId foreign keys. Deleting an
--    Organization that still has settlement lines, deduction lines, recurring
--    deductions, charges or escrow entries now FAILS rather than silently taking
--    the money history with it. The schema has said RESTRICT (by omitting
--    `onDelete`) for as long as these models have existed; the database said
--    CASCADE. The schema was right.
-- 2. The empty-array defaults on `Settlement.teamWith` and `referralWith` go.
--    The application has always written both columns explicitly, frozen beside
--    the unit number; a default that nothing relies on is a default that hides
--    the day something stops writing the column.
-- 3. Three uniques take the names prisma would have given them. Names only.
--
-- ── NOT RULED, AND NAMED SO IT IS NOT SMUGGLED ─────────────────────────────
--
-- `Accident_companyId_occurredAt_idx` is dropped and re-created with the same
-- name and the same two columns. Prisma does this when it cannot prove the
-- existing index matches its definition; the table holds no rows on dev and the
-- index is equivalent either side. Included because leaving it out would leave
-- `migrate dev` proposing it forever, and that is how an eleven-item drift
-- accumulated in the first place.

-- ── 1. THE FIVE FOREIGN KEYS, CASCADE → RESTRICT ───────────────────────────
ALTER TABLE "DriverEscrowEntry" DROP CONSTRAINT "DriverEscrowEntry_organizationId_fkey";
ALTER TABLE "RecurringDeduction" DROP CONSTRAINT "RecurringDeduction_organizationId_fkey";
ALTER TABLE "SettlementCharge" DROP CONSTRAINT "SettlementCharge_organizationId_fkey";
ALTER TABLE "SettlementDeductionLine" DROP CONSTRAINT "SettlementDeductionLine_organizationId_fkey";
ALTER TABLE "SettlementLoadLine" DROP CONSTRAINT "SettlementLoadLine_organizationId_fkey";

ALTER TABLE "SettlementLoadLine" ADD CONSTRAINT "SettlementLoadLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementDeductionLine" ADD CONSTRAINT "SettlementDeductionLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringDeduction" ADD CONSTRAINT "RecurringDeduction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCharge" ADD CONSTRAINT "SettlementCharge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverEscrowEntry" ADD CONSTRAINT "DriverEscrowEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2. THE TWO DEFAULTS ────────────────────────────────────────────────────
ALTER TABLE "Settlement" ALTER COLUMN "teamWith" DROP DEFAULT,
ALTER COLUMN "referralWith" DROP DEFAULT;

-- ── 3. THE THREE NAMES ─────────────────────────────────────────────────────
ALTER INDEX "RandomDraw_company_year_quarter" RENAME TO "RandomDraw_companyId_year_quarter_key";
ALTER INDEX "RandomSelection_draw_kind_member" RENAME TO "RandomSelection_drawId_kind_memberKey_key";
ALTER INDEX "RandomTestingRate_org_year" RENAME TO "RandomTestingRate_organizationId_year_key";

-- ── 4. THE ONE PRISMA COULD NOT PROVE EQUAL ────────────────────────────────
DROP INDEX "Accident_companyId_occurredAt_idx";
CREATE INDEX "Accident_companyId_occurredAt_idx" ON "Accident"("companyId", "occurredAt");
