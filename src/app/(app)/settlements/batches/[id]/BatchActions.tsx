'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  deleteBatchAction,
  finaliseBatchAction,
  markBatchPaidAction,
  refreshBatchAction,
  type BatchState,
} from '../actions'

const INITIAL: BatchState = { error: null, blocked: [] }

interface Props {
  batchId: string
  status: string
  /** False while any driver blocks — the button says why rather than hiding. */
  canFinalise: boolean
  /**
   * Every statement Unposted or Void (`deletableBatch`); the server decides.
   * Absent where the caller offers no Delete (the payroll week strip).
   */
  canDelete?: boolean
  /** The role may delete (`delete settlement`), as on the Batches list. */
  mayDelete?: boolean
  labels: {
    refresh: string
    finalise: string
    markPaid: string
    delete?: string
  }
}

/**
 * The header's verbs (§6.2.10 part 7 step 3).
 *
 * POST ALL UNPOSTED WHILE ANY STATEMENT IS UNPOSTED — a PARTIAL batch as well
 * as a DRAFT, because `finaliseBatch` posts every draft still on it. It stays
 * visible while blocked, disabled, because the blockers are listed directly
 * under it: a button that disappeared would leave a person reading a list of
 * problems with nothing saying what it is preventing. The action re-checks the
 * blockers server-side regardless.
 *
 * DELETE WHILE NOTHING IS POSTED (R6). Offered when every statement is
 * Unposted or Void; `deleteBatch` refuses by name otherwise, and success lands
 * on the Batches list.
 */
export function BatchActions({
  batchId,
  status,
  canFinalise,
  canDelete = false,
  mayDelete = false,
  labels,
}: Props) {
  const [refreshState, refresh, refreshing] = useActionState(
    refreshBatchAction.bind(null, batchId),
    INITIAL,
  )
  const [finalState, finalise, finalising] = useActionState(
    finaliseBatchAction.bind(null, batchId),
    INITIAL,
  )
  const [paidState, markPaid, marking] = useActionState(
    markBatchPaidAction.bind(null, batchId),
    INITIAL,
  )
  const [deleteState, remove, deleting] = useActionState(
    deleteBatchAction.bind(null, batchId),
    INITIAL,
  )

  const error =
    refreshState.error ??
    finalState.error ??
    paidState.error ??
    deleteState.error
  const open = status === 'DRAFT' || status === 'PARTIAL'

  return (
    <div className="flex flex-col gap-z2">
      <div className="flex flex-wrap items-center gap-z2">
        {open ? (
          <>
            <form action={refresh}>
              <Button type="submit" variant="secondary" disabled={refreshing}>
                {labels.refresh}
              </Button>
            </form>
            <form action={finalise}>
              <Button
                type="submit"
                variant="primary"
                disabled={!canFinalise || finalising}
                aria-disabled={!canFinalise}
              >
                {labels.finalise}
              </Button>
            </form>
          </>
        ) : null}

        {status === 'FINAL' ? (
          <form action={markPaid}>
            <Button type="submit" variant="primary" disabled={marking}>
              {labels.markPaid}
            </Button>
          </form>
        ) : null}

        {canDelete && mayDelete && labels.delete ? (
          <form action={remove} className="ms-auto">
            <Button type="submit" variant="secondary" disabled={deleting}>
              {labels.delete}
            </Button>
          </form>
        ) : null}
      </div>

      {finalState.blocked.length > 0 ? (
        <ul className="flex flex-col gap-z1 text-xs text-danger">
          {finalState.blocked.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
