'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import {
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
  labels: { refresh: string; finalise: string; markPaid: string }
}

/**
 * DRAFT -> FINAL -> PAID, and nothing in between.
 *
 * FINALISE STAYS VISIBLE WHILE BLOCKED, disabled, because the blockers are
 * listed directly above it: a button that disappeared would leave a person
 * reading a list of problems with nothing saying what it is preventing.
 *
 * The action re-checks the blockers server-side regardless. A draft refreshed
 * an hour ago and finalised now may have grown a driver with no pay rule, and
 * the button that was enabled then would still be enabled.
 */
export function BatchActions({ batchId, status, canFinalise, labels }: Props) {
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

  const error = refreshState.error ?? finalState.error ?? paidState.error

  return (
    <div className="flex flex-col gap-z2">
      <div className="flex flex-wrap items-center gap-z2">
        {status === 'DRAFT' ? (
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
