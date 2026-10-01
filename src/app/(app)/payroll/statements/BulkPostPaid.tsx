'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { statementBulkAction } from './bulk-actions'
import { STATEMENT_BULK_INITIAL } from './bulk-state'

interface Props {
  /** The server-rendered grid, checkboxes and all. */
  children: ReactNode
  methods: readonly { value: string; label: string }[]
  labels: {
    selected: string
    post: string
    markPaid: string
    method: string
    reference: string
    done: string
  }
  /** Refusal sentences, already translated — a client cannot call `t`. */
  reasons: Record<string, string>
}

/**
 * The form around the statements grid, and the bar that appears once
 * something is ticked (§7.1, §6.2.6).
 *
 * ── THE COUNT COMES FROM THE DOM ─────────────────────────────────────────
 *
 * Same as `BulkStatus` on batches: the checkboxes ARE the state, they are
 * form fields, they post themselves, and counting them on change is one line
 * that cannot drift from what will be submitted. Holding a selection in React
 * state would mean keeping every row's identity in step with a
 * server-rendered body that re-renders on every sort, filter and page.
 *
 * ── BOTH BUTTONS ARE ALWAYS OFFERED, AND THE SERVER DECIDES ──────────────
 *
 * A selection can mix DRAFT and APPROVED statements. Hiding Mark paid
 * because one of five is a draft would leave somebody unable to act on the
 * other four; the two functions refuse per statement and the refusals come
 * back by name, which is more use than a disabled button that says nothing.
 *
 * ── METHOD AND REFERENCE SIT WITH MARK PAID, NOT IN A SETTING ────────────
 *
 * `markSettlementPaid` refuses an empty reference, because "did we pay them"
 * and "which transfer was it" are different questions during a payroll
 * argument and the second is the one answered wrong from memory. They are
 * facts about THIS run, so they are asked here rather than remembered.
 */
export function BulkPostPaid({ children, methods, labels, reasons }: Props) {
  const [count, setCount] = useState(0)
  const [postState, post, posting] = useActionState(
    statementBulkAction.bind(null, 'post'),
    STATEMENT_BULK_INITIAL,
  )
  const [paidState, markPaid, paying] = useActionState(
    statementBulkAction.bind(null, 'markPaid'),
    STATEMENT_BULK_INITIAL,
  )

  const state =
    paidState.changed > 0 || paidState.refusals.length > 0
      ? paidState
      : postState

  return (
    <form
      onChange={(event) => {
        const form = event.currentTarget
        setCount(
          form.querySelectorAll<HTMLInputElement>(
            'input[name="statement"]:checked',
          ).length,
        )
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}

      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-z3 border-t border-border bg-surface-2 px-gutter py-z2">
          <span className="text-sm text-ink">
            <span className="font-mono tabular-nums">{count}</span>{' '}
            {labels.selected}
          </span>

          <Button
            type="submit"
            formAction={post}
            variant="primary"
            size="compact"
            disabled={posting || paying}
          >
            {labels.post}
          </Button>

          <span className="ms-z3 flex flex-wrap items-center gap-z2">
            <label className="flex items-center gap-z2 text-xs text-ink-2">
              {labels.method}
              <select
                name="method"
                defaultValue="ACH"
                className="h-control rounded-control border border-border-strong bg-surface px-z2 text-sm text-ink"
              >
                {methods.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-z2 text-xs text-ink-2">
              {labels.reference}
              <input
                name="reference"
                className="h-control w-[180px] rounded-control border border-border-strong bg-surface px-z2 text-sm text-ink"
              />
            </label>
            <Button
              type="submit"
              formAction={markPaid}
              variant="secondary"
              size="compact"
              disabled={posting || paying}
            >
              {labels.markPaid}
            </Button>
          </span>
        </div>
      ) : null}

      {state.changed > 0 || state.refusals.length > 0 ? (
        <div className="border-t border-border bg-surface-2 px-gutter py-z2 text-sm">
          {state.changed > 0 ? (
            <p className="text-ink">
              <span className="font-mono tabular-nums">{state.changed}</span>{' '}
              {labels.done}
            </p>
          ) : null}
          {/* BY NAME, NOT COUNTED. "3 of 5 posted" tells somebody two weeks of
           * driver pay did not happen and not whose. */}
          {state.refusals.map((refusal) => (
            <p key={refusal.statement} className="text-danger" role="alert">
              <span className="z-identifier font-mono" dir="ltr">
                {refusal.statement}
              </span>{' '}
              {reasons[refusal.reason] ?? refusal.reason}
            </p>
          ))}
        </div>
      ) : null}
    </form>
  )
}
