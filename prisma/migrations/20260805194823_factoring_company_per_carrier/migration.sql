-- AlterTable
ALTER TABLE "FactoringCompany" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "FactoringCompany_companyId_idx" ON "FactoringCompany"("companyId");

-- AddForeignKey
ALTER TABLE "FactoringCompany" ADD CONSTRAINT "FactoringCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
