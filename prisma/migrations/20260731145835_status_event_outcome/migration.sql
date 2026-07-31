-- CreateEnum
CREATE TYPE "StatusOutcome" AS ENUM ('APPLIED', 'REFUSED_STALE');

-- AlterTable
ALTER TABLE "LoadStatusEvent" ADD COLUMN     "outcome" "StatusOutcome" NOT NULL DEFAULT 'APPLIED';
