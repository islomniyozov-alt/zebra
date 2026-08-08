-- AlterTable
ALTER TABLE "PendingUpload" ADD COLUMN     "extractedJson" JSONB,
ADD COLUMN     "ocrError" TEXT,
ADD COLUMN     "ocrStatus" "OcrStatus" NOT NULL DEFAULT 'NOT_QUEUED',
ADD COLUMN     "ocrText" TEXT,
ALTER COLUMN "targetEntity" DROP NOT NULL,
ALTER COLUMN "targetId" DROP NOT NULL;


-- ----------------------------------------------------------------------------
-- A TARGET IS ALL OF IT OR NONE OF IT.
--
-- `targetEntity` and `targetId` became nullable together so that upload-first
-- create can mint before the load exists (Phase 5 §1.5). One without the other
-- is a mint that confirm would either attach to nothing or attach to a record
-- it cannot name — and confirm reads the pair, so a half-set row would fail
-- there instead of here, one step further from the mistake.
--
-- Prisma cannot express "these two agree about being null".
-- ----------------------------------------------------------------------------

ALTER TABLE "PendingUpload"
  ADD CONSTRAINT "pending_target_is_whole"
  CHECK (num_nonnulls("targetEntity", "targetId") <> 1);
