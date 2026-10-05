-- MIGRATION 62 — PAYROLL TAKES DATATRUCK'S SHAPE (§6.2.10, parts 1–3)
--
-- Three changes, one command for the owner: the company a batch settles, the
-- exclusion set behind the trip ticks, and the `PARTIAL` status.
--
-- ── HAND-WRITTEN, AND THE REASON MATTERS ──────────────────────────────────
--
-- `prisma migrate dev --create-only` generated these three changes AND eleven
-- more: five organizationId foreign keys moving from CASCADE to RESTRICT, three
-- indexes dropped (two of them not recreated), two dropped defaults on
-- `Settlement`, and three index renames. None of that is payroll. All of it is
-- PRE-EXISTING DRIFT between the committed schema and the dev database —
-- confirmed by reading the committed file, which declares neither
-- `@@index([batchId])` nor any `onDelete` on `SettlementLoadLine.organization`.
--
-- The drift is its own job (the owner queued it as such) and it is not a
-- passenger on a migration that touches how people are paid. Dropping an index
-- the batches screen reads, and changing what happens when an Organization is
-- deleted, are decisions somebody should make on purpose and rehearse on their
-- own. So this file carries payroll and nothing else, and the drift stays
-- visible and pending for the migration that addresses it deliberately.

-- ── 1. WHICH AUTHORITY A BATCH SETTLES, OR ALL OF THEM ─────────────────────
--
-- NULLABLE, and null means the whole organization — Islom's 2026-09-11 ruling
-- unchanged and still the default. Every existing batch becomes null, which is
-- exactly what every existing batch already was.
ALTER TABLE "SettlementBatch" ADD COLUMN "companyId" TEXT;

CREATE INDEX "SettlementBatch_organizationId_companyId_periodStart_idx" ON "SettlementBatch"("organizationId", "companyId", "periodStart");

-- RESTRICT, not CASCADE: deleting an authority that has been paid out must fail
-- loudly rather than quietly taking its batches with it.
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2. THE TRIPS THE OFFICE TOOK OUT OF A DRAFT ────────────────────────────
--
-- An EXCLUSION set, not a picked set (owner's ruling, 2026-10-05). A draft is
-- everything settleable in the week minus these rows, so a refresh can only ever
-- ADD freight and a decision cannot be undone by a recompute.
CREATE TABLE "SettlementBatchExclusion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "excludedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excludedByUserId" TEXT,
    "reason" TEXT,

    CONSTRAINT "SettlementBatchExclusion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SettlementBatchExclusion_organizationId_batchId_idx" ON "SettlementBatchExclusion"("organizationId", "batchId");

-- ONE ROW PER TRIP PER BATCH, so re-excluding is a no-op and the count on the
-- screen is the number of decisions rather than the number of clicks.
CREATE UNIQUE INDEX "SettlementBatchExclusion_batchId_loadId_key" ON "SettlementBatchExclusion"("batchId", "loadId");

ALTER TABLE "SettlementBatchExclusion" ADD CONSTRAINT "SettlementBatchExclusion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SettlementBatchExclusion" ADD CONSTRAINT "SettlementBatchExclusion_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SettlementBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SettlementBatchExclusion" ADD CONSTRAINT "SettlementBatchExclusion_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: the person who unticked the trip may leave the company,
-- and the decision outlives them. A cascade here would erase the answer to "who
-- took this off my statement".
ALTER TABLE "SettlementBatchExclusion" ADD CONSTRAINT "SettlementBatchExclusion_excludedByUserId_fkey" FOREIGN KEY ("excludedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. ROW-LEVEL SECURITY ON THE NEW TENANT TABLE ──────────────────────────
--
-- FORCE as well as ENABLE, because the table owner bypasses RLS otherwise and
-- the application connects as a role that would then see everything.
--
-- A POLICY IS NOT PROOF: tests/isolation-coverage.test.ts fails by name for any
-- tenant model the integration fixture never seeds, which is why this table gets
-- a fixture row in this same commit.
ALTER TABLE "SettlementBatchExclusion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SettlementBatchExclusion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "SettlementBatchExclusion"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ── 4. THE ENUM VALUE, LAST ────────────────────────────────────────────────
--
-- Postgres will not let a new enum value be USED in the same transaction that
-- adds it. Nothing above uses it, and the application only starts writing
-- PARTIAL after this migration has committed — the same ordering migration 61
-- used for DEDUCTION_TOLL.
ALTER TYPE "SettlementBatchStatus" ADD VALUE 'PARTIAL';
