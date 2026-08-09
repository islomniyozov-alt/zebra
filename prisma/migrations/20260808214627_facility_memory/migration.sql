-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "dockNotes" TEXT,
ADD COLUMN     "gateCode" TEXT,
ADD COLUMN     "normalizedAddress" TEXT;

-- CreateIndex
CREATE INDEX "Location_organizationId_normalizedAddress_idx" ON "Location"("organizationId", "normalizedAddress");
