import type { DocumentType } from '@/generated/prisma/client'
import type { ReadCost } from './claude'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// THE PER-TENANT COST LEDGER FOR EVERYTHING THIS SYSTEM READS.
//
// ── WHY A TABLE AND NOT A LOG LINE ────────────────────────────────────────
//
// Before this, the cost of a CDL or a medical read existed nowhere: `askModel`
// returned `usage` on every call and both readers dropped it. The rate
// confirmation's number survived only because a walkthrough printed a total
// and somebody copied it into `EXTRACTION-CONTRACT.md`. That answers "what did
// one run of thirteen documents cost in August" and nothing else — not per
// tenant, not per month, not per document type, and not without a person.
//
// ── ONE ROW PER ENGINE CALL, REFUSALS INCLUDED ────────────────────────────
//
// `recordExtractionUsage` is called on the accepted branch and on every
// refusal that reached an engine. A refused read is billed exactly like an
// accepted one, and a ledger that counted only successes would understate by
// the refusal rate — which is the number a prompt change is trying to move, so
// it is the last thing that should be invisible in the cost.
//
// ── IT NEVER FAILS THE READ ───────────────────────────────────────────────
//
// Bookkeeping that can break the thing it is measuring is worse than no
// bookkeeping. A dispatcher holding a medical card does not care that the
// ledger is down, so the caller wraps this and swallows what it throws — see
// `recordUsageQuietly`. That is a deliberate asymmetry: the money in this
// table is OURS, and losing a row costs a cent of accounting; refusing the
// upload costs a person their afternoon.
//
// DOMAIN LOGIC LIVES HERE, NOT IN THE ROUTE — the standing rule. A route reads
// the request, calls one function, and answers.
// ---------------------------------------------------------------------------

export interface ExtractionUsageInput {
  /** Which reader was called, in the vocabulary `Document` already speaks. */
  documentType: DocumentType
  /** What the engine reported and what it was priced at. */
  cost: ReadCost
  /** Set when the rules rejected the answer these tokens bought. */
  refused?: string | null
}

/**
 * Write one row of the ledger.
 *
 * TAKES THE COST RATHER THAN COMPUTING IT. `readCostOf` already priced the
 * answer at the model that ANSWERED, which is the only correct price when a
 * fallback happened — pricing here would need the same fact and would be a
 * second place that could get it wrong.
 */
export async function recordExtractionUsage(
  tx: TxClient,
  organizationId: string,
  input: ExtractionUsageInput,
): Promise<void> {
  await tx.extractionUsage.create({
    data: {
      organizationId,
      documentType: input.documentType,
      model: input.cost.model,
      // ONLY ON A FALLBACK. `fellBackFrom` names who was ASKED when somebody
      // else answered; on an ordinary call the two are the same string and
      // storing it twice would make "how often did we fall back" a comparison
      // instead of a filter.
      askedModel: input.cost.fellBackFrom?.model ?? null,
      inputTokens: input.cost.usage.inputTokens,
      outputTokens: input.cost.usage.outputTokens,
      cacheWriteTokens: input.cost.usage.cacheWriteTokens ?? 0,
      cacheReadTokens: input.cost.usage.cacheReadTokens ?? 0,
      milliCents: input.cost.milliCents,
      refused: Boolean(input.refused),
      reason: input.refused ?? null,
    },
  })
}

/**
 * What one tenant spent, over a period, by document type.
 *
 * THE QUESTION THE TABLE EXISTS FOR, written once so that a pricing decision
 * and a dashboard cannot compute it two ways. Both bounds are half-open —
 * `from` inclusive, `to` exclusive — so calling it for consecutive months
 * counts every row exactly once, which a closed upper bound does not.
 */
export async function extractionSpend(
  tx: TxClient,
  range: { from: Date; to: Date },
): Promise<
  {
    documentType: DocumentType
    reads: number
    refused: number
    inputTokens: number
    outputTokens: number
    milliCents: number
  }[]
> {
  const rows = await tx.extractionUsage.findMany({
    where: { createdAt: { gte: range.from, lt: range.to } },
    select: {
      documentType: true,
      refused: true,
      inputTokens: true,
      outputTokens: true,
      milliCents: true,
    },
  })

  const byType = new Map<
    DocumentType,
    {
      documentType: DocumentType
      reads: number
      refused: number
      inputTokens: number
      outputTokens: number
      milliCents: number
    }
  >()

  for (const row of rows) {
    const bucket = byType.get(row.documentType) ?? {
      documentType: row.documentType,
      reads: 0,
      refused: 0,
      inputTokens: 0,
      outputTokens: 0,
      milliCents: 0,
    }
    bucket.reads += 1
    if (row.refused) bucket.refused += 1
    bucket.inputTokens += row.inputTokens
    bucket.outputTokens += row.outputTokens
    bucket.milliCents += row.milliCents
    byType.set(row.documentType, bucket)
  }

  // Dearest first: the question behind the question is always which document
  // type is costing the money.
  return [...byType.values()].sort((a, b) => b.milliCents - a.milliCents)
}
