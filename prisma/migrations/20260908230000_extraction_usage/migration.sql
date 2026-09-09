-- WHAT ONE EXTRACTION COST, AS A ROW.
--
-- ── A LEDGER, NOT A COLUMN ON `Document` ──────────────────────────────────
--
-- The owner's ruling, and the convenient shape is the wrong one twice over.
-- A column on `Document` would tie a cost to an artefact that need not exist:
-- the CDL and the medical card are read BEFORE anything is filed — that is the
-- whole point of the confirm-then-file flow — so most reads have no document
-- to hang a number on. And it would inherit `Document`'s lifecycle, where
-- deleting a document silently deletes its cost. A ledger that can be edited
-- by tidying up is not a ledger.
--
-- WHAT IT REPLACES: nothing. Until this table there was no measured cost for a
-- CDL or a medical read anywhere in this system — `askModel` returned `usage`
-- on every call and both readers dropped it. The rate confirmation's figure
-- survived only because a walkthrough printed a total and somebody copied it
-- into a markdown file. "What did extraction cost last month" was not a
-- question this database could answer.
--
-- ── ONE ROW PER CALL TO AN ENGINE, REFUSALS INCLUDED ──────────────────────
--
-- A read whose answer the rules rejected is a BILLED read. Counting only the
-- accepted ones would understate the bill by exactly the refusal rate, which
-- is the number anybody changing a prompt is trying to move — so `refused` and
-- `reason` are columns rather than a reason to skip the insert.
--
-- ── TOKENS AND MONEY, BOTH, ON PURPOSE ────────────────────────────────────
--
-- `milliCents` is arithmetic over `MODEL_PRICES`, a constant copied from a
-- price list on a date, and it goes stale the day a published price moves. The
-- token counts are the measured half and stay true, so a re-pricing is a query
-- rather than a loss.
CREATE TABLE "ExtractionUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "model" TEXT NOT NULL,
    "askedModel" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "milliCents" INTEGER NOT NULL,
    "refused" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionUsage_pkey" PRIMARY KEY ("id")
);

-- The shape of the only question this table exists to answer: what did a
-- tenant spend over a period, and how does that split by document type.
CREATE INDEX "ExtractionUsage_organizationId_createdAt_idx"
  ON "ExtractionUsage"("organizationId", "createdAt");
CREATE INDEX "ExtractionUsage_organizationId_documentType_createdAt_idx"
  ON "ExtractionUsage"("organizationId", "documentType", "createdAt");

-- CASCADE FROM Organization AND FROM NOTHING ELSE. Deleting a tenant removes
-- its ledger, which is right — there is no customer left to bill. There is
-- deliberately no key to `Document` or `Driver`: a cascade from either would
-- delete cost history when somebody removed an unrelated row, and a ledger
-- with holes reads as a smaller bill.
ALTER TABLE "ExtractionUsage" ADD CONSTRAINT "ExtractionUsage_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- THE TENANT WALL.
--
-- It carries its own organizationId, so it takes the ordinary policy and needs
-- no trigger — the same arrangement `CustomerAlias` and `ExtractionCorrection`
-- got in 20260808191602.
--
-- WORTH PAUSING ON, BECAUSE THIS TABLE IS ABOUT MONEY BETWEEN TENANTS. A leak
-- here would not show a wrong load or a wrong driver; it would let one carrier
-- read what another carrier costs to serve, which is commercial information
-- about a third party and the input to what they are charged.
-- ----------------------------------------------------------------------------

ALTER TABLE "ExtractionUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExtractionUsage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "ExtractionUsage"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ALTER DEFAULT PRIVILEGES in the RLS migration already grants zebra_app on new
-- tables, but only for tables created by the same role. Stated explicitly so
-- this does not depend on who ran the migration — and `src/lib/grant-rule.ts`
-- asserts exactly these four verbs on every table in the schema.
GRANT SELECT, INSERT, UPDATE, DELETE ON "ExtractionUsage" TO zebra_app;
