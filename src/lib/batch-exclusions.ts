import type { Prisma } from '@/generated/prisma/client'
import { refreshDraft } from './settlement-batch'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// TAKING A TRIP OUT OF A DRAFT, AND PUTTING IT BACK (§6.2.10 part 2).
//
// ── AN EXCLUSION SET, AND WHY IT IS THE WAY ROUND IT IS ──────────────────
//
// Owner's ruling, 2026-10-05. A draft is everything settleable in the week MINUS
// these rows. Storing what was PICKED cannot tell "nobody chose this trip" from
// "this trip arrived after they chose", so a recompute either erases a decision
// or silently drops freight from somebody's pay. Stored as exclusions it is
// monotonic: a refresh can only ever ADD.
//
// So there are two verbs and they are not symmetrical in spirit, even though they
// look it here: excluding is the office declining a trip, and including is the
// office CHANGING ITS MIND. Nothing else may un-exclude — `refreshDraft` reads
// these rows and never writes them.
//
// ── EVERY CHANGE RECOMPUTES THE DRAFT, IN THE SAME TRANSACTION ───────────
//
// A batch whose exclusions and whose statements disagree is a batch that is
// wrong on screen, and the window between the two writes is exactly when
// somebody presses Finalise. `refreshDraft` is called here rather than left to
// the caller, because "remember to refresh" is a rule that gets forgotten once.
// ---------------------------------------------------------------------------

export type ExclusionFailure =
  | { kind: 'not_found' }
  /** Only a DRAFT may change. FINAL is a document. */
  | { kind: 'not_draft'; status: string }
  | { kind: 'no_trips' }

export type ExclusionOutcome =
  | { ok: true; changed: number; excluded: number }
  | { ok: false; reason: ExclusionFailure }

async function draftOrRefusal(tx: TxClient, batchId: string) {
  const batch = await tx.settlementBatch.findFirst({
    where: { id: batchId, deletedAt: null },
    select: { id: true, organizationId: true, status: true },
  })
  if (!batch)
    return { ok: false as const, reason: { kind: 'not_found' as const } }
  if (batch.status !== 'DRAFT' && batch.status !== 'PARTIAL') {
    // A FINAL or PAID batch is a document. Changing what is in it would rewrite
    // what somebody was paid, which is the one thing FINAL means. PARTIAL is
    // still open: an exclusion only ever affects the drafts, because a trip on
    // an approved statement is not settleable and never re-enters the rebuild.
    return {
      ok: false as const,
      reason: { kind: 'not_draft' as const, status: batch.status },
    }
  }
  return { ok: true as const, batch }
}

/** How many trips this batch currently declines. */
export async function countExclusions(
  tx: TxClient,
  batchId: string,
): Promise<number> {
  return tx.settlementBatchExclusion.count({ where: { batchId } })
}

/** The trips this batch declines, as ids — what a screen ticks against. */
export async function excludedLoadIds(
  tx: TxClient,
  batchId: string,
): Promise<string[]> {
  const rows = await tx.settlementBatchExclusion.findMany({
    where: { batchId },
    select: { loadId: true },
  })
  return rows.map((row) => row.loadId)
}

/**
 * Take trips out of a draft.
 *
 * IDEMPOTENT BY THE UNIQUE INDEX. Unticking an already-unticked trip changes
 * nothing and is not an error — a double-posted form must not refuse half way
 * through a money write.
 */
export async function excludeTrips(
  tx: TxClient,
  input: {
    batchId: string
    loadIds: readonly string[]
    byUserId: string | null
    reason?: string | null
  },
): Promise<ExclusionOutcome> {
  const ids = [...new Set(input.loadIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return { ok: false, reason: { kind: 'no_trips' } }

  const found = await draftOrRefusal(tx, input.batchId)
  if (!found.ok) return found

  const written = await tx.settlementBatchExclusion.createMany({
    data: ids.map((loadId) => ({
      organizationId: found.batch.organizationId,
      batchId: input.batchId,
      loadId,
      excludedByUserId: input.byUserId,
      reason: input.reason ?? null,
    })),
    skipDuplicates: true,
  })

  await refreshDraft(tx, input.batchId)
  return {
    ok: true,
    changed: written.count,
    excluded: await countExclusions(tx, input.batchId),
  }
}

/**
 * Put trips back — the office changing its mind.
 *
 * THE ONLY WAY A TRIP IS EVER UN-EXCLUDED, and it is deliberate by construction:
 * somebody ticked a box. "Select all available" and "Add N trips" are both this
 * function with different arguments, which is what makes those two controls read
 * naturally on top of an exclusion set.
 *
 * `loadIds` undefined means ALL of them — Select all available.
 */
export async function includeTrips(
  tx: TxClient,
  input: { batchId: string; loadIds?: readonly string[] },
): Promise<ExclusionOutcome> {
  const found = await draftOrRefusal(tx, input.batchId)
  if (!found.ok) return found

  const ids = input.loadIds ? [...new Set(input.loadIds)] : null
  if (ids !== null && ids.length === 0) {
    return { ok: false, reason: { kind: 'no_trips' } }
  }

  const removed = await tx.settlementBatchExclusion.deleteMany({
    where: {
      batchId: input.batchId,
      ...(ids === null ? {} : { loadId: { in: ids } }),
    },
  })

  await refreshDraft(tx, input.batchId)
  return {
    ok: true,
    changed: removed.count,
    excluded: await countExclusions(tx, input.batchId),
  }
}
