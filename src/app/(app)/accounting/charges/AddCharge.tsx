'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { addChargeAction } from './actions'
import { CHARGE_INITIAL } from './state'

interface Props {
  drivers: readonly { id: string; name: string }[]
  types: readonly string[]
  labels: {
    add: string
    cancel: string
    save: string
    driver: string
    type: string
    cadence: string
    weekly: string
    monthlySplit: string
    amount: string
    monthlyTotal: string
    target: string
    description: string
    from: string
  }
  /**
   * Every refusal sentence this form can be handed, keyed by the message key the
   * action returns — ALREADY TRANSLATED.
   *
   * AN OBJECT, NOT A FUNCTION. A closure over `t` cannot be serialised across the
   * server/client boundary: React refuses it and the page 500s. That is how the
   * first version of this shipped past typecheck, lint and 2,418 tests, and it
   * was found by photographing the screen.
   */
  errors: Record<string, string>
}

/**
 * ADD ONE CHARGE, FOR ANY DRIVER, FROM THIS SCREEN.
 *
 * The driver is the FIRST FIELD, which is §6.3's rule about creation forms
 * turned on the thing that matters here: "the authority is an explicit, visible
 * choice at the moment of writing, not an ambient setting decided earlier and
 * elsewhere". On a cross-driver list the same hazard is the driver — a charge
 * written against the wrong one is money off the wrong person's cheque, and it
 * reads as correct on every screen that shows it.
 *
 * COLLAPSED UNTIL ASKED FOR (rule 1: density is a feature). Eight fields sitting
 * open above the list would cost eight rows of comparison on a 1080p screen, and
 * comparison is what the list is for.
 */
export function AddCharge({ drivers, types, labels, errors }: Props) {
  const [open, setOpen] = useState(false)
  const [state, add, pending] = useActionState(addChargeAction, CHARGE_INITIAL)
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
      {/* THE DRIVER FIRST. See the header. */}
      <Select
        name="driverId"
        label={labels.driver}
        options={drivers.map((driver) => ({
          value: driver.id,
          label: driver.name,
        }))}
        className="w-[220px]"
      />
      <Select
        name="type"
        label={labels.type}
        options={types.map((type) => ({ value: type, label: type }))}
        className="w-[150px]"
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
      {/* Only where the cadence trues up to a month's total. Offering it on a
       * weekly rule would be offering a way to be refused. */}
      {cadence === 'MONTHLY_SPLIT_WEEKLY' ? (
        <Input
          name="monthlyTotal"
          label={labels.monthlyTotal}
          inputMode="decimal"
          className="w-[120px]"
        />
      ) : null}
      <Input
        name="target"
        label={labels.target}
        inputMode="decimal"
        className="w-[120px]"
      />
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
