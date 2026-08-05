'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { formatCents } from '@/lib/money'
import { createInvoiceAction } from './actions'
import { INVOICE_INITIAL, type InvoiceState } from './invoice-state'

// The ready queue: delivered, rated, uninvoiced freight, with a checkbox each.
//
// BATCH IS THE DEFAULT SHAPE, not a power feature. A broker who receives six
// invoices for six loads in a week pays them as one payment and reconciles
// none of them — so one invoice per broker per batch is what the screen makes
// easy, and one-at-a-time is just a batch of one.
//
// The selection is grouped by broker in the markup because an invoice covers
// one broker; selecting across two is refused by the server, and the grouping
// is what stops somebody meeting that refusal by accident.

export interface ReadyRow {
  id: string
  loadNumber: string
  customerName: string
  totalRevenueCents: number
}

interface Props {
  rows: readonly ReadyRow[]
  locale: string
  labels: {
    ready: string
    empty: string
    create: string
    createHint: string
    selected: string
    customer: string
    total: string
  }
  translate: Record<string, string>
}

export function ReadyQueue({ rows, locale, labels, translate }: Props) {
  const [state, act, pending] = useActionState<InvoiceState, FormData>(
    createInvoiceAction,
    INVOICE_INITIAL,
  )
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())

  const toggle = (id: string) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  const selectedRows = rows.filter((row) => chosen.has(row.id))
  const selectedTotal = selectedRows.reduce(
    (total, row) => total + row.totalRevenueCents,
    0,
  )
  const brokers = new Set(selectedRows.map((row) => row.customerName))

  if (rows.length === 0) {
    return (
      <section className="border-b border-border bg-surface px-gutter py-z4">
        <h2 className="text-md font-medium text-ink">{labels.ready}</h2>
        <p className="mt-z2 text-sm text-ink-3">{labels.empty}</p>
      </section>
    )
  }

  return (
    <section className="border-b border-border bg-surface px-gutter py-z4">
      <h2 className="text-md font-medium text-ink">{labels.ready}</h2>

      <form action={act} className="mt-z3">
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-baseline gap-z3 border-b border-border py-z2 text-sm last:border-b-0"
            >
              <input
                type="checkbox"
                name="loadIds"
                value={row.id}
                checked={chosen.has(row.id)}
                onChange={() => toggle(row.id)}
              />
              <span className="z-identifier font-mono font-medium text-ink">
                {row.loadNumber}
              </span>
              <span className="truncate text-ink-2">{row.customerName}</span>
              <span className="ms-auto font-mono tabular-nums text-ink">
                {formatCents(row.totalRevenueCents, locale)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-z3 flex flex-wrap items-center gap-z3">
          <Button
            type="submit"
            variant="primary"
            disabled={pending || chosen.size === 0}
          >
            {labels.create}
          </Button>
          <span className="text-sm text-ink-2">
            {chosen.size} {labels.selected}
            {chosen.size > 0 ? (
              <>
                {' · '}
                <span className="font-mono tabular-nums">
                  {formatCents(selectedTotal, locale)}
                </span>
              </>
            ) : null}
          </span>
          {/* Said before the server has to refuse it. The refusal exists and is
           * tested; meeting it by accident is still a wasted round trip and a
           * moment of doubt about whether the screen works. */}
          {brokers.size > 1 ? (
            <span role="alert" className="text-sm text-danger">
              {translate['invoices.error.mixedCustomers']}
            </span>
          ) : (
            <span className="text-xs text-ink-3">{labels.createHint}</span>
          )}
        </div>

        {state.error ? (
          <p role="alert" className="mt-z2 text-sm text-danger">
            {(translate[state.error] ?? state.error).replace(
              '{loads}',
              state.loadNumbers.join(', '),
            )}
          </p>
        ) : null}
      </form>
    </section>
  )
}
