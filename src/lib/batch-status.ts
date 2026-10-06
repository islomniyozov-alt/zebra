import type { Prisma, SettlementBatchStatus } from '@/generated/prisma/client'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// A BATCH'S STATUS IS DERIVED FROM ITS STATEMENTS. NEVER SET BY HAND (§6.2.10 §3).
//
//   none approved                 → DRAFT
//   some approved or paid, not all → PARTIAL
//   all approved                  → FINAL
//   all paid                      → PAID
//
// `PARTIAL` is the state the office actually works in — finalising is per
// statement — and the one the enum could not express until migration 62.
//
// ── WHY DERIVED, AND WHY IN THE SAME TRANSACTION ─────────────────────────
//
// Two places could write the batch's status: the batch button and the
// statements grid's bulk bar. Two writers of one column is how a list ends up
// saying FINAL above a statement that is still DRAFT. One pure function, called
// after every change that can move the answer, means the list and the
// statements cannot disagree for an instant somebody could press a button in.
//
// ── VOID IS NOT A VOTE ──────────────────────────────────────────────────
//
// A voided statement is one the office struck; it neither holds a batch in
// DRAFT nor counts towards FINAL. A batch whose every statement is void is
// DRAFT, because there is nothing issued in it.
// ---------------------------------------------------------------------------

export type StatementVote = 'DRAFT' | 'APPROVED' | 'PAID' | 'VOID'

/** The derivation, pure, so it can be watched failing without a database. */
export function deriveBatchStatus(
  statuses: readonly StatementVote[],
): SettlementBatchStatus {
  const live = statuses.filter((status) => status !== 'VOID')
  if (live.length === 0) return 'DRAFT'
  const paid = live.filter((status) => status === 'PAID').length
  const issued = live.filter((status) => status !== 'DRAFT').length
  if (paid === live.length) return 'PAID'
  if (issued === live.length) return 'FINAL'
  if (issued === 0) return 'DRAFT'
  return 'PARTIAL'
}

/**
 * Recompute one batch's status from its statements and write it, stamping the
 * transition into FINAL or PAID with when and who.
 *
 * IDEMPOTENT. Called after an approve, a pay, a refresh and a finalise; calling
 * it twice writes the same answer and stamps nothing a second time, because the
 * stamps are set only when the status actually changes INTO the stamped state.
 *
 * `byUserId` is who caused the change that led here — the person who approved
 * the last statement is who finalised the batch, even though they pressed a
 * button on a statement.
 */
export async function syncBatchStatus(
  tx: TxClient,
  batchId: string,
  byUserId: string | null,
): Promise<SettlementBatchStatus> {
  const batch = await tx.settlementBatch.findFirst({
    where: { id: batchId, deletedAt: null },
    select: { status: true },
  })
  if (!batch) return 'DRAFT'

  const rows = await tx.settlement.findMany({
    where: { batchId },
    select: { status: true },
  })
  const next = deriveBatchStatus(rows.map((row) => row.status))
  if (next === batch.status) return next

  const now = new Date()
  await tx.settlementBatch.update({
    where: { id: batchId },
    data: {
      status: next,
      // THE STAMPS FOLLOW THE TRANSITION, WHICHEVER PATH CAUSED IT — the last
      // single approve or the batch button. A batch that falls back out of
      // FINAL (a statement voided and redrafted) keeps its old stamp, because
      // the fact that it was finalised once is history, not a flag.
      ...(next === 'FINAL' && batch.status !== 'FINAL'
        ? { finalizedAt: now, finalizedByUserId: byUserId }
        : {}),
      ...(next === 'PAID' && batch.status !== 'PAID'
        ? { paidAt: now, paidByUserId: byUserId }
        : {}),
    },
  })
  return next
}
