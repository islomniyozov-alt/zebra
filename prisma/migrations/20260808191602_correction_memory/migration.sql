-- CreateTable
CREATE TABLE "CustomerAlias" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "learnedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionCorrection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "loadId" TEXT,
    "documentId" TEXT,
    "field" TEXT NOT NULL,
    "extractedValue" TEXT,
    "correctedValue" TEXT,
    "confidence" TEXT,
    "correctedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerAlias_customerId_idx" ON "CustomerAlias"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAlias_organizationId_normalized_key" ON "CustomerAlias"("organizationId", "normalized");

-- CreateIndex
CREATE INDEX "ExtractionCorrection_organizationId_field_idx" ON "ExtractionCorrection"("organizationId", "field");

-- CreateIndex
CREATE INDEX "ExtractionCorrection_documentId_idx" ON "ExtractionCorrection"("documentId");

-- CreateIndex
CREATE INDEX "ExtractionCorrection_loadId_idx" ON "ExtractionCorrection"("loadId");

-- AddForeignKey
ALTER TABLE "CustomerAlias" ADD CONSTRAINT "CustomerAlias_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAlias" ADD CONSTRAINT "CustomerAlias_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAlias" ADD CONSTRAINT "CustomerAlias_learnedByUserId_fkey" FOREIGN KEY ("learnedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionCorrection" ADD CONSTRAINT "ExtractionCorrection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionCorrection" ADD CONSTRAINT "ExtractionCorrection_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionCorrection" ADD CONSTRAINT "ExtractionCorrection_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionCorrection" ADD CONSTRAINT "ExtractionCorrection_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- THE TENANT WALL.
--
-- Both tables carry their own organizationId — an alias belongs to a tenant's
-- vocabulary and a correction to its history — so both take the ordinary policy
-- and neither needs a trigger.
--
-- The alias table is the one worth pausing on: it is READ on every upload to
-- decide which Customer an extracted string means. A leak here would not show a
-- row from another tenant — it would silently resolve one carrier's broker name
-- to another carrier's customer, which is worse than a visible leak because
-- nothing on the screen would look wrong.
-- ----------------------------------------------------------------------------

ALTER TABLE "CustomerAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerAlias" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "CustomerAlias"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ExtractionCorrection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExtractionCorrection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "ExtractionCorrection"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ALTER DEFAULT PRIVILEGES in the RLS migration already grants zebra_app on new
-- tables, but only for tables created by the same role. Stated explicitly so
-- this does not depend on who ran the migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON "CustomerAlias" TO zebra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ExtractionCorrection" TO zebra_app;
