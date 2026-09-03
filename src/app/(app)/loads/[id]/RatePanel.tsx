'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { formatCents, parseMoneyToCents } from '@/lib/money'
import {
  addAccessorialAction,
  removeAccessorialAction,
  setRateAction,
} from './rate-actions'
import { RATE_INITIAL, type RateState } from './rate-state'
// §5 step 1 — what a load is worth, entered by OWNER or ACCOUNTING.
//
// THE LIVE TOTAL IS COMPUTED THE SAME WAY THE SERVER COMPUTES IT: integer
// cents, added. It is not a preview of a different calculation — rule 9-money
// requires a reader to reproduce a displayed figure from the stored integers,
// and two implementations of one sum is how the screen and the invoice come to
// disagree by a cent that nobody can find.
//
// A typed value that does not parse leaves the total showing the LAST GOOD
// one rather than jumping to zero. Half-typed input is not a rate of nothing.

export interface AccessorialRow {
  id: string
  type: string
  typeLabel: string
  amountCents: number
  isBillable: boolean
}

interface Props {
  loadId: string
  linehaulCents: number
  fuelSurchargeCents: number
  /**
   * Amazon loads show Linehaul alone.
   *
   * Dispatch read the second box as a second rate and asked which one Relay
   * pays; Relay pays one figure. The COLUMN stays and settlements still sum
   * it — this hides an input, it does not change what a load can carry, and
   * the hidden field below keeps the stored value intact so saving the rate
   * on a screen that cannot see the surcharge cannot zero it.
   */
  showFuelSurcharge: boolean
  accessorials: readonly AccessorialRow[]
  mayEdit: boolean
  accessorialTypes: readonly { value: string; label: string }[]
  locale: string
  labels: {
    title: string
    linehaul: string
    fuelSurcharge: string
    accessorials: string
    total: string
    save: string
    saved: string
    add: string
    amount: string
    billable: string
    remove: string
    none: string
  }
  translate: Record<string, string>
}

export function RatePanel({
  loadId,
  linehaulCents,
  fuelSurchargeCents,
  showFuelSurcharge,
  accessorials,
  mayEdit,
  accessorialTypes,
  locale,
  labels,
  translate,
}: Props) {
  const [rateState, saveRate, saving] = useActionState<RateState, FormData>(
    setRateAction.bind(null, loadId),
    RATE_INITIAL,
  )
  const [accessorialState, addAccessorial, adding] = useActionState<
    RateState,
    FormData
  >(addAccessorialAction.bind(null, loadId), RATE_INITIAL)

  const [linehaul, setLinehaul] = useState(centsToField(linehaulCents))
  const [fuel, setFuel] = useState(centsToField(fuelSurchargeCents))

  const accessorialsCents = accessorials
    .filter((row) => row.isBillable)
    .reduce((total, row) => total + row.amountCents, 0)

  // Same three integers the server adds, added the same way.
  const liveTotal =
    safeCents(linehaul, linehaulCents) +
    safeCents(fuel, fuelSurchargeCents) +
    accessorialsCents

  const error = rateState.error ?? accessorialState.error

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>

      <form action={saveRate} className="mt-z3 flex flex-wrap items-end gap-z3">
        <Input
          name="linehaul"
          label={labels.linehaul}
          value={linehaul}
          onChange={(event) => setLinehaul(event.target.value)}
          disabled={!mayEdit}
          className="w-[140px] font-mono"
        />
        {showFuelSurcharge ? (
          <Input
            name="fuelSurcharge"
            label={labels.fuelSurcharge}
            value={fuel}
            onChange={(event) => setFuel(event.target.value)}
            disabled={!mayEdit}
            className="w-[140px] font-mono"
          />
        ) : (
          // THE VALUE TRAVELS EVEN WHEN THE BOX DOES NOT. `setLoadRate` reads
          // this field off the form; omitting it entirely would post an empty
          // string and could write zero over a surcharge somebody had entered.
          // On Amazon freight it is always zero — which is exactly the case
          // where nobody would notice it being overwritten.
          <input type="hidden" name="fuelSurcharge" value={fuel} />
        )}
        {mayEdit ? (
          <Button type="submit" variant="secondary" disabled={saving}>
            {labels.save}
          </Button>
        ) : null}
      </form>

      {/* §8: mono, tabular, right-aligned, minus not parentheses. */}
      <dl className="mt-z4 grid grid-cols-[1fr_auto] gap-x-z4 gap-y-z1 text-sm">
        <dt className="text-ink-2">{labels.accessorials}</dt>
        <dd className="text-end font-mono tabular-nums text-ink">
          {formatCents(accessorialsCents, locale)}
        </dd>
        <dt className="border-t border-border pt-z1 font-medium text-ink">
          {labels.total}
        </dt>
        <dd className="border-t border-border pt-z1 text-end font-mono tabular-nums font-medium text-ink">
          {formatCents(liveTotal, locale)}
        </dd>
      </dl>

      {rateState.savedTotalCents !== null ? (
        <p className="mt-z2 text-sm text-success">{labels.saved}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-z2 text-sm text-danger">
          {translate[error] ?? error}
        </p>
      ) : null}

      <div className="mt-z4 border-t border-border pt-z3">
        {accessorials.length === 0 ? (
          <p className="text-sm text-ink-3">{labels.none}</p>
        ) : (
          <ul className="flex flex-col gap-z1">
            {accessorials.map((row) => (
              <li
                key={row.id}
                className="flex items-baseline gap-z2 text-sm text-ink"
              >
                <span>{row.typeLabel}</span>
                <span className="font-mono tabular-nums">
                  {formatCents(row.amountCents, locale)}
                </span>
                {!row.isBillable ? (
                  <span className="text-xs text-ink-3">
                    ({labels.billable}: —)
                  </span>
                ) : null}
                {mayEdit ? (
                  <form
                    action={removeAccessorialAction.bind(null, loadId, row.id)}
                    className="ms-auto"
                  >
                    <Button type="submit" variant="ghost" size="compact">
                      {labels.remove}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {mayEdit ? (
          <form
            action={addAccessorial}
            className="mt-z3 flex flex-wrap items-end gap-z2"
          >
            <Select
              name="type"
              label={labels.add}
              options={accessorialTypes}
              className="w-[180px]"
            />
            <Input
              name="amount"
              label={labels.amount}
              className="w-[120px] font-mono"
            />
            <label className="flex items-center gap-z1 pb-z2 text-sm text-ink">
              <input type="checkbox" name="isBillable" defaultChecked />
              {labels.billable}
            </label>
            <Button type="submit" variant="ghost" disabled={adding}>
              {labels.add}
            </Button>
          </form>
        ) : null}
      </div>
    </section>
  )
}

/** Stored cents as the plain decimal a person edits. */
function centsToField(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100)
  const fraction = String(Math.abs(cents) % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}${whole}.${fraction}`
}

/**
 * The typed value in cents, or the stored one while it is unparseable.
 *
 * Falling back to the stored figure rather than to zero: mid-typing, "24" on
 * the way to "2450" is not a rate of twenty-four dollars, and a total that
 * lurches while somebody types teaches them to distrust it.
 */
function safeCents(typed: string, fallback: number): number {
  try {
    return parseMoneyToCents(typed)
  } catch {
    return fallback
  }
}
