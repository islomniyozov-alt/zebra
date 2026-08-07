-- CreateEnum
CREATE TYPE "InspectionLevel" AS ENUM ('LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5', 'LEVEL_6');

-- CreateEnum
CREATE TYPE "ViolationUnit" AS ENUM ('DRIVER', 'VEHICLE', 'HAZMAT', 'OTHER');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "inspectionId" TEXT;

-- CreateTable
CREATE TABLE "RoadsideInspection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "truckId" TEXT,
    "trailerId" TEXT,
    "driverId" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "level" "InspectionLevel" NOT NULL,
    "state" TEXT NOT NULL,
    "reportNumber" TEXT,
    "location" TEXT,
    "inspectorName" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoadsideInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionViolation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "unit" "ViolationUnit" NOT NULL DEFAULT 'VEHICLE',
    "outOfService" BOOLEAN NOT NULL DEFAULT false,
    "severityWeight" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionViolation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoadsideInspection_companyId_inspectedAt_idx" ON "RoadsideInspection"("companyId", "inspectedAt");

-- CreateIndex
CREATE INDEX "RoadsideInspection_companyId_truckId_inspectedAt_idx" ON "RoadsideInspection"("companyId", "truckId", "inspectedAt");

-- CreateIndex
CREATE INDEX "RoadsideInspection_companyId_driverId_inspectedAt_idx" ON "RoadsideInspection"("companyId", "driverId", "inspectedAt");

-- CreateIndex
CREATE INDEX "RoadsideInspection_companyId_trailerId_inspectedAt_idx" ON "RoadsideInspection"("companyId", "trailerId", "inspectedAt");

-- CreateIndex
CREATE INDEX "InspectionViolation_inspectionId_idx" ON "InspectionViolation"("inspectionId");

-- CreateIndex
CREATE INDEX "InspectionViolation_organizationId_idx" ON "InspectionViolation"("organizationId");

-- CreateIndex
CREATE INDEX "Document_inspectionId_idx" ON "Document"("inspectionId");

-- AddForeignKey
ALTER TABLE "RoadsideInspection" ADD CONSTRAINT "RoadsideInspection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideInspection" ADD CONSTRAINT "RoadsideInspection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideInspection" ADD CONSTRAINT "RoadsideInspection_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideInspection" ADD CONSTRAINT "RoadsideInspection_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideInspection" ADD CONSTRAINT "RoadsideInspection_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionViolation" ADD CONSTRAINT "InspectionViolation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionViolation" ADD CONSTRAINT "InspectionViolation_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "RoadsideInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "RoadsideInspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ----------------------------------------------------------------------------
-- THE TENANT WALL.
--
-- RoadsideInspection carries its own organizationId and companyId, so it takes
-- the ordinary policy. InspectionViolation does not: it belongs to exactly one
-- inspection and inherits the authority through it, so `organizationId` is
-- DERIVED by a trigger rather than trusted from the caller — the same treatment
-- as InvoiceLine and SettlementLine, and for the same reason. A child table is
-- where a cross-tenant write is invisible, because the child looks valid on its
-- own.
--
-- The trigger fires only on the columns that can change the answer (see
-- 20260728233000_org_trigger_only_on_relevant_columns). Correcting a violation
-- code must not re-derive the tenant, and an UPDATE fired by a cascade must not
-- go looking for a parent the cascade has already removed.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION zebra_org_from_inspection() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inspection_org text;
BEGIN
  SELECT "organizationId" INTO inspection_org
    FROM "RoadsideInspection" WHERE "id" = NEW."inspectionId";
  IF inspection_org IS NULL THEN
    RAISE EXCEPTION 'zebra: InspectionViolation.inspectionId=% has no RoadsideInspection', NEW."inspectionId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW."organizationId" := inspection_org;
  RETURN NEW;
END $$;

CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "inspectionId", "organizationId" ON "InspectionViolation"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_inspection();

ALTER TABLE "RoadsideInspection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoadsideInspection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "RoadsideInspection"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InspectionViolation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InspectionViolation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "InspectionViolation"
  USING ("organizationId" = current_setting('app.current_org_id', true));


-- ----------------------------------------------------------------------------
-- AN INSPECTION HAS TO BE OF SOMETHING.
--
-- All three subject columns are nullable because no single one is always
-- present: Level III is driver-only, Level V is vehicle-only with the driver
-- absent, and a trailer can be inspected on its own. But a row with all three
-- null is an event attached to nothing — it would never appear on any panel and
-- could never be found again.
--
-- Prisma cannot express a CHECK, so it lives here, like the partial unique
-- indexes on the asset tables. tests/structure.test.ts asserts it exists.
-- ----------------------------------------------------------------------------

ALTER TABLE "RoadsideInspection"
  ADD CONSTRAINT "inspection_has_a_subject"
  CHECK (num_nonnulls("truckId", "trailerId", "driverId") >= 1);


-- ALTER DEFAULT PRIVILEGES in the RLS migration already grants zebra_app on new
-- tables, but only for tables created by the same role. Stated explicitly so
-- this does not depend on who ran the migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON "RoadsideInspection" TO zebra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "InspectionViolation" TO zebra_app;
