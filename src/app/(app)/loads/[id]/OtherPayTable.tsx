'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { formatCents } from '@/lib/money'
import { addAccessorialAction, removeAccessorialAction } from './rate-actions'
import { RATE_INITIAL, type RateState } from './rate-state'

// OTHER PAY, AS DATATRUCK LAYS IT OUT (TMS §7.14 item 4). The load's
// accessorials — `LoadAccessorial`, the same rows the Rate panel sums — as a
// table with an add row. Rendered only for a role with `load.financials`; the
// add row and Remove only for one that may set it. Same actions as the Rate
// panel, so the two can never disagree about what a line is.

export interface OtherPayRow {
  id: string
  typeLabel: string
  amountCents: number
  isBillable: boolean
  statusLabel: string
  notes: string | null
}

export function OtherPayTable({
  loadId,
  rows,
  types,
  mayEdit,
  locale,
  translate,
  labels,
}: {
  loadId: string
  rows: readonly OtherPayRow[]
  types: readonly { value: string; label: string }[]
  mayEdit: boolean
  locale: string
  /** The rate actions' error keys, translated — a function cannot cross to
   *  the client, so the page hands over the words. */
  translate: Record<string, string>
  labels: {
    title: string
    type: string
    amount: string
    note: string
    billable: string
    status: string
    total: string
    none: string
    add: string
    remove: string
    yes: string
    no: string
  }
}) {
  const [state, add, adding] = useActionState<RateState, FormData>(
    addAccessorialAction.bind(null, loadId),
    RATE_INITIAL,
  )
  const total = rows.reduce((sum, row) => sum + row.amountCents, 0)

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <table className="mt-z3 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-start text-ink-2">
            <th className="py-z1 text-start font-medium">{labels.type}</th>
            <th className="py-z1 text-end font-medium">{labels.amount}</th>
            <th className="py-z1 text-start font-medium">{labels.note}</th>
            <th className="py-z1 text-start font-medium">{labels.billable}</th>
            <th className="py-z1 text-start font-medium">{labels.status}</th>
            {mayEdit ? <th className="py-z1" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={mayEdit ? 6 : 5} className="py-z2 text-ink-3">
                {labels.none}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-b border-border">
                <td className="py-z1 text-ink">{row.typeLabel}</td>
                <td className="py-z1 text-end font-mono tabular-nums text-ink">
                  {formatCents(row.amountCents, locale)}
                </td>
                <td className="py-z1 text-ink-2">{row.notes ?? '—'}</td>
                <td className="py-z1 text-ink-2">
                  {row.isBillable ? labels.yes : labels.no}
                </td>
                <td className="py-z1 text-ink-2">{row.statusLabel}</td>
                {mayEdit ? (
                  <td className="py-z1 text-end">
                    <form
                      action={removeAccessorialAction.bind(
                        null,
                        loadId,
                        row.id,
                      )}
                    >
                      <Button type="submit" variant="ghost" size="compact">
                        {labels.remove}
                      </Button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <p className="mt-z2 text-sm text-ink">
        {labels.total}{' '}
        <span className="font-mono tabular-nums">
          {formatCents(total, locale)}
        </span>
      </p>

      {mayEdit ? (
        <form action={add} className="mt-z3 flex flex-wrap items-end gap-z2">
          <Select
            name="type"
            label={labels.type}
            options={types}
            className="w-[180px]"
          />
          <Input
            name="amount"
            label={labels.amount}
            className="w-[120px] font-mono"
          />
          <Input name="notes" label={labels.note} className="w-[220px]" />
          <label className="flex items-center gap-z1 pb-z2 text-sm text-ink">
            <input type="checkbox" name="isBillable" defaultChecked />
            {labels.billable}
          </label>
          <Button type="submit" variant="ghost" disabled={adding}>
            {labels.add}
          </Button>
        </form>
      ) : null}
      {state.error ? (
        <p role="alert" className="mt-z2 text-sm text-danger">
          {translate[state.error] ?? state.error}
        </p>
      ) : null}
    </section>
  )
}
