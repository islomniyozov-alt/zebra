'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { addDeductionAction, sendStatementsAction } from '../actions'
import { BATCH_BULK_INITIAL } from '../batch-bulk-state'

interface Props {
  batchId: string
  /** The server-rendered statements table, checkboxes and all. */
  children: ReactNode
  /** Add deduction is offered only while the batch is editable. */
  editable: boolean
  types: readonly string[]
  labels: {
    selected: string
    send: string
    sent: string
    addDeduction: string
    type: string
    description: string
    amount: string
    hint: string
    charged: string
  }
}

/**
 * The form around the batch's statements and the bar that appears once one
 * is ticked (§6.2.10 part 7 step 3).
 *
 * THE COUNT COMES FROM THE DOM, as on Driver statements: the checkboxes are
 * the form's fields and post themselves.
 *
 * BOTH VERBS ARE OFFERED AND THE SERVER DECIDES. Send refuses an Unposted or
 * Void statement by name (R13: posted only); Add deduction refuses a Posted
 * one. A mixed selection gets each one's answer, listed.
 */
export function BatchStatementsBulk({
  batchId,
  children,
  editable,
  types,
  labels,
}: Props) {
  const [count, setCount] = useState(0)
  const [sendState, send, sending] = useActionState(
    sendStatementsAction.bind(null, batchId),
    BATCH_BULK_INITIAL,
  )
  const [chargeState, charge, charging] = useActionState(
    addDeductionAction.bind(null, batchId),
    BATCH_BULK_INITIAL,
  )
  const busy = sending || charging

  return (
    <form
      onChange={(event) => {
        setCount(
          event.currentTarget.querySelectorAll<HTMLInputElement>(
            'input[name="statement"]:checked',
          ).length,
        )
      }}
      className="flex min-w-0 flex-col"
    >
      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-z3 border-b border-border bg-surface-2 px-gutter py-z2">
          <span className="text-sm text-ink">
            <span className="font-mono tabular-nums">{count}</span>{' '}
            {labels.selected}
          </span>
          <Button
            type="submit"
            formAction={send}
            variant="primary"
            size="compact"
            disabled={busy}
          >
            {labels.send}
          </Button>
          {editable ? (
            <fieldset className="ms-z3 flex flex-wrap items-center gap-z2">
              <legend className="sr-only">{labels.addDeduction}</legend>
              <label className="flex items-center gap-z2 text-xs text-ink-2">
                {labels.type}
                <select
                  name="type"
                  defaultValue={types[0]}
                  className="h-control rounded-control border border-border-strong bg-surface px-z2 text-sm text-ink"
                >
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-z2 text-xs text-ink-2">
                {labels.description}
                <input
                  name="description"
                  className="h-control w-[180px] rounded-control border border-border-strong bg-surface px-z2 text-sm text-ink"
                />
              </label>
              <label className="flex items-center gap-z2 text-xs text-ink-2">
                {labels.amount}
                <input
                  name="amount"
                  inputMode="decimal"
                  dir="ltr"
                  className="h-control w-[100px] rounded-control border border-border-strong bg-surface px-z2 text-end font-mono text-sm text-ink"
                />
              </label>
              <Button
                type="submit"
                formAction={charge}
                variant="secondary"
                size="compact"
                disabled={busy}
                title={labels.hint}
              >
                {labels.addDeduction}
              </Button>
            </fieldset>
          ) : null}
        </div>
      ) : null}

      {[
        { state: sendState, done: labels.sent },
        { state: chargeState, done: labels.charged },
      ].map(({ state, done }) =>
        state.done > 0 || state.refusals.length > 0 || state.error ? (
          <div
            key={done}
            className="border-b border-border bg-surface-2 px-gutter py-z2 text-sm"
          >
            {state.done > 0 ? (
              <p className="text-ink">
                <span className="font-mono tabular-nums">{state.done}</span>{' '}
                {done}
              </p>
            ) : null}
            {state.error ? (
              <p className="text-danger" role="alert">
                {state.error}
              </p>
            ) : null}
            {/* BY NAME, NOT COUNTED. */}
            {state.refusals.map((line) => (
              <p key={line} className="text-danger" role="alert">
                {line}
              </p>
            ))}
          </div>
        ) : null,
      )}

      {children}
    </form>
  )
}
