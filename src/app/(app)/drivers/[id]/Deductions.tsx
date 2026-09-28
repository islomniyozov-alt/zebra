'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { closeDeductionAction, saveDeductionAction } from '../deduction-actions'
import { DEDUCTION_INITIAL, type DeductionState } from '../deduction-state'

// ---------------------------------------------------------------------------
// WHAT COMES OFF A DRIVER'S CHEQUE, ENTERED BY A PERSON.
//
// `RecurringDeduction` has been in the schema since Phase 3 and no screen has
// ever written one. Every statement diff on the four replayed dev weeks showed
// Datatruck's deductions against Zebra's $0.00 — not an engine gap, this gap.
//
// ── THE CADENCE DECIDES WHICH FIELDS EXIST, NOT WHICH ARE ENABLED ─────────
//
// Same posture as `PayRules`: only the field the cadence uses is rendered. A
// disabled input still posts, and a leftover month total on a weekly rule is a
// figure the writer refuses and a reader would otherwise trust. The refusal
// exists too — this just means an accountant never has to see it.
//
// TARGET IS OFFERED ONLY FOR ESCROW, because escrow is the only type
// `deductions.ts` stops at one. Offering it everywhere would invite a ceiling on
// insurance that nothing honours.
// ---------------------------------------------------------------------------

export interface DeductionRowView {
  id: string
  type: string
  description: string | null
  /** Pre-formatted by the server: "$450.00 / wk of $1,800.00". */
  figure: string
  /** "$2,500.00 target", or null. */
  target: string | null
  from: string
  to: string | null
  isRunning: boolean
}

interface Props {
  driverId: string
  rows: readonly DeductionRowView[]
  types: readonly SelectOption[]
  cadences: readonly SelectOption[]
  today: string
  /** A MANAGER reads what comes off and does not set it. */
  readOnly: boolean
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    add: string
    type: string
    description: string
    descriptionHint: string
    amount: string
    cadence: string
    monthlyTotal: string
    monthlyTotalHint: string
    target: string
    targetHint: string
    from: string
    to: string
    toHint: string
    open: string
    notes: string
    save: string
    close: string
    closeHint: string
    none: string
  }
}

export function Deductions({
  driverId,
  rows,
  types,
  cadences,
  today,
  readOnly,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<DeductionState, FormData>(
    saveDeductionAction.bind(null, driverId),
    DEDUCTION_INITIAL,
  )
  const [cadence, setCadence] = useState('WEEKLY')
  const [type, setType] = useState('Insurance')

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
              <span className="font-medium text-ink">{row.type}</span>
              <span className="font-mono tabular-nums text-ink">
                {row.figure}
              </span>
              {row.target ? (
                <span className="font-mono text-xs text-ink-2">
                  {row.target}
                </span>
              ) : null}
              <span className="font-mono text-xs text-ink-3">
                {row.from} → {row.to ?? '—'}
              </span>
              {row.isRunning ? (
                <span className="rounded-control border border-border-strong px-z2 text-xs text-ink-2">
                  {labels.open}
                </span>
              ) : null}
              {row.description ? (
                <span className="text-ink-3">{row.description}</span>
              ) : null}
              {row.isRunning && !readOnly ? (
                <StopDeduction
                  driverId={driverId}
                  deductionId={row.id}
                  today={today}
                  labels={{ close: labels.close, hint: labels.closeHint }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {readOnly ? null : (
        <form action={act} className="mt-z4 flex flex-col gap-z3">
          <h3 className="text-sm font-medium text-ink-2">{labels.add}</h3>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
            <Select
              name="type"
              label={labels.type}
              required
              options={types}
              value={type}
              onChange={(event) => setType(event.target.value)}
            />
            <Select
              name="cadence"
              label={labels.cadence}
              required
              options={cadences}
              value={cadence}
              onChange={(event) => setCadence(event.target.value)}
            />

            <Input
              name="amount"
              label={labels.amount}
              required
              inputMode="decimal"
            />

            {/* ONLY WHERE THE SPLIT NEEDS IT. See the header. */}
            {cadence === 'MONTHLY_SPLIT_WEEKLY' ? (
              <Input
                name="monthlyTotal"
                label={labels.monthlyTotal}
                required
                inputMode="decimal"
                hint={labels.monthlyTotalHint}
              />
            ) : null}

            {/* AND ONLY FOR THE ONE TYPE THAT STOPS AT IT. */}
            {type === 'Escrow' ? (
              <Input
                name="target"
                label={labels.target}
                inputMode="decimal"
                hint={labels.targetHint}
              />
            ) : null}

            <Input
              name="effectiveFrom"
              label={labels.from}
              required
              defaultValue={today}
              inputMode="numeric"
            />
            <Input
              name="effectiveTo"
              label={labels.to}
              hint={labels.toHint}
              inputMode="numeric"
            />
            <Input
              name="description"
              label={labels.description}
              hint={labels.descriptionHint}
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

/**
 * Stop a deduction on a date.
 *
 * ITS OWN FORM, because it posts a different action with its own state. Sharing
 * one `useActionState` would make a failed stop render its error under the add
 * form, where a person is not looking.
 */
function StopDeduction({
  driverId,
  deductionId,
  today,
  labels,
}: {
  driverId: string
  deductionId: string
  today: string
  labels: { close: string; hint: string }
}) {
  const [state, act, pending] = useActionState<DeductionState, FormData>(
    closeDeductionAction.bind(null, driverId, deductionId),
    DEDUCTION_INITIAL,
  )
  return (
    <form action={act} className="flex items-center gap-z2">
      <Input
        name="effectiveTo"
        label={labels.close}
        defaultValue={today}
        inputMode="numeric"
        hint={labels.hint}
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        {labels.close}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}
