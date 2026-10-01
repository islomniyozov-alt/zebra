'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { addStandingChargeAction } from './standing-actions'
import { STANDING_INITIAL } from './standing-state'

interface Props {
  types: readonly string[]
  scopes: readonly { value: string; label: string }[]
  labels: {
    add: string
    cancel: string
    save: string
    type: string
    cadence: string
    weekly: string
    monthlySplit: string
    amount: string
    appliesTo: string
    description: string
    from: string
  }
  /**
   * Every refusal sentence this form can be handed, ALREADY TRANSLATED.
   *
   * AN OBJECT, NOT A FUNCTION, for the reason `AddCharge` records: a closure
   * over `t` cannot cross the server/client boundary, React refuses it, and the
   * page 500s somewhere no test looks.
   */
  errors: Record<string, string>
}

/**
 * OPEN A STANDING CHARGE — the organization's, not a driver's (§6.2.4).
 *
 * ── NO DRIVER FIELD, AND THAT IS THE WHOLE DIFFERENCE ────────────────────
 *
 * `AddCharge` beside this puts the driver FIRST, because on a cross-driver list
 * the wrong driver is money off the wrong person's cheque. This form has no
 * driver at all: the charge reaches whoever the WEEK produces, filtered by
 * `appliesTo` and by the exemptions. A driver hired on Tuesday pays it on Friday
 * without anybody adding a row, which is the reason it is not a filter on the
 * other tab.
 *
 * SO `appliesTo` IS WHERE THE HAZARD MOVED, and it is a Select of exactly the
 * values the schema recognises rather than free text — an unrecognised scope
 * matches nobody, which would be a charge that silently never fires.
 *
 * COLLAPSED UNTIL ASKED FOR (rule 1), same as `AddCharge`.
 */
export function AddStanding({ types, scopes, labels, errors }: Props) {
  const [open, setOpen] = useState(false)
  const [state, add, pending] = useActionState(
    addStandingChargeAction,
    STANDING_INITIAL,
  )
  const [cadence, setCadence] = useState('WEEKLY')

  if (!open) {
    return (
      <Button variant="primary" size="compact" onClick={() => setOpen(true)}>
        {labels.add}
      </Button>
    )
  }

  return (
    <form
      action={add}
      className="flex flex-wrap items-end gap-z2 border-b border-border bg-surface-2 px-gutter py-z3"
    >
      <Select
        name="type"
        label={labels.type}
        options={types.map((type) => ({ value: type, label: type }))}
        className="w-[150px]"
      />
      {/* WHO IT REACHES. See the header: the hazard this form carries. */}
      <Select
        name="appliesTo"
        label={labels.appliesTo}
        options={[...scopes]}
        className="w-[200px]"
      />
      <Select
        name="cadence"
        label={labels.cadence}
        value={cadence}
        onChange={(event) => setCadence(event.target.value)}
        options={[
          { value: 'WEEKLY', label: labels.weekly },
          { value: 'MONTHLY_SPLIT_WEEKLY', label: labels.monthlySplit },
        ]}
        className="w-[190px]"
      />
      <Input
        name="amount"
        label={labels.amount}
        inputMode="decimal"
        className="w-[120px]"
      />
      {/* NO MONTHLY TOTAL FIELD, AND NO TARGET. A standing charge carries
       * neither column — a target is a per-driver balance ("$2500 escrow, $500
       * left") and an org-wide one would race between two statements refreshed
       * at once. Offering either would be offering a way to be refused. */}
      <Input
        name="effectiveFrom"
        type="date"
        label={labels.from}
        className="w-[150px]"
      />
      <Input
        name="description"
        label={labels.description}
        className="w-[220px]"
      />
      <Button type="submit" variant="primary" size="compact" disabled={pending}>
        {labels.save}
      </Button>
      <Button variant="ghost" size="compact" onClick={() => setOpen(false)}>
        {labels.cancel}
      </Button>
      {state.error ? (
        <p className="w-full text-xs text-danger" role="alert">
          {errors[state.error] ?? state.error}
        </p>
      ) : null}
    </form>
  )
}
