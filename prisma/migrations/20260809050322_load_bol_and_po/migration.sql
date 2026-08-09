-- AlterTable
ALTER TABLE "Load" ADD COLUMN     "bolNumber" TEXT,
ADD COLUMN     "poNumber" TEXT;

-- CreateIndex
CREATE INDEX "Load_organizationId_bolNumber_idx" ON "Load"("organizationId", "bolNumber");

-- CreateIndex
CREATE INDEX "Load_organizationId_poNumber_idx" ON "Load"("organizationId", "poNumber");
