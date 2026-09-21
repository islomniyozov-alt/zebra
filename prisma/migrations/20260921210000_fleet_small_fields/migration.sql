-- ITEM 12 — THE SMALL FIELDS A FLEET SCREEN IS ACTUALLY MADE OF.
--
-- Five columns on Truck and one on Driver. Every one of them optional: these
-- are facts a yard acquires over time, and a required field here would mean a
-- truck cannot be entered until somebody goes and counts its axles.

-- ── A SECOND AXIS, NOT A REPLACEMENT ────────────────────────────────────
--
-- `Truck.status` is where the freight has the unit. `fleetStatus` is whether
-- it is fit to run at all. The two disagreeing — In shop and DISPATCHED — is
-- the thing a dispatcher needs to SEE, so nothing here forbids it.
--
-- TEXT, NOT A POSTGRES ENUM, AND NOT A CHECK EITHER. Migration 52's ruling,
-- applied again: the vocabulary lives in src/lib/fleet-codes.ts, where a
-- fourth value is an edit somebody reviews rather than a migration against a
-- table the whole fleet points at. `fleet.ts` refuses anything outside the
-- list by name, and the refusal is watched firing.
ALTER TABLE "Truck" ADD COLUMN "fleetStatus" TEXT;
ALTER TABLE "Truck" ADD COLUMN "fuelType" TEXT;

-- BLANK MEANS THE CARRIER OWNS IT. Writing the authority's own name onto 49
-- rows would be a second answer to a question `companyId` already answers,
-- free to disagree the first time a truck is transferred.
ALTER TABLE "Truck" ADD COLUMN "ownerName" TEXT;

ALTER TABLE "Truck" ADD COLUMN "axles" INTEGER;

-- POUNDS, because that is the unit every US registration, permit and scale
-- ticket states it in. Nothing to convert is nothing to convert wrongly.
ALTER TABLE "Truck" ADD COLUMN "grossWeightLbs" INTEGER;

-- ── THE TRAILER A DRIVER PULLS ──────────────────────────────────────────
ALTER TABLE "Driver" ADD COLUMN "assignedTrailerId" TEXT;

ALTER TABLE "Driver"
  ADD CONSTRAINT "Driver_assignedTrailerId_fkey"
  FOREIGN KEY ("assignedTrailerId") REFERENCES "Trailer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Driver_assignedTrailerId_idx" ON "Driver"("assignedTrailerId");

-- ── ONE TRAILER, ONE DRIVER ─────────────────────────────────────────────
--
-- THIS IS WHERE IT DIFFERS FROM `assignedTruckId`, WHICH HAS NO SUCH INDEX.
-- A truck carries a team; a trailer is pulled by one, and a trailer sitting
-- against two drivers sends two people to the same box.
--
-- PARTIAL, for the reason `truck_unit_per_company` is partial: a REMOVED
-- driver holding a trailer against a live one is a row the user cannot see
-- blocking a row they are trying to save. Prisma cannot express the predicate,
-- so this is created by hand and must not be "restored" to an @@unique.
CREATE UNIQUE INDEX "driver_trailer_once"
  ON "Driver"("assignedTrailerId")
  WHERE "assignedTrailerId" IS NOT NULL AND "deletedAt" IS NULL;
