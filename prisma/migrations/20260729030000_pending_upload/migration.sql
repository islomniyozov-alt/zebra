-- The record of a presigned PUT that was handed out and not yet confirmed.
--
-- Its own table rather than a PENDING status on Document: a status column makes
-- correctness depend on every future read path remembering to filter it, and
-- the one that forgets shows a user a document that was never uploaded.
-- `Document` now means "this file exists", with no qualifier.

-- CreateTable
CREATE TABLE "PendingUpload" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "targetEntity" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingUpload_r2Key_key" ON "PendingUpload"("r2Key");

-- CreateIndex
CREATE INDEX "PendingUpload_organizationId_expiresAt_idx" ON "PendingUpload"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "PendingUpload_targetEntity_targetId_idx" ON "PendingUpload"("targetEntity", "targetId");

-- AddForeignKey
ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- It carries a tenant, so it answers to the same wall as everything else. The
-- structure suite fails the build if this is missing.
ALTER TABLE "PendingUpload" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PendingUpload" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "PendingUpload"
  USING ("organizationId" = current_setting('app.current_org_id', true));
