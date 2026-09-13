-- A document that has been replaced by a better copy of itself.
-- Owner's ruling, 2026-09-13.
--
-- ── WHY A LINK AND NOT A STATUS CHANGE ───────────────────────────────────
--
-- Rotate-and-read stores the turned card as a NEW object and leaves the
-- original untouched, because a document is evidence and retention is
-- statutory. That left the parked original flagged "not read — needs rotation"
-- for ever, nagging about work somebody had already done.
--
-- Changing its `ocrStatus` would be the easy fix and the wrong one: it would
-- assert something about a READING that never happened to those bytes. What is
-- true is narrower and is what this records — there is now a better copy, and
-- here it is. The original keeps its own history intact.
--
-- SELF-REFERENTIAL, AND NULLABLE FOR EVERY ROW THAT EXISTS. Nothing is
-- backfilled: no document before today was superseded by anything.
--
-- ON DELETE SET NULL rather than RESTRICT. If a replacement is ever hard
-- deleted — which this schema does not do, but the constraint outlives that
-- promise — the original must revert to un-superseded rather than pin a row
-- nobody can remove. Losing the pointer is recoverable; a document that cannot
-- be deleted because something points at it is not.
ALTER TABLE "Document" ADD COLUMN "supersededByDocumentId" TEXT;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_supersededByDocumentId_fkey"
  FOREIGN KEY ("supersededByDocumentId") REFERENCES "Document"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The question the driver's document list asks of every row it draws.
CREATE INDEX "Document_supersededByDocumentId_idx"
  ON "Document"("supersededByDocumentId");
