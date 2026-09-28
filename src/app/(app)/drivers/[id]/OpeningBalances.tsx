'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { saveOpeningBalanceAction } from '../deduction-actions'
import { OPENING_INITIAL, type OpeningState } from '../deduction-state'

// ---------------------------------------------------------------------------
// WHAT A DRIVER BROUGHT INTO THE YEAR, TYPED IN FROM SOMEWHERE ELSE.
//
// `DriverOpeningBalance` has been in the schema since Phase 3 with no screen.
// The figures come off a Datatruck statement's year-to-date block — the six
// categories are exactly the rows it prints — and they move every YTD total on
// every statement Zebra produces for that year.
//
// ── ENTERING A CATEGORY AGAIN CORRECTS IT ─────────────────────────────────
//
// `@@unique([driverId, year, category])`, so the writer upserts. The form says
// so under the heading rather than pretending each submit is a new balance:
// somebody re-keying a figure they got wrong needs to know it replaces rather
// than doubles.
//
// THE SIGN IS THE ACCOUNTANT'S. Deductions print negative and are typed
// negative. The screen does not flip them, because then the screen and the paper
// would disagree about what was entered and nobody could tell which lied.
// ---------------------------------------------------------------------------

export interface OpeningRowView {
  id: string
  category: string
  categoryLabel: string
  /** Pre-formatted and signed by the server. */
  amount: string
  asOf: string
  source: string
}

interface Props {
  driverId: string
  rows: readonly OpeningRowView[]
  categories: readonly SelectOption[]
  year: number
  today: string
  readOnly: boolean
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    year: string
    category: string
    amount: string
    amountHint: string
    asOf: string
    source: string
    sourceHint: string
    notes: string
    save: string
    none: string
    replaces: string
  }
}

export function OpeningBalances({
  driverId,
  rows,
  categories,
  year,
  today,
  readOnly,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<OpeningState, FormData>(
    saveOpeningBalanceAction.bind(null, driverId),
    OPENING_INITIAL,
  )

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      {rows.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-2">{labels.none}</p>
      ) : (
        <ul className="mt-z3 flex flex-col">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline gap-x-z3 gap-y-z1 border-b border-border py-z2 text-sm last:border-b-0"
            >
              <span className="font-medium text-ink">{row.categoryLabel}</span>
              <span className="font-mono tabular-nums text-ink">
                {row.amount}
              </span>
              <span className="font-mono text-xs text-ink-3">{row.asOf}</span>
              <span className="text-ink-3">{row.source}</span>
            </li>
          ))}
        </ul>
      )}

      {readOnly ? null : (
        <form action={act} className="mt-z4 flex flex-col gap-z3">
          <p className="text-xs text-ink-3">{labels.replaces}</p>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
            <Input
              name="year"
              label={labels.year}
              required
              defaultValue={String(year)}
              inputMode="numeric"
            />
            <Select
              name="category"
              label={labels.category}
              required
              options={categories}
            />
            <Input
              name="amount"
              label={labels.amount}
              required
              inputMode="decimal"
              hint={labels.amountHint}
            />
            <Input
              name="asOf"
              label={labels.asOf}
              required
              defaultValue={today}
              inputMode="numeric"
            />
            <Input
              name="source"
              label={labels.source}
              required
              hint={labels.sourceHint}
            />
            <Input name="notes" label={labels.notes} />
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {translate[state.error] ?? state.error}
            </p>
          ) : null}

          <div>
            <Button type="submit" disabled={pending}>
              {labels.save}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
