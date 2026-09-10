-- The factoring packet: the assignment notice as data, and a filed state.
--
-- `noticeOfAssignment` is text on the factor because every factor words it
-- differently and RTS has not said what it requires. The day they do, it is a
-- field somebody edits rather than a deploy.
--
-- FILED_WITH_FACTOR is a DECIDED status: somebody pressed a button and handed
-- a packet over, which no arithmetic over invoices can produce or take back.

ALTER TABLE "FactoringCompany" ADD COLUMN "noticeOfAssignment" TEXT;

ALTER TYPE "LoadBillingStatus" ADD VALUE 'FILED_WITH_FACTOR' BEFORE 'CLOSED_IN_DATATRUCK';
