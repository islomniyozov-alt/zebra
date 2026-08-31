-- PU AND DEL DATES ON THE DRIVER'S SHEET, frozen at generation.
--
-- The driver's Datatruck sheet carries a pickup and a delivery date per load
-- and this one did not. Sourced from the stops: PU is the actual check-in at
-- the first PICKUP, DEL the actual check-in at the last DELIVERY.
--
-- FROZEN, NOT DERIVED AT RENDER, for the same reason `payRuleSnapshot` is
-- frozen beside it: a settlement is a record of what was agreed and paid. A
-- later trips import enriching a load with actuals must not silently rewrite a
-- cheque somebody has already been given.
ALTER TABLE "SettlementLine" ADD COLUMN "puAt"  TIMESTAMP(3);
ALTER TABLE "SettlementLine" ADD COLUMN "delAt" TIMESTAMP(3);

-- WHETHER EACH DATE IS A RECORD OR A PLAN, per date rather than per line: a
-- load can easily have a real check-in at the shipper and none at the
-- consignee. A money document never presents a plan as an actual silently, so
-- the marker travels with the figure it qualifies.
--
-- DEFAULT FALSE MEANS "not known to be actual", which is the safe reading for
-- the rows that already exist: they were generated before this column and
-- nothing about them is evidence either way.
ALTER TABLE "SettlementLine" ADD COLUMN "puActual"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SettlementLine" ADD COLUMN "delActual" BOOLEAN NOT NULL DEFAULT false;

-- NO GRANT NEEDED: columns on a table that already carries its own grants and
-- its org_isolation policy from 20260728224443_init.
