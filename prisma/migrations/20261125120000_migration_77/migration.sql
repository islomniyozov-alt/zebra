-- Migration 77 — Truck.lessorName (TMS §6.5 part 5 v11.56, owner's ruling
-- 2026-11-25): the lessor the cab card names, read by Add truck and shown on
-- Details beside the owner name.
--
-- One nullable TEXT column. Nothing is dropped, narrowed or defaulted, so no
-- writer grep is owed (AGENTS.md). NULL is every existing truck's state and
-- means "no lessor on file". No new table: Truck's existing row-level policy
-- covers the column and no isolation fixture is owed.

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "lessorName" TEXT;
