'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { changeStatusAction } from './bulk-actions'
import { BULK_INITIAL } from './bulk-state'

interface Props {
  /** The server-rendered grid, checkboxes and all. */
  children: ReactNode
  labels: {
    selected: string
    finalise: string
    markPaid: string
    clear: string
    blocked: string
    done: string
  }
  /** Refusal sentences, already translated — a client cannot call `t`. */
  reasons: Record<string, string>
}

/**
 * The form around the batches grid, and the bar that appears once something is
 * ticked (§7.1: "bulk selection raises a floating action bar over the table
 * foot, showing the count and only the actions valid for the whole selection").
 *
 * ── THE GRID IS `children`, SERVER-RENDERED ───────────────────────────────
 *
 * This is a client component wrapping server output, not a client grid. The
 * table, its sorting links and its column funnels stay on the server; what is
 * client here is the count, which needs a change listener, and the submit.
 *
 * ── THE COUNT COMES FROM THE DOM, NOT FROM STATE PER ROW ──────────────────
 *
 * Holding a selection in React state would mean lifting every row's identity
 * into this component and keeping it in step with a server-rendered body that
 * re-renders on every sort, filter and page. The checkboxes ARE the state —
 * they are form fields, they post themselves, and counting them on change is one
 * line that cannot drift from what will be submitted.
 *
 * ── BOTH BUTTONS ARE ALWAYS OFFERED, AND THE SERVER DECIDES ───────────────
 *
 * A selection can mix DRAFT and FINAL batches, and hiding Mark paid because one
 * of five is a draft would leave somebody unable to act on the other four.
 * `finaliseBatch` and `markBatchPaid` refuse per batch and the refusals come
 * back by name — which is more useful than a disabled button that says nothing.
 */
export function BulkStatus({ children, labels, reasons }: Props) {
  const [count, setCount] = useState(0)
  const [finalState, finalise, finalising] = useActionState(
    changeStatusAction.bind(null, 'finalise'),
    BULK_INITIAL,
  )
  const [paidState, markPaid, marking] = useActionState(
    changeStatusAction.bind(null, 'markPaid'),
    BULK_INITIAL,
  )

  const state =
    finalState.changed + finalState.refusals.length > 0 ? finalState : paidState
  const busy = finalising || marking

  const recount = (form: HTMLFormElement | null) => {
    if (!form) return
    setCount(
      form.querySelectorAll<HTMLInputElement>('input[name="batch"]:checked')
        .length,
    )
  }

  return (
    <form
      onChange={(event) => recount(event.currentTarget)}
      className="contents"
    >
      {children}

      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-z2 border-t border-border-strong bg-accent-soft px-gutter py-z2">
          <span className="text-xs font-medium text-accent">
            {count} {labels.selected}
          </span>
          <Button
            type="submit"
            formAction={finalise}
            variant="primary"
            size="compact"
            disabled={busy}
          >
            {labels.finalise}
          </Button>
          <Button
            type="submit"
            formAction={markPaid}
            variant="secondary"
            size="compact"
            disabled={busy}
          >
            {labels.markPaid}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            onClick={(event) => {
              const form = event.currentTarget.closest('form')
              form
                ?.querySelectorAll<HTMLInputElement>('input[name="batch"]')
                .forEach((box) => {
                  box.checked = false
                })
              setCount(0)
            }}
          >
            {labels.clear}
          </Button>
        </div>
      ) : null}

      {/* ── WHAT HAPPENED, BY NAME ─────────────────────────────────────────
       *
       * Not "3 of 5 changed". Two weeks of driver pay not happening is a fact
       * about WHICH two, and a blocked batch is blocked BY somebody the reader
       * has to go and fix. */}
      {state.refusals.length > 0 ? (
        <div
          className="border-t border-danger bg-danger-soft px-gutter py-z3"
          role="alert"
        >
          <p className="text-sm font-medium text-danger">{labels.blocked}</p>
          <ul className="mt-z1 flex flex-col gap-z1 text-xs text-ink">
            {state.refusals.map((refusal) => (
              <li key={refusal.batch}>
                <span className="font-mono font-medium" dir="ltr">
                  {refusal.batch}
                </span>{' '}
                — {reasons[refusal.reason] ?? refusal.reason}
                {refusal.blockedBy.length > 0
                  ? `: ${refusal.blockedBy.join(', ')}`
                  : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.changed > 0 ? (
        <p className="border-t border-border bg-success-soft px-gutter py-z2 text-xs text-success">
          {labels.done} {state.changed}
        </p>
      ) : null}
    </form>
  )
}
