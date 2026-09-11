-- ONE SB-/ST- SERIES ACROSS BOTH CARRIERS.
--
-- `Counter` is unique on `(companyId, key)` and stays that way: a load number
-- and an invoice number belong to one authority, and RAM and Dolphins each
-- having their own run is the point of it.
--
-- Settlement numbers are the opposite, and the artefact says so plainly —
-- SB-000436 RAM, SB-000437 Dolphins, SB-000438 RAM, SB-000439 Dolphins,
-- SB-000440 RAM. One ascending run, interleaved. Holding that in `Counter`
-- would mean nominating one company to keep the shared series in, which is a
-- fact nothing in the schema could express.

CREATE TABLE "SeriesCounter" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "value"          INTEGER NOT NULL DEFAULT 0,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeriesCounter_organizationId_key_key"
  ON "SeriesCounter"("organizationId", "key");

ALTER TABLE "SeriesCounter" ADD CONSTRAINT "SeriesCounter_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeriesCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SeriesCounter" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "SeriesCounter"
  USING ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "SeriesCounter" TO zebra_app;
