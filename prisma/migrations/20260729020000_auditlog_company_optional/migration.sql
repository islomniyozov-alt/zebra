-- Audit has to cover things that belong to the organization and to no single
-- authority: a broker, a saved facility, a membership. A required companyId
-- would mean inventing one or declining to record those writes, and the second
-- is how an audit trail quietly becomes 60% covered.
--
-- The two organization-scoped indexes are here because company-less rows still
-- have to be findable, and every audit query starts from the tenant.

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "companyId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entityType_entityId_idx" ON "AuditLog"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

