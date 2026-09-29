'use client'

import { useActionState, useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { formatCents, parseMoneyToCents, MoneyFormatError } from '@/lib/money'
import { chargeTotalCents, isValidQuantity } from '@/lib/settlement-charge'
import { addLineAction, removeLineAction } from '../actions'
import { SETTLEMENT_INITIAL, type SettlementState } from '../settlement-state'

export interface ChargeRow {
  id: string
  /** The line type's label, already translated. */
  typeLabel: string
  description: string
  /** Null where the line carries no quantity snapshot — an ordinary one-off. */
  rateCents: number | null
  quantity: number | null
  amountCents: number
  removable: boolean
  /** The working, where the line has a pay rule behind it. */
  basis: string
}

interface Labels {
  heading: string
  type: string
  amount: string
  quantity: string
  total: string
  description: string
  add: string
  remove: string
}

/**
 * One of the three line grids on the workbench, with its add-row built in.
 *
 * ── WHY THIS IS NOT `components/ui/Table` ────────────────────────────────
 *
 * §6.2.2: "the inline add-row is the LAST row of the grid it adds to, not a
 * separate panel. Its columns are the grid's columns." That is a promise about
 * ALIGNMENT, and the only way to keep it is for the add-row to be a `<tr>` in
 * the same `<table>` — one table, one set of column widths, so the total under
 * the add-row lines up with the totals above it.
 *
 * `Table` is the LIST grid: sort, filter, pagination, columns chooser, sticky
 * head, a foot over the filtered set. None of that applies to four deduction
 * lines on one document, and the one thing needed here — a row that is a form —
 * is the one thing it does not do.
 *
 * ── THE FORM IS A SIBLING OF THE TABLE, NOT ITS PARENT ───────────────────
 *
 * Each existing row carries its own Remove form, and HTML forbids a form
 * inside a form. So the add-form is rendered empty beside the table and the
 * add-row's controls join it by `form={formId}` — which is what that attribute
 * is for, and it keeps both the alignment and the per-row removes.
 */
export function ChargeGrid({
  settlementId,
  rows,
  types,
  labels,
  translate,
  canAdd,
  locale,
}: {
  settlementId: string
  rows: readonly ChargeRow[]
  types: readonly { value: string; label: string }[]
  labels: Labels
  translate: Record<string, string>
  canAdd: boolean
  locale: string
}) {
  const [state, act, pending] = useActionState<SettlementState, FormData>(
    addLineAction.bind(null, settlementId),
    SETTLEMENT_INITIAL,
  )
  const formId = useId()
  const [rate, setRate] = useState('')
  const [quantity, setQuantity] = useState('1')

  // ── THE TOTAL, COMPUTED BY THE SAME FUNCTION THE SERVER USES ───────────
  //
  // §6.2.2 says the total is never typed. It also has to be never GUESSED:
  // a preview that multiplied here while the server multiplied there would
  // eventually disagree, and the one place it would show is a statement.
  // `chargeTotalCents` is imported rather than reimplemented for that reason.
  const preview = previewTotal(rate, quantity)

  const cell = 'px-z3 py-z2 text-sm'
  const head =
    'px-z3 py-z2 text-start text-xs font-medium uppercase tracking-[0.04em] text-ink-2'

  return (
    <section className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-z3 border-b border-border px-z4 py-z3">
        <h2 className="text-md font-medium text-ink">{labels.heading}</h2>
        <span className="font-mono text-sm font-medium tabular-nums text-ink">
          {formatCents(
            rows.reduce((sum, row) => sum + row.amountCents, 0),
            locale,
          )}
        </span>
      </div>

      {/* Empty and inert: it exists only so the add-row's controls have
       * something to belong to. */}
      {canAdd ? <form id={formId} action={act} /> : null}

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className={head}>{labels.type}</th>
            <th className={`${head} text-end`}>{labels.amount}</th>
            <th className={`${head} text-end`}>{labels.quantity}</th>
            <th className={`${head} text-end`}>{labels.total}</th>
            <th className={head}>{labels.description}</th>
            <th className={head} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-b-0">
              <td className={`${cell} text-ink`}>{row.typeLabel}</td>
              <td
                className={`${cell} text-end font-mono tabular-nums text-ink-2`}
              >
                {/* A LINE WITH NO SNAPSHOT SHOWS NOTHING HERE, not its own
                 * total repeated. Printing the total in the rate column would
                 * assert a quantity of 1 that nothing recorded. */}
                {row.rateCents === null ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  formatCents(row.rateCents, locale)
                )}
              </td>
              <td
                className={`${cell} text-end font-mono tabular-nums text-ink-2`}
              >
                {row.quantity ?? <span className="text-ink-3">—</span>}
              </td>
              <td
                className={`${cell} text-end font-mono tabular-nums text-ink`}
              >
                {formatCents(row.amountCents, locale)}
              </td>
              <td className={`${cell} text-ink`}>
                {row.description}
                {row.basis ? (
                  <span className="ms-z2 text-xs text-ink-3">{row.basis}</span>
                ) : null}
              </td>
              <td className={`${cell} text-end`}>
                {row.removable ? (
                  <RemoveCell
                    settlementId={settlementId}
                    lineId={row.id}
                    label={labels.remove}
                  />
                ) : null}
              </td>
            </tr>
          ))}

          {canAdd ? (
            <tr className="border-t border-border bg-surface-2">
              <td className={cell}>
                <select
                  form={formId}
                  name="type"
                  required
                  aria-label={labels.type}
                  className="w-full rounded-control border border-border-strong bg-surface px-z2 py-z1 text-sm text-ink"
                  defaultValue=""
                >
                  <option value="" disabled />
                  {types.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className={cell}>
                <input
                  form={formId}
                  name="amount"
                  required
                  inputMode="decimal"
                  aria-label={labels.amount}
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                  className="w-full rounded-control border border-border-strong bg-surface px-z2 py-z1 text-end font-mono text-sm text-ink"
                />
              </td>
              <td className={cell}>
                <input
                  form={formId}
                  name="quantity"
                  inputMode="numeric"
                  aria-label={labels.quantity}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="w-full rounded-control border border-border-strong bg-surface px-z2 py-z1 text-end font-mono text-sm text-ink"
                />
              </td>
              {/* READ-ONLY, AND NOT AN INPUT AT ALL. A disabled input still
               * looks like somewhere to type. */}
              <td
                className={`${cell} text-end font-mono tabular-nums text-ink`}
                aria-live="polite"
              >
                {preview === null ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  formatCents(preview, locale)
                )}
              </td>
              <td className={cell}>
                <input
                  form={formId}
                  name="description"
                  required
                  aria-label={labels.description}
                  className="w-full rounded-control border border-border-strong bg-surface px-z2 py-z1 text-sm text-ink"
                />
              </td>
              <td className={`${cell} text-end`}>
                <Button
                  form={formId}
                  type="submit"
                  variant="secondary"
                  size="compact"
                  disabled={pending}
                >
                  {labels.add}
                </Button>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {state.error ? (
        <p
          className="border-t border-border px-z4 py-z2 text-sm text-danger"
          role="alert"
        >
          {translate[state.error] ?? state.error}
        </p>
      ) : null}
    </section>
  )
}

/**
 * The preview, or null where the two boxes do not yet describe a number.
 *
 * NULL RATHER THAN ZERO for an unparseable rate. `$0.00` under a half-typed
 * amount reads as an answer, and the box it is answering is `12.` on the way
 * to `12.50`.
 */
function previewTotal(rate: string, quantity: string): number | null {
  if (rate.trim() === '') return null
  let rateCents: number
  try {
    rateCents = parseMoneyToCents(rate)
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return null
  }
  const count = quantity.trim() === '' ? 1 : Number(quantity)
  if (!isValidQuantity(count)) return null
  return chargeTotalCents(rateCents, count)
}

function RemoveCell({
  settlementId,
  lineId,
  label,
}: {
  settlementId: string
  lineId: string
  label: string
}) {
  const [, act, pending] = useActionState<SettlementState, FormData>(
    removeLineAction.bind(null, settlementId, lineId),
    SETTLEMENT_INITIAL,
  )
  return (
    <form action={act}>
      <Button type="submit" variant="ghost" size="compact" disabled={pending}>
        {label}
      </Button>
    </form>
  )
}
