-- The idempotency key MONEY-DESIGN §2 names, put in the database.
--
-- "Re-uploading the same file writes nothing" is a claim an importer cannot
-- make about itself. A unique index can. Both columns are nullable and both
-- indexes are therefore partial in effect: Postgres does not collide NULLs, so
-- every hand-entered payment and every hand-entered accessorial is untouched.

ALTER TABLE "Payment" ADD COLUMN "remittanceKey" TEXT;
ALTER TABLE "LoadAccessorial" ADD COLUMN "sourceKey" TEXT;

-- One payment per organization per remittance invoice number.
CREATE UNIQUE INDEX "Payment_organizationId_remittanceKey_key"
  ON "Payment"("organizationId", "remittanceKey");

-- One accessorial per load per source key. The key carries the invoice
-- number, the trip or load id, the item type and the money column it came
-- from, so two different columns of one row are two different charges and a
-- second upload of either is the same one.
CREATE UNIQUE INDEX "LoadAccessorial_loadId_sourceKey_key"
  ON "LoadAccessorial"("loadId", "sourceKey");
