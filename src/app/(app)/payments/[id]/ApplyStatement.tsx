'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { centsToInput, formatCents, parseMoneyToCents } from '@/lib/money'
import { applyToLoadsAction } from '../actions'
import { PAYMENT_INITIAL, type PaymentState } from '../payment-state'

// THE RELAY PATH (§2).
//
// One weekly ACH against N direct-settled loads, no invoice anywhere in it.
// Tick what the statement covers; each ticked load takes what it is still
// owed, and the amounts stay editable because a statement that paid $40 short
// on one load is a fact worth recording rather than an inconvenience.
//
// "Fill from the oldest first" is a PROPOSAL, computed here and shown before
// anything is written. The same rule as the server's `spreadOverLoads`, and
// deliberately a suggestion a person confirms rather than an allocation the
// system made on its own — this is somebody else's money against our freight.
//
// The remainder is never forced. Whatever the ticks do not account for stays
// unapplied on the payment, and whatever the payment does not cover stays owed
// on the loads. Both numbers are shown, both stay.

export interface StatementLoad {
  loadId: string
  loadNumber: string
  booked: string
  outstandingCents: number
  /** Pre-formatted, so cents never become a float on the way to the screen. */
  outstanding: string
  revenue: string
}

interface Props {
  paymentId: string
  loads: readonly StatementLoad[]
  unappliedCents: number
  locale: string
  translate: Record<string, string>
  labels: {
    heading: string
    hint: string
    load: string
    outstanding: string
    amount: string
    propose: string
    apply: string
    selected: string
    empty: string
    remainder: string
    remainderHint: string
    shortfall: string
    overpaid: string
  }
}

export function ApplyStatement({
  paymentId,
  loads,
  unappliedCents,
  locale,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<PaymentState, FormData>(
    applyToLoadsAction.bind(null, paymentId),
    PAYMENT_INITIAL,
  )
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())

  if (loads.length === 0) {
    return (
      <div>
        <h2 className="text-md font-medium text-ink">{labels.heading}</h2>
        <p className="mt-z2 text-sm text-ink-3">{labels.empty}</p>
      </div>
    )
  }

  const toggle = (loadId: string) => {
    const next = new Set(ticked)
    if (next.has(loadId)) {
      next.delete(loadId)
    } else {
      next.add(loadId)
      // Ticking a load fills its amount with what it is owed, which is the
      // answer nine times in ten and visible before it is submitted.
      setAmounts((current) => ({
        ...current,
        [loadId]:
          current[loadId] ??
          centsToInput(
            loads.find((row) => row.loadId === loadId)?.outstandingCents ?? 0,
          ),
      }))
    }
    setTicked(next)
  }

  /** The oldest-first proposal, over the whole list. */
  const propose = () => {
    let left = unappliedCents
    const next: Record<string, string> = {}
    const chosen = new Set<string>()
    for (const load of loads) {
      if (left <= 0) break
      const take = Math.min(left, load.outstandingCents)
      if (take <= 0) continue
      next[load.loadId] = centsToInput(take)
      chosen.add(load.loadId)
      left -= take
    }
    setAmounts(next)
    setTicked(chosen)
  }

  // Parsed with the SAME function the server uses. A second parser here is
  // how the preview and the result end up disagreeing by a cent.
  const chosenTotal = [...ticked].reduce((sum, loadId) => {
    try {
      return sum + parseMoneyToCents(amounts[loadId] ?? '')
    } catch {
      return sum
    }
  }, 0)

  const remainder = unappliedCents - chosenTotal

  return (
    <form action={act} className="flex flex-col gap-z3">
      <div>
        <h2 className="text-md font-medium text-ink">{labels.heading}</h2>
        <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>
      </div>

      <ul className="flex flex-col">
        {loads.map((load) => (
          <li
            key={load.loadId}
            className="flex items-center gap-z3 border-b border-border py-z2 text-sm last:border-b-0"
          >
            <input
              type="checkbox"
              name="loadIds"
              value={load.loadId}
              checked={ticked.has(load.loadId)}
              onChange={() => toggle(load.loadId)}
              aria-label={load.loadNumber}
            />
            <span className="z-identifier font-mono font-medium text-ink">
              {load.loadNumber}
            </span>
            <span className="font-mono text-xs text-ink-3">{load.booked}</span>
            <span className="ms-auto font-mono tabular-nums text-ink-2">
              {load.outstanding}
            </span>
            <input
              name={`amount:${load.loadId}`}
              value={amounts[load.loadId] ?? ''}
              onChange={(event) =>
                setAmounts((current) => ({
                  ...current,
                  [load.loadId]: event.target.value,
                }))
              }
              disabled={!ticked.has(load.loadId)}
              inputMode="decimal"
              aria-label={`${labels.amount} ${load.loadNumber}`}
              className="h-control-compact w-[110px] rounded-control border border-border-strong bg-surface px-z2 text-end font-mono text-sm text-ink disabled:bg-surface-2 disabled:text-ink-3"
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-z3">
        <Button
          type="submit"
          variant="primary"
          disabled={pending || ticked.size === 0}
        >
          {labels.apply}
        </Button>
        <Button type="button" variant="secondary" onClick={propose}>
          {labels.propose}
        </Button>
        <span className="text-sm text-ink-2">
          {ticked.size} {labels.selected}
          {' · '}
          <span className="font-mono tabular-nums">
            {formatCents(chosenTotal, locale)}
          </span>
        </span>
      </div>

      {/* THE REMAINDER, before it is committed. Shown rather than corrected. */}
      {ticked.size > 0 && remainder !== 0 ? (
        <p className="max-w-[68ch] text-sm text-ink-2">
          <span className="font-medium">{labels.remainder}: </span>
          <span className="font-mono tabular-nums">
            {formatCents(Math.abs(remainder), locale)}
          </span>
          {' — '}
          {labels.remainderHint}
        </p>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {(translate[state.error] ?? state.error).replace(
            '{loads}',
            state.loadNumbers.join(', '),
          )}
        </p>
      ) : null}

      {state.unappliedCents !== null && !state.error ? (
        <p role="status" className="text-sm text-ink-2">
          {labels.overpaid}:{' '}
          <span className="font-mono tabular-nums">
            {formatCents(state.unappliedCents, locale)}
          </span>
          {state.shortfallCents ? (
            <>
              {' · '}
              {labels.shortfall}:{' '}
              <span className="font-mono tabular-nums">
                {formatCents(state.shortfallCents, locale)}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
    </form>
  )
}
