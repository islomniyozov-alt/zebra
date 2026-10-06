-- MIGRATION 67 — THE WORKBENCH'S STATEMENTS TAKE THE BATCH ENGINE'S HEADER
--
-- §6.2.2 "The header's columns, both engines" (v10.34, narrowed v10.35),
-- GAPS.md code gaps 1 and 2. Data only; no DDL, no default, constraint or index
-- removed; NO ROW ADDED OR REMOVED IN ANY TABLE. For every statement the
-- workbench engine made (`batchId IS NULL`) the six money columns are rewritten
-- by the one rule the batch engine already follows:
--
--   grossCents          = Σ the LOAD_PAY lines' loads' billed totals
--                       + Σ SettlementLoadLine.grossCents        (the FREIGHT)
--   earningsCents       = Σ LOAD_PAY + Σ SettlementLoadLine.amountCents
--                       + Σ ACCESSORIAL_PAY                      (the driver's cut)
--   otherPayCents       = Σ BONUS + Σ REIMBURSEMENT
--   reimbursementsCents = Σ REIMBURSEMENT
--   deductionsCents     = Σ DEDUCTION_* lines AS STORED           (negative)
--   advancesCents       = 0  (the batch's own "Advance" other-pay row; a
--                             workbench DEDUCTION_ADVANCE is a deduction)
--
-- netCents is NOT touched, and the transaction REFUSES to commit if any row's
-- net no longer equals earnings + other pay + deductions.
--
-- MEASURED ON DEV BEFORE THIS WAS WRITTEN (scratchpad m67-probe.cjs, read-only):
--
--   statements by engine and status
--     batch     DRAFT 103 · APPROVED 32 · PAID 1
--     workbench DRAFT 4 (no lines) · PAID 2  gross 261000 earnings 0 deductions +50000 net 211000
--   workbench SettlementLine rows by type
--     LOAD_PAY (loadId present) 4 rows 261000 · DEDUCTION_FUEL 2 rows -50000
--   batch statements that also carry SettlementLine rows ............ 0
--   workbench statements that also carry SettlementLoadLine rows .... 0
--   workbench statements whose net != sum of their lines ............ 0
--   workbench LOAD_PAY lines: 4, equals_freight 0, below_freight 4, no_snapshot 0
--
-- So on dev this rewrites 6 headers: the two PAID rows go from
-- gross 261000 / earnings 0 / deductions +50000 to gross = their loads' billed
-- totals / earnings 261000 / deductions -50000, net 211000 either way, or the
-- whole thing rolls back.
--
-- THE WRITERS (the 2026-10-06 rule read widely, though nothing is removed):
--
--   $ grep -rn "settlementLine.create\|settlementLoadLine.create\|settlement.create(" src/lib
--   src/lib/settlement-batch.ts     the batch engine        -> unchanged
--   src/lib/settlements.ts          generateSettlement      -> header by this rule (this commit)
--   src/lib/settlements.ts          addSettlementLine       -> hand lines, then refreshTotals (unchanged)
--   src/lib/settlements.ts          refreshTotals           -> sums BOTH tables by this rule (this commit)
--   src/lib/statement-workbench.ts  addTripsToSettlement    -> priced load line, no LOAD_PAY twin (this commit)
--
-- NO BEGIN/COMMIT OF ITS OWN, like every migration before it: Prisma applies
-- the file in one transaction, so the RAISE below rolls back the UPDATE.

UPDATE "Settlement" s SET
  "grossCents" =
      COALESCE((SELECT SUM(ld."totalRevenueCents")
                  FROM "SettlementLine" x JOIN "Load" ld ON ld."id" = x."loadId"
                 WHERE x."settlementId" = s."id" AND x."type" = 'LOAD_PAY'), 0)
    + COALESCE((SELECT SUM(ll."grossCents") FROM "SettlementLoadLine" ll WHERE ll."settlementId" = s."id"), 0),
  "earningsCents" =
      COALESCE((SELECT SUM(x."amountCents") FROM "SettlementLine" x
                 WHERE x."settlementId" = s."id" AND x."type" IN ('LOAD_PAY', 'ACCESSORIAL_PAY')), 0)
    + COALESCE((SELECT SUM(ll."amountCents") FROM "SettlementLoadLine" ll WHERE ll."settlementId" = s."id"), 0),
  "otherPayCents" =
      COALESCE((SELECT SUM(x."amountCents") FROM "SettlementLine" x
                 WHERE x."settlementId" = s."id" AND x."type" IN ('BONUS', 'REIMBURSEMENT')), 0),
  "reimbursementsCents" =
      COALESCE((SELECT SUM(x."amountCents") FROM "SettlementLine" x
                 WHERE x."settlementId" = s."id" AND x."type" = 'REIMBURSEMENT'), 0),
  "deductionsCents" =
      COALESCE((SELECT SUM(x."amountCents") FROM "SettlementLine" x
                 WHERE x."settlementId" = s."id" AND x."type"::text LIKE 'DEDUCTION%'), 0),
  "advancesCents" = 0
WHERE s."batchId" IS NULL;

DO $$
DECLARE
  broken integer;
BEGIN
  SELECT COUNT(*) INTO broken
    FROM "Settlement" s
   WHERE s."batchId" IS NULL
     AND s."netCents" <> s."earningsCents" + s."otherPayCents" + s."deductionsCents";
  IF broken > 0 THEN
    RAISE EXCEPTION 'migration 67: % workbench statement(s) would not net to earnings + other pay + deductions — rolled back', broken;
  END IF;
END $$;
