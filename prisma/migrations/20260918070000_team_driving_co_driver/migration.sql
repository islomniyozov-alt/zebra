-- TEAM DRIVING (item 8).
--
-- A team is two drivers on one truck sharing loads, each paid their own
-- percentage of the same gross. Team is DERIVED: `Load.coDriverId != null` is
-- the whole of it. There is no isTeam flag and no team table.
--
-- Written by hand rather than generated. `prisma migrate diff` reported that
-- SettlementLoadLine_organizationId_fkey was missing from the dev database
-- when the database plainly has it, so its output was not trusted for a
-- change that moves a money constraint.

-- ── THE SECOND CREW MEMBER ───────────────────────────────────────────────
ALTER TABLE "Load" ADD COLUMN "coDriverId" TEXT;

ALTER TABLE "Load"
  ADD CONSTRAINT "Load_coDriverId_fkey"
  FOREIGN KEY ("coDriverId") REFERENCES "Driver"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ONE PERSON CANNOT CREW A LOAD TWICE. Listed in both seats they would settle
-- as two crew members and be paid twice for one load, the second time wearing
-- a different hat. The database refuses it rather than the code remembering.
ALTER TABLE "Load"
  ADD CONSTRAINT "Load_coDriver_differs_from_driver"
  CHECK ("coDriverId" IS NULL OR "coDriverId" <> "driverId");

-- The batch asks "which loads is this person crew on" — driverId OR
-- coDriverId. Without this the second half is a scan per driver.
CREATE INDEX "Load_coDriverId_idx" ON "Load"("coDriverId");

-- ── A LOAD SETTLES ONCE PER DRIVER, NOT ONCE ─────────────────────────────
--
-- A team load legitimately produces two settlement load lines, one per crew
-- member, and `SettlementLoadLine_loadId_key` forbade the second outright.
-- The key gains the driver rather than losing its teeth: the same driver
-- still cannot be paid twice for the same load, by a re-run or a second batch.

ALTER TABLE "SettlementLoadLine" ADD COLUMN "driverId" TEXT;

-- BACKFILLED FROM THE SETTLEMENT THAT OWNS THE LINE, which is total:
-- Settlement.driverId is NOT NULL and every line has a settlement. Dev has no
-- rows at all here; production does, and this is what makes it safe there.
UPDATE "SettlementLoadLine" AS line
   SET "driverId" = s."driverId"
  FROM "Settlement" AS s
 WHERE s."id" = line."settlementId";

-- REFUSES RATHER THAN DEFAULTS. If any row failed to match above, this stops
-- the migration instead of inventing an owner for somebody's pay line.
ALTER TABLE "SettlementLoadLine" ALTER COLUMN "driverId" SET NOT NULL;

ALTER TABLE "SettlementLoadLine"
  ADD CONSTRAINT "SettlementLoadLine_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "SettlementLoadLine_loadId_key";

CREATE UNIQUE INDEX "SettlementLoadLine_loadId_driverId_key"
  ON "SettlementLoadLine"("loadId", "driverId");
