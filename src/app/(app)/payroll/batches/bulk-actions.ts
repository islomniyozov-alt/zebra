'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import {
  deleteBatch,
  finaliseBatch,
  markBatchPaid,
  SETTLEMENT_BATCH_TIMEOUT_MS,
} from '@/lib/settlement-batch'
import type { BulkRefusal, BulkState } from './bulk-state'
import type { MessageKey } from '@/lib/i18n'

// PAYROLL → BATCHES: act on a selection (§6.2.1, owner's ruling 2026-09-28;
// §6.2.10 part 7, 2026-11-17).
//
// ── THREE ACTS, AND NO "CHANGE STATUS" (part 7, R7) ──────────────────────
//
// Post all unposted (`finaliseBatch`), Mark paid (`markBatchPaid`) and Delete
// (`deleteBatch`, Unposted batches only). A batch's status is derived from its
// statements and is never set by hand, so there is no control that sets one —
// each act changes statements and the status follows.
//
// ── PER BATCH, THROUGH THE SAME TWO FUNCTIONS, BLOCKERS INTACT ────────────
//
// `finaliseBatch` refreshes the draft, recomputes the blockers and refuses a
// batch that has any. `markBatchPaid` checks the transition. This loops them; it
// does not reimplement them, and it has no fast path.
//
// THAT IS THE WHOLE SAFETY ARGUMENT. A bulk route that gathered ids and wrote
// `status = 'FINAL'` would be a way to finalise a blocked week from a checkbox —
// a driver with no pay rule paid nothing, silently, because the screen that
// names them was never consulted. Every check a single Finalise makes, a bulk
// Finalise makes too, once per batch.
//
// ── REFUSALS ARE REPORTED BY NAME, NOT COUNTED ────────────────────────────
//
// "3 of 5 changed" tells somebody that two weeks of driver pay did not happen
// and not which. Each refusal carries the batch as the reader knows it and, for
// a blocker, the drivers responsible — the same names the Tuesday strip shows.
//
// ── ONE TRANSACTION PER BATCH, DELIBERATELY ───────────────────────────────
//
// Not one around the selection. Finalising allocates statement numbers, moves
// escrow and writes events; five of those in one transaction is minutes of lock
// on tables the rest of the application reads, and a failure on the fifth would
// roll back four runs somebody has already been told about. Partial success is
// the honest outcome here, which is why the refusals are named.

const REASON: Record<string, MessageKey> = {
  not_found: 'batch.error.notFound',
  not_draft: 'batch.error.notDraft',
  not_a_week: 'batch.error.notAWeek',
  blocked: 'batch.blockers',
  period_taken: 'batch.error.notAWeek',
  posted: 'batch.error.posted',
  // `finaliseBatch` holds a stored period to `isBatchPeriod` (part 7, R1).
  bad_range: 'batch.error.badRange',
}

/** The permission each act needs: deleting is `delete`, the other two `update`. */
const NEEDS = {
  finalise: 'update',
  markPaid: 'update',
  delete: 'delete',
} as const

export async function batchBulkAction(
  intent: 'finalise' | 'markPaid' | 'delete',
  _previous: BulkState,
  formData: FormData,
): Promise<BulkState> {
  const ids = formData.getAll('batch').map(String).filter(Boolean)
  if (ids.length === 0) return { changed: 0, refusals: [] }

  let changed = 0
  const refusals: BulkRefusal[] = []

  for (const id of ids) {
    // A TRANSACTION EACH. See the header — one around all of them would hold
    // locks for minutes and undo runs that had already succeeded.
    const outcome = await withCurrentOrg(
      NEEDS[intent],
      'settlement',
      async (tx, session) => {
        const batch = await tx.settlementBatch.findFirst({
          where: { id, deletedAt: null },
          select: { batchNumber: true },
        })
        const name = batch?.batchNumber ?? id.slice(0, 8)

        const result =
          intent === 'finalise'
            ? await finaliseBatch(tx, id, session.userId)
            : intent === 'markPaid'
              ? await markBatchPaid(tx, id, session.userId)
              : await deleteBatch(tx, id)

        if (result.ok) return { name, refusal: null }

        return {
          name,
          refusal: {
            batch: name,
            reason: REASON[result.reason.kind] ?? 'batch.error.notAWeek',
            // THE DRIVERS, BY NAME. A blocked batch is blocked BY somebody, and
            // the whole reason this is not a count is that the reader has to
            // know who to go and fix.
            blockedBy:
              result.reason.kind === 'blocked'
                ? result.reason.blockers.map((row) => row.driverName)
                : [],
          } satisfies BulkRefusal,
        }
      },
      { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
    )

    if (outcome.refusal === null) changed += 1
    else refusals.push(outcome.refusal)
  }

  revalidatePath('/payroll/batches')
  return { changed, refusals }
}
