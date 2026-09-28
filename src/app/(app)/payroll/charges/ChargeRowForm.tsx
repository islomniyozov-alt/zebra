'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { closeChargeAction, editChargeAction } from './actions'
import { CHARGE_INITIAL } from './state'

interface Props {
  chargeId: string
  driverId: string
  amount: string
  monthlyTotal: string
  target: string
  description: string
  /** MONTHLY_SPLIT_WEEKLY — the only cadence with a month's total to true up. */
  splitsMonthly: boolean
  labels: {
    edit: string
    save: string
    cancel: string
    stop: string
    stopOn: string
    amount: string
    monthlyTotal: string
    target: string
    description: string
  }
  /**
   * Every refusal sentence this form can be handed, keyed by the message key the
   * action returns — ALREADY TRANSLATED.
   *
   * AN OBJECT, NOT A FUNCTION. A closure over `t` cannot be serialised across
   * the server/client boundary: React refuses it and the page 500s. That is how
   * the first version of this shipped past typecheck, lint and 2,418 tests, and
   * it was found by photographing the screen.
   */
  errors: Record<string, string>
}

/**
 * ONE ROW'S EDITOR, OPENED IN PLACE.
 *
 * ── WHY IN PLACE AND NOT A MODAL ──────────────────────────────────────────
 *
 * §7.5: "Modals hold six fields at most. Anything larger is a full page." This
 * is four fields, so a modal would be permitted — and would still be wrong here.
 * The question somebody is answering is comparative: "is Insurance $450 for
 * everybody?" A modal covers the rows they are comparing against, which is the
 * whole reason they came to a cross-driver list rather than a driver page.
 *
 * ── THE ROW DOES NOT MOVE WHEN IT OPENS ───────────────────────────────────
 *
 * §11: table rows never animate, and content that moves while being read gets
 * misread. The editor replaces the cells' contents; it does not slide a panel in
 * under them.
 *
 * ── STOP IS NOT DELETE, AND IT IS NOT ACCENT-COLOURED ─────────────────────
 *
 * Rule 11: destructive actions are never accent-coloured. Stopping a charge is
 * `ghost` with danger text. It is also not destructive in the real sense — the
 * row stays and `effectiveTo` closes it, because a settlement already computed
 * from this rule printed a line that has to remain explicable.
 */
export function ChargeRowForm({
  chargeId,
  driverId,
  amount,
  monthlyTotal,
  target,
  description,
  splitsMonthly,
  labels,
  errors,
}: Props) {
  const [open, setOpen] = useState<'none' | 'edit' | 'stop'>('none')
  const [editState, edit, editing] = useActionState(
    editChargeAction.bind(null, chargeId, driverId),
    CHARGE_INITIAL,
  )
  const [stopState, stop, stopping] = useActionState(
    closeChargeAction.bind(null, chargeId, driverId),
    CHARGE_INITIAL,
  )

  const error = editState.error ?? stopState.error

  if (open === 'none') {
    return (
      <div className="flex items-center gap-z1">
        <Button variant="ghost" size="compact" onClick={() => setOpen('edit')}>
          {labels.edit}
        </Button>
        <Button
          variant="ghost"
          size="compact"
          className="text-danger"
          onClick={() => setOpen('stop')}
        >
          {labels.stop}
        </Button>
        {error ? (
          <span className="text-xs text-danger" role="alert">
            {errors[error] ?? error}
          </span>
        ) : null}
      </div>
    )
  }

  if (open === 'stop') {
    return (
      <form action={stop} className="flex flex-wrap items-end gap-z1">
        <Input
          name="effectiveTo"
          type="date"
          label={labels.stopOn}
          className="w-[150px]"
        />
        <Button
          type="submit"
          variant="danger"
          size="compact"
          disabled={stopping}
        >
          {labels.stop}
        </Button>
        <Button variant="ghost" size="compact" onClick={() => setOpen('none')}>
          {labels.cancel}
        </Button>
        {error ? (
          <p className="w-full text-xs text-danger" role="alert">
            {errors[error] ?? error}
          </p>
        ) : null}
      </form>
    )
  }

  return (
    <form action={edit} className="flex flex-wrap items-end gap-z1">
      <Input
        name="amount"
        label={labels.amount}
        defaultValue={amount}
        inputMode="decimal"
        className="w-[110px]"
      />
      {/* THE MONTH'S TOTAL ONLY WHERE THE CADENCE HAS ONE. Sent on a weekly rule
       * it is refused by the writer — correctly — so offering the field would be
       * offering a way to fail. */}
      {splitsMonthly ? (
        <Input
          name="monthlyTotal"
          label={labels.monthlyTotal}
          defaultValue={monthlyTotal}
          inputMode="decimal"
          className="w-[110px]"
        />
      ) : null}
      <Input
        name="target"
        label={labels.target}
        defaultValue={target}
        inputMode="decimal"
        className="w-[110px]"
      />
      <Input
        name="description"
        label={labels.description}
        defaultValue={description}
        className="w-[200px]"
      />
      <Button type="submit" variant="primary" size="compact" disabled={editing}>
        {labels.save}
      </Button>
      <Button variant="ghost" size="compact" onClick={() => setOpen('none')}>
        {labels.cancel}
      </Button>
      {error ? (
        <p className="w-full text-xs text-danger" role="alert">
          {errors[error] ?? error}
        </p>
      ) : null}
    </form>
  )
}
