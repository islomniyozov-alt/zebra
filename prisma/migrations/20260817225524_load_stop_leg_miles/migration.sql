-- The leg that ARRIVED at this stop: its distance, and whether it carried
-- freight. A Relay trip is legs; legs flatten into the stop chain, so the leg
-- is the edge into a stop and lives on the stop it ends at. The first stop of
-- a trip has none, which is why both are nullable.
--
-- NOT a LoadLeg table: a second table would duplicate the chain and give two
-- places to answer "what order did this trip run in".
ALTER TABLE "LoadStop" ADD COLUMN "legMiles" INTEGER;
ALTER TABLE "LoadStop" ADD COLUMN "legEmpty" BOOLEAN;

-- NO GRANT NEEDED: columns on a table that already carries its own grants and
-- its org_isolation policy from 20260728224443_init.
