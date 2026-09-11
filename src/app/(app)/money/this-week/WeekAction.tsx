'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import {
  markWeekPaidAction,
  openBatchForWeekAction,
  type MoneyWeekState,
} from './actions'

const INITIAL: MoneyWeekState = { error: null }

interface Props {
  batchId: string | null
  action: 'open' | 'continue' | 'markPaid' | 'none'
  labels: {
    open: string
    continueDraft: string
    markPaid: string
    settled: string
  }
}

/**
 * ONE ACTION, AND ONLY THE ONE THE STATE ALLOWS.
 *
 * Not four buttons with three greyed out: the question this screen answers is
 * "what do I do next", and offering the other three as disabled controls turns
 * a one-word answer into a thing to read. A PAID week offers nothing at all and
 * says so.
 *
 * `Continue draft` is a LINK, not an action — the draft already exists and the
 * work is on the batch screen.
 */
export function WeekAction({ batchId, action, labels }: Props) {
  // NO COMPANY. Settlement is org-wide by ruling: one batch for the period,
  // covering every authority, so there is nothing to scope the button to.
  const [openState, open, opening] = useActionState(
    openBatchForWeekAction,
    INITIAL,
  )
  const [paidState, markPaid, marking] = useActionState(
    markWeekPaidAction.bind(null, batchId ?? ''),
    INITIAL,
  )

  const error = openState.error ?? paidState.error

  return (
    <div className="flex flex-col gap-z1">
      {action === 'open' ? (
        <form action={open}>
          <Button
            type="submit"
            variant="primary"
            size="compact"
            disabled={opening}
          >
            {labels.open}
          </Button>
        </form>
      ) : null}

      {action === 'continue' && batchId ? (
        <Link
          href={`/settlements/batches/${batchId}`}
          className="text-sm underline underline-offset-2 hover:text-accent"
        >
          {labels.continueDraft}
        </Link>
      ) : null}

      {action === 'markPaid' && batchId ? (
        <form action={markPaid}>
          <Button
            type="submit"
            variant="primary"
            size="compact"
            disabled={marking}
          >
            {labels.markPaid}
          </Button>
        </form>
      ) : null}

      {action === 'none' ? (
        <p className="text-sm text-ink-3">{labels.settled}</p>
      ) : null}

      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
