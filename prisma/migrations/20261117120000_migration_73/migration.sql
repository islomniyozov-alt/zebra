-- Migration 73 — the driver record's Main tab in Datatruck's shape
-- (TMS-DESIGN-SYSTEM.md §6.4 part 2, v11.22; owner's brief 2026-11-17).
--
-- FOUR NULLABLE COLUMNS ON "Driver", ONE INDEX, ONE FOREIGN KEY. Nothing is
-- removed, no default is dropped and no constraint is narrowed, so no writer
-- can start failing: every existing insert and update leaves the new columns
-- NULL, which is what an unrecorded middle name, birth date, Telegram handle or
-- dispatcher is. `updateDriver` writes each only when the form sends it.
--
-- `dispatcherUserId` points at "User" with ON DELETE SET NULL: a dispatcher
-- who leaves takes their name off their drivers rather than blocking the
-- user's deletion or leaving a driver row that cannot be saved.
--
-- THE SQL IS PRISMA'S OWN DIFF of the schema against main's, run without a
-- database (`prisma migrate diff --from-schema … --to-schema … --script`) —
-- the relation names added beside it ("DriverUser", "DriverDispatcher") are
-- client-side and produce no statement.

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "birthDate" TIMESTAMP(3),
ADD COLUMN     "dispatcherUserId" TEXT,
ADD COLUMN     "middleName" TEXT,
ADD COLUMN     "telegram" TEXT;

-- CreateIndex
CREATE INDEX "Driver_dispatcherUserId_idx" ON "Driver"("dispatcherUserId");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_dispatcherUserId_fkey" FOREIGN KEY ("dispatcherUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
