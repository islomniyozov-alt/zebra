-- ----------------------------------------------------------------------------
-- EMAIL-IN (Phase 6 §4 step 4).
--
-- A booking email that arrived at the tenant's load inbox, and NOT a Load in a
-- draft state. Adding DRAFT to "LoadOperationalStatus" would put unconfirmed,
-- machine-read freight into every query that already exists — the dispatch
-- board, ready-to-invoice, settlement lines, the load-number counter — and
-- every one would have to learn to exclude it. One forgotten filter and a
-- draft nobody has read is on an invoice.
--
-- Written by hand rather than generated. Prisma 7's `migrate diff` no longer
-- takes `--shadow-database-url`, and the RLS block below has always been
-- hand-added anyway: `prisma migrate` does not know this schema's first rule.
-- ----------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "InboundEmailState" AS ENUM ('READY', 'REVIEW', 'CONFLICT', 'CONFIRMED', 'DISMISSED');

-- AlterTable: which tenant an inbound email belongs to. UNIQUE because two
-- organizations claiming one address is freight delivered to whichever row the
-- query happened to find first.
ALTER TABLE "Organization" ADD COLUMN "inboundAddress" TEXT;
CREATE UNIQUE INDEX "Organization_inboundAddress_key" ON "Organization"("inboundAddress");

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawR2Key" TEXT,
    "rawBytes" INTEGER,
    "bodyText" TEXT,
    "ocrStatus" "OcrStatus" NOT NULL DEFAULT 'NOT_QUEUED',
    "ocrText" TEXT,
    "extractedJson" JSONB,
    "ocrError" TEXT,
    "state" "InboundEmailState" NOT NULL DEFAULT 'REVIEW',
    "concerns" JSONB,
    "loadId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "dismissedReason" TEXT,
    "handledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- The mail system's own idempotency key. Cloudflare can deliver one message
-- more than once, and Amazon sends a booking, an update and a final
-- confirmation in one thread — the first repeat is a duplicate to ignore, the
-- others are new mail about the same load with their own Message-ID.
CREATE UNIQUE INDEX "InboundEmail_messageId_key" ON "InboundEmail"("messageId");
CREATE INDEX "InboundEmail_organizationId_state_receivedAt_idx" ON "InboundEmail"("organizationId", "state", "receivedAt");
CREATE INDEX "InboundEmail_organizationId_receivedAt_idx" ON "InboundEmail"("organizationId", "receivedAt");

-- AlterTable: spec §12 wants the original openable from the load.
ALTER TABLE "Document" ADD COLUMN "inboundEmailId" TEXT;
CREATE INDEX "Document_inboundEmailId_idx" ON "Document"("inboundEmailId");

-- AddForeignKey
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_handledByUserId_fkey" FOREIGN KEY ("handledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_inboundEmailId_fkey" FOREIGN KEY ("inboundEmailId") REFERENCES "InboundEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY.
--
-- This table is the one place freight enters the building with NO DISPATCHER
-- PRESENT — nobody chose the tenant, a mail server did. The policy is what
-- makes "the recipient address decides the organization" a claim the database
-- enforces rather than a claim the code makes.
-- ----------------------------------------------------------------------------

ALTER TABLE "InboundEmail" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEmail" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "InboundEmail"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ALTER DEFAULT PRIVILEGES in the RLS migration already grants zebra_app on new
-- tables, but only for tables created by the same role. Stated explicitly so
-- this does not depend on who ran the migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON "InboundEmail" TO zebra_app;
