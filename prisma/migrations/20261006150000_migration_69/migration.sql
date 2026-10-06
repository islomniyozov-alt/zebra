-- MIGRATION 69 — EVERY WORKBENCH TRIP IS A SettlementLoadLine
--
-- §6.2.2 (v10.37). 67 gave both engines one header rule and left the generate
-- path's trips where they were — LOAD_PAY rows in "SettlementLine" — because
-- the move touched twelve test sites and six readers. This is the move, as its
-- own step. Two parts:
--
--   1. DDL, additive: "SettlementLoadLine" gains "puActual" and "delActual",
--      NULLABLE. True or false on a workbench row, where `sheetDates` decided
--      each; NULL on a batch row, which records nothing the batch did not know
--      rather than a default that reads as "plan". Nothing removed, so the
--      2026-10-06 grep rule does not bind.
--
--   2. DATA: every LOAD_PAY row in "SettlementLine" that carries a load becomes
--      a "SettlementLoadLine" on the same statement — freight from the load's
--      billed total, pay and the frozen rule from the line, the broker's
--      reference and the authority from the load, places from the load's first
--      pickup and last delivery stop, dates from the line's own frozen sheet
--      dates first and the stops' plans after, the plan-or-record flags carried
--      across — and the LOAD_PAY row is deleted. The header is NOT touched:
--      since 67 `headerFromLines` reads both tables, so a trip counts the same
--      from either side of the move. Every statement's net is captured before
--      and compared after; a difference anywhere rolls the whole file back, as
--      does a moved count that does not equal the inserted count.
--
-- MEASURED ON DEV BEFORE THIS WAS WRITTEN (scratchpad m67-probe.cjs, re-read
-- after 67 and 68):
--
--   workbench SettlementLine rows by type
--     LOAD_PAY (loadId present) 4 rows 261000 · DEDUCTION_FUEL 2 rows -50000
--   LOAD_PAY (loadId, driverId) already present in SettlementLoadLine .. 0
--   LOAD_PAY lines per (statement, load) with duplicates .............. 0
--   LOAD_PAY lines without a loadId ................................... 0
--
-- So on dev this moves four rows onto two statements, and the net column's sum
-- is the same number before and after or nothing happened.
--
-- THE WRITERS (the generate path is the only one that ever wrote LOAD_PAY):
--
--   $ grep -rn "type: 'LOAD_PAY'" src/lib src/app
--   src/lib/settlements.ts   generateSettlement -> writes loadLines (this commit)
--   (statement-workbench.ts stopped writing its LOAD_PAY twin in 67)
--
-- NO BEGIN/COMMIT OF ITS OWN, like every migration before it: Prisma applies
-- the file in one transaction, so a RAISE below rolls back everything above it.

-- ── 1. THE TWO FLAGS ──────────────────────────────────────────────────────
ALTER TABLE "SettlementLoadLine"
  ADD COLUMN "puActual"  BOOLEAN,
  ADD COLUMN "delActual" BOOLEAN;

-- ── 2. WHAT EVERY STATEMENT NETS, AND HOW MANY ROWS MOVE, BEFORE ──────────
CREATE TEMP TABLE m69_net_before AS
  SELECT "id", "netCents" FROM "Settlement";

CREATE TEMP TABLE m69_moving AS
  SELECT l."id" AS line_id
    FROM "SettlementLine" l
   WHERE l."type" = 'LOAD_PAY' AND l."loadId" IS NOT NULL;

-- ── 3. THE TRIPS MOVE ─────────────────────────────────────────────────────
INSERT INTO "SettlementLoadLine" (
  "id", "settlementId", "organizationId", "loadId", "companyId", "companyName",
  "loadNumber", "referenceNumber", "puPlace", "delPlace", "puDate", "delDate",
  "puActual", "delActual", "grossCents", "milesHundredths", "amountCents",
  "settledBasis", "payRuleSnapshot", "sortOrder", "driverId", "createdAt"
)
SELECT
  l."id", l."settlementId", l."organizationId", l."loadId", ld."companyId", c."name",
  ld."loadNumber", ld."referenceNumber",
  COALESCE(pu."city", '') || ',' || COALESCE(pu."state", ''),
  COALESCE(de."city", '') || ',' || COALESCE(de."state", ''),
  COALESCE(l."puAt", pu."scheduledAt", s."periodStart"),
  COALESCE(l."delAt", de."scheduledAt", s."periodEnd"),
  l."puActual", l."delActual",
  ld."totalRevenueCents",
  COALESCE(ld."actualMiles", ld."dispatchedMiles", 0) * 100,
  l."amountCents", 'rate', l."payRuleSnapshot", l."sortOrder", s."driverId", l."createdAt"
FROM "SettlementLine" l
JOIN m69_moving m ON m.line_id = l."id"
JOIN "Settlement" s ON s."id" = l."settlementId"
JOIN "Load" ld ON ld."id" = l."loadId"
JOIN "Company" c ON c."id" = ld."companyId"
LEFT JOIN LATERAL (
  SELECT "city", "state", "scheduledAt" FROM "LoadStop"
   WHERE "loadId" = ld."id" AND "type" = 'PICKUP' ORDER BY "sequence" ASC LIMIT 1
) pu ON TRUE
LEFT JOIN LATERAL (
  SELECT "city", "state", "scheduledAt" FROM "LoadStop"
   WHERE "loadId" = ld."id" AND "type" = 'DELIVERY' ORDER BY "sequence" DESC LIMIT 1
) de ON TRUE;

DELETE FROM "SettlementLine" l
USING m69_moving m
WHERE m.line_id = l."id";

-- ── 4. THE SAME ROWS, THE SAME NETS, OR NOTHING HAPPENED ──────────────────
DO $$
DECLARE
  moving integer;
  landed integer;
  broken_net integer;
BEGIN
  SELECT COUNT(*) INTO moving FROM m69_moving;
  SELECT COUNT(*) INTO landed FROM "SettlementLoadLine" ll JOIN m69_moving m ON m.line_id = ll."id";
  IF moving <> landed THEN
    RAISE EXCEPTION 'migration 69: % line(s) to move, % landed — rolled back', moving, landed;
  END IF;

  SELECT COUNT(*) INTO broken_net
    FROM "Settlement" s JOIN m69_net_before b ON b."id" = s."id"
   WHERE s."netCents" <> b."netCents";
  IF broken_net > 0 THEN
    RAISE EXCEPTION 'migration 69: % statement(s) changed net — rolled back', broken_net;
  END IF;
END $$;

DROP TABLE m69_moving;
DROP TABLE m69_net_before;
