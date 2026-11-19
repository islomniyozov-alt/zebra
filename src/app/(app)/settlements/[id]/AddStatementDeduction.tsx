'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { addStatementDeductionAction } from '../actions'
import { SETTLEMENT_INITIAL, type SettlementState } from '../settlement-state'

interface Props {
  settlementId: string
  batchId: string
  types: readonly string[]
  labels: {
    heading: string
    hint: string
    type: string
    description: string
    amount: string
    add: string
  }
  /** Refusal sentences, already translated — a client cannot call `t`. */
  translate: Record<string, string>
}

/**
 * ADD DEDUCTION ON A BATCH STATEMENT (TMS §6.2.10 part 7 step 4).
 *
 * The batch's one-time charge for this statement, carrying the batch's
 * authority, then the draft refreshed — not a line added to the draft, which
 * the next refresh would delete. The refresh rebuilds the statement under a
 * new id, so the action lands on the rebuilt one, on its One-time tab.
 */
export function AddStatementDeduction({
  settlementId,
  batchId,
  types,
  labels,
  translate,
}: Props) {
  const [state, act, pending] = useActionState<SettlementState, FormData>(
    addStatementDeductionAction.bind(null, settlementId, batchId),
    SETTLEMENT_INITIAL,
  )
  return (
    <form
      action={act}
      id="charges-to-add"
      className="flex scroll-mt-z4 flex-col gap-z2 border-b border-border px-z4 py-z3"
    >
      <div className="flex flex-wrap items-baseline gap-z3">
        <h3 className="text-sm font-medium text-ink">{labels.heading}</h3>
        <p className="text-xs text-ink-3">{labels.hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-z2">
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
            required
            className="h-control w-[220px] rounded-control border border-border-strong bg-surface px-z2 text-sm text-ink"
          />
        </label>
        <label className="flex items-center gap-z2 text-xs text-ink-2">
          {labels.amount}
          <input
            name="amount"
            required
            inputMode="decimal"
            dir="ltr"
            className="h-control w-[110px] rounded-control border border-border-strong bg-surface px-z2 text-end font-mono text-sm text-ink"
          />
        </label>
        <Button
          type="submit"
          variant="secondary"
          size="compact"
          disabled={pending}
        >
          {labels.add}
        </Button>
      </div>
      {state.error ? (
        <p className="text-xs text-danger" role="alert">
          {translate[state.error] ?? state.error}
        </p>
      ) : null}
    </form>
  )
}
