-- CreateEnum
CREATE TYPE "DataQsStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "DataQsOutcome" AS ENUM ('ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ClaimPartyRole" AS ENUM ('CLAIMANT', 'INSURER', 'ADJUSTER', 'ATTORNEY', 'CARRIER', 'WITNESS', 'OTHER');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "dataQsId" TEXT;

-- CreateTable
CREATE TABLE "DataQsChallenge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "violationId" TEXT,
    "status" "DataQsStatus" NOT NULL DEFAULT 'DRAFT',
    "outcome" "DataQsOutcome",
    "basis" TEXT NOT NULL,
    "outcomeNote" TEXT,
    "referenceNumber" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataQsChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimParty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "role" "ClaimPartyRole" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "body" TEXT,
    "fromStatus" "ClaimStatus",
    "toStatus" "ClaimStatus",
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataQsChallenge_companyId_status_idx" ON "DataQsChallenge"("companyId", "status");

-- CreateIndex
CREATE INDEX "DataQsChallenge_inspectionId_idx" ON "DataQsChallenge"("inspectionId");

-- CreateIndex
CREATE INDEX "DataQsChallenge_violationId_idx" ON "DataQsChallenge"("violationId");

-- CreateIndex
CREATE INDEX "ClaimParty_claimId_idx" ON "ClaimParty"("claimId");

-- CreateIndex
CREATE INDEX "ClaimParty_organizationId_idx" ON "ClaimParty"("organizationId");

-- CreateIndex
CREATE INDEX "ClaimNote_claimId_createdAt_idx" ON "ClaimNote"("claimId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaimNote_organizationId_idx" ON "ClaimNote"("organizationId");

-- CreateIndex
CREATE INDEX "Document_dataQsId_idx" ON "Document"("dataQsId");

-- AddForeignKey
ALTER TABLE "DataQsChallenge" ADD CONSTRAINT "DataQsChallenge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQsChallenge" ADD CONSTRAINT "DataQsChallenge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQsChallenge" ADD CONSTRAINT "DataQsChallenge_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "RoadsideInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQsChallenge" ADD CONSTRAINT "DataQsChallenge_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "InspectionViolation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimParty" ADD CONSTRAINT "ClaimParty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimParty" ADD CONSTRAINT "ClaimParty_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimNote" ADD CONSTRAINT "ClaimNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimNote" ADD CONSTRAINT "ClaimNote_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimNote" ADD CONSTRAINT "ClaimNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_dataQsId_fkey" FOREIGN KEY ("dataQsId") REFERENCES "DataQsChallenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ----------------------------------------------------------------------------
-- THE TENANT WALL.
--
-- DataQsChallenge carries its own organizationId and companyId and takes the
-- ordinary policy. ClaimParty and ClaimNote do not: both belong to exactly one
-- claim and inherit the authority through it, so `organizationId` is DERIVED by
-- a trigger rather than trusted from the caller — the same treatment as
-- InvoiceLine, SettlementLine and InspectionViolation.
--
-- One function serves both tables, because both derive from the same parent
-- column on the same parent table. The trigger fires only on the columns that
-- can change the answer (see 20260728233000): editing a party's phone number
-- must not re-derive the tenant, and an UPDATE fired by a cascade must not go
-- looking for a claim the cascade has already removed.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION zebra_org_from_claim() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE claim_org text;
BEGIN
  SELECT "organizationId" INTO claim_org FROM "Claim" WHERE "id" = NEW."claimId";
  IF claim_org IS NULL THEN
    RAISE EXCEPTION 'zebra: claimId=% has no Claim', NEW."claimId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW."organizationId" := claim_org;
  RETURN NEW;
END $$;

CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "claimId", "organizationId" ON "ClaimParty"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_claim();

CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "claimId", "organizationId" ON "ClaimNote"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_claim();

ALTER TABLE "ClaimParty" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaimParty" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "ClaimParty"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ClaimNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaimNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "ClaimNote"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DataQsChallenge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataQsChallenge" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "DataQsChallenge"
  USING ("organizationId" = current_setting('app.current_org_id', true));


-- ----------------------------------------------------------------------------
-- A CHALLENGE POINTS AT A VIOLATION ON THE INSPECTION IT NAMES.
--
-- `violationId` is nullable because a carrier can challenge the INSPECTION
-- itself — wrong carrier, wrong unit, duplicate filing — with no particular
-- code at issue. But when it does name one, that violation must belong to the
-- inspection the challenge names, or the trace §4 asks for
-- (inspection → violation → challenge → outcome) leads somewhere else.
--
-- Two foreign keys cannot say this between them; a trigger can, and it is the
-- only place the relationship is checkable at write time.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION zebra_dataqs_violation_matches() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parent text;
BEGIN
  IF NEW."violationId" IS NULL THEN RETURN NEW; END IF;
  SELECT "inspectionId" INTO parent
    FROM "InspectionViolation" WHERE "id" = NEW."violationId";
  IF parent IS NULL THEN
    RAISE EXCEPTION 'zebra: violationId=% has no InspectionViolation', NEW."violationId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF parent <> NEW."inspectionId" THEN
    RAISE EXCEPTION 'zebra: violation % belongs to inspection %, not %',
      NEW."violationId", parent, NEW."inspectionId"
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "dataqs_violation_matches"
  BEFORE INSERT OR UPDATE OF "inspectionId", "violationId" ON "DataQsChallenge"
  FOR EACH ROW EXECUTE FUNCTION zebra_dataqs_violation_matches();


-- ----------------------------------------------------------------------------
-- AN OUTCOME BELONGS TO A CLOSED CHALLENGE, AND A CLOSED ONE HAS AN OUTCOME.
--
-- Status is where the challenge is; outcome is what came of it. A SUBMITTED
-- challenge with an outcome already recorded, or a CLOSED one with none, is a
-- row nobody can read — and "closed" would stop meaning anything. The service
-- refuses both in words; this is the backstop under it.
-- ----------------------------------------------------------------------------

ALTER TABLE "DataQsChallenge"
  ADD CONSTRAINT "dataqs_outcome_matches_status"
  CHECK (("status" = 'CLOSED') = ("outcome" IS NOT NULL));


-- ALTER DEFAULT PRIVILEGES in the RLS migration already grants zebra_app on new
-- tables, but only for tables created by the same role. Stated explicitly so
-- this does not depend on who ran the migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON "ClaimParty" TO zebra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ClaimNote" TO zebra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "DataQsChallenge" TO zebra_app;
