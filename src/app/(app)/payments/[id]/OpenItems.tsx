'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCents, parseMoneyToCents, MoneyFormatError } from '@/lib/money'
import { applyAllocationsAction } from '../actions'
import { APPLY_INITIAL } from '../apply-state'

export interface OpenItem {
  kind: 'invoice' | 'load'
  id: string
  /** `INV-1002`, `DT-015095`. */
  label: string
  /** Due date for an invoice, booked date for a load. Already formatted. */
  when: string
  balanceCents: number
}

interface Labels {
  heading: string
  hint: string
  allOrNothing: string
  item: string
  when: string
  balance: string
  amount: string
  apply: string
  applied: string
  remains: string
  unapplied: string
  emptyTitle: string
  emptyBody: string
  kindInvoice: string
  kindLoad: string
}

/**
 * The payer's open items, in one list, with an amount against each (§6.2.5).
 *
 * ── ONE LIST, BOTH KINDS ─────────────────────────────────────────────────
 *
 * Invoices and direct-settled loads together, because the question is "what
 * does this payer owe us" and two tables would make somebody add up two
 * subtotals to see whether the wire is covered. The kind is a column, not a
 * section.
 *
 * ── A FULL PAGE, NOT A MODAL, AND THAT WAS A RULING ──────────────────────
 *
 * The brief asked for a modal; §7.5 caps a modal at six fields and this is
 * one editable amount per open item, a count nothing bounds. Flagged in
 * TMS-DESIGN-SYSTEM v10.9 rather than silently resolved.
 *
 * ── THE RUNNING TOTAL IS THE POINT OF HAVING A FORM AT ALL ───────────────
 *
 * It is computed from the boxes as they are typed, with the SAME parser the
 * server uses, and shown against what the payment has left. Without it the
 * person is adding up money in their head against a figure at the top of the
 * page, which is the arithmetic this screen exists to do for them.
 */
export function OpenItems({
  paymentId,
  items,
  unappliedCents,
  locale,
  labels,
  reasons,
}: {
  paymentId: string
  items: readonly OpenItem[]
  unappliedCents: number
  locale: string
  labels: Labels
  reasons: Record<string, string>
}) {
  const [state, apply, pending] = useActionState(
    applyAllocationsAction.bind(null, paymentId),
    APPLY_INITIAL,
  )

  // PREFILLED TO THE BALANCE. The common case is a wire that clears its items
  // exactly, and the common case should be one click.
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((item) => [item.id, (item.balanceCents / 100).toFixed(2)]),
    ),
  )

  const parsed = (text: string): number | null => {
    if (text.trim() === '') return 0
    try {
      return parseMoneyToCents(text)
    } catch (error) {
      if (!(error instanceof MoneyFormatError)) throw error
      return null
    }
  }

  let chosen = 0
  let unreadable = false
  for (const item of items) {
    const value = parsed(amounts[item.id] ?? '')
    if (value === null) unreadable = true
    else chosen += value
  }
  const remainder = unappliedCents - chosen

  if (items.length === 0) {
    return <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />
  }

  const cell = 'px-z3 py-z2 text-sm'
  const head =
    'px-z3 py-z2 text-start text-xs font-medium uppercase tracking-[0.04em] text-ink-2'

  return (
    <form action={apply} className="flex flex-col gap-z3">
      <div>
        <h2 className="text-md font-medium text-ink">{labels.heading}</h2>
        <p className="mt-z1 max-w-[72ch] text-sm text-ink-3">{labels.hint}</p>
        <p className="mt-z1 max-w-[72ch] text-xs text-ink-3">
          {labels.allOrNothing}
        </p>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className={head}>{labels.item}</th>
            <th className={head}>{labels.when}</th>
            <th className={`${head} text-end`}>{labels.balance}</th>
            <th className={`${head} text-end`}>{labels.amount}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="border-b border-border last:border-b-0"
            >
              <td className={`${cell} text-ink`}>
                <span className="z-identifier font-mono" dir="ltr">
                  {item.label}
                </span>
                <span className="ms-z2 text-xs text-ink-3">
                  {item.kind === 'invoice'
                    ? labels.kindInvoice
                    : labels.kindLoad}
                </span>
              </td>
              <td className={`${cell} font-mono text-xs text-ink-2`} dir="ltr">
                {item.when}
              </td>
              <td
                className={`${cell} text-end font-mono tabular-nums text-ink-2`}
              >
                {formatCents(item.balanceCents, locale)}
              </td>
              <td className={`${cell} text-end`}>
                {/* THE FIELD NAME CARRIES THE KIND AND THE ID, so the server
                 * reads allocations straight off the form without a parallel
                 * list of what was on screen — two lists that have to agree
                 * are two lists that will not. */}
                <input
                  name={`amount.${item.kind}.${item.id}`}
                  inputMode="decimal"
                  aria-label={`${labels.amount} ${item.label}`}
                  value={amounts[item.id] ?? ''}
                  onChange={(event) =>
                    setAmounts((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                  className="h-control w-[120px] rounded-control border border-border-strong bg-surface px-z2 text-end font-mono text-sm text-ink"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-baseline gap-z3 border-t border-border pt-z2 text-sm">
        <span className="text-ink-2">
          {labels.applied}{' '}
          <span className="font-mono tabular-nums text-ink">
            {unreadable ? '—' : formatCents(chosen, locale)}
          </span>
        </span>
        <span className="text-ink-2">
          {labels.remains}{' '}
          {/* NEGATIVE IS SHOWN, NOT CLAMPED. Allocating more than the payment
           * has is a mistake the server refuses, and hiding it here would
           * let somebody press Apply to find that out. */}
          <span
            className={
              remainder < 0
                ? 'font-mono tabular-nums text-danger'
                : 'font-mono tabular-nums text-ink'
            }
          >
            {unreadable ? '—' : formatCents(remainder, locale)}
          </span>
        </span>
        <Button
          type="submit"
          variant="primary"
          size="compact"
          disabled={pending}
          className="ms-auto"
        >
          {labels.apply}
        </Button>
      </div>

      {state.appliedCents !== null ? (
        <p className="text-sm text-ink">
          <span className="font-mono tabular-nums">
            {formatCents(state.appliedCents, locale)}
          </span>{' '}
          {labels.applied}
          {state.unappliedCents !== null ? (
            <>
              {' · '}
              <span className="font-mono tabular-nums">
                {formatCents(state.unappliedCents, locale)}
              </span>{' '}
              {labels.unapplied}
            </>
          ) : null}
        </p>
      ) : null}

      {/* NOTHING WAS APPLIED WHEN THIS IS NON-EMPTY. All or nothing (§6.2.5),
       * so these are the lines to fix before pressing Apply again. */}
      {state.refusals.map((refusal, index) => (
        <p
          key={`${refusal.label}-${index}`}
          className="text-sm text-danger"
          role="alert"
        >
          {refusal.label ? (
            <span className="z-identifier font-mono" dir="ltr">
              {refusal.label}{' '}
            </span>
          ) : null}
          {reasons[refusal.reason] ?? refusal.reason}
        </p>
      ))}
    </form>
  )
}
