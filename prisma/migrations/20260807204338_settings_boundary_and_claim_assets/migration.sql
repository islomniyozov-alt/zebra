-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "driverId" TEXT,
ADD COLUMN     "truckId" TEXT;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "settlementWeekEndsOn" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Claim_truckId_idx" ON "Claim"("truckId");

-- CreateIndex
CREATE INDEX "Claim_driverId_idx" ON "Claim"("driverId");

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ----------------------------------------------------------------------------
-- A WEEK ENDS ON A DAY OF THE WEEK.
--
-- `settlementWeekEndsOn` uses `Date.getUTCDay()` numbering — 0 is Sunday —
-- because that is what the code reading it already speaks. Anything outside
-- 0–6 is not a day, and a settlement period computed from one would silently
-- shift every driver's week.
--
-- Prisma cannot express a range check, so it lives here, alongside the other
-- constraints it cannot express. The settings service refuses it first, in
-- words; this is the backstop under a hand-typed row or a future migration.
-- ----------------------------------------------------------------------------

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "settlement_week_ends_on_a_day"
  CHECK ("settlementWeekEndsOn" BETWEEN 0 AND 6);
