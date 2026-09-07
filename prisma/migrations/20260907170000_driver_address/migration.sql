-- THE DRIVER'S ADDRESS, READ FROM FIELD 8 OF THE LICENCE.
--
-- A LICENCE ADDRESS IS OFTEN STALE and these columns are a starting point, not
-- a source of truth. Drivers move without updating the card, because nothing
-- makes them until it expires. Payroll, 1099s and anything filed with a tax
-- authority must come from something a human confirmed, not from here.
--
-- ADDITIVE AND NULLABLE. Every existing driver gets NULL, which is honest:
-- nobody has read their card. No backfill and no default.
--
-- `address*` RATHER THAN Company's BARE `city`/`state`: a Driver already has
-- `cdlState`, and `driver.state` next to `driver.cdlState` is a pair somebody
-- mixes up eventually — in payroll, silently. The prefix removes the question.
ALTER TABLE "Driver" ADD COLUMN "addressLine1"      TEXT;
ALTER TABLE "Driver" ADD COLUMN "addressCity"       TEXT;
ALTER TABLE "Driver" ADD COLUMN "addressState"      TEXT;
ALTER TABLE "Driver" ADD COLUMN "addressPostalCode" TEXT;

-- NO GRANT AND NO POLICY NEEDED: columns on a table that already carries its
-- grants and its org_isolation policy from 20260728224443_init.
