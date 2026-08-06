'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { generateSettlementAction } from './actions'
import { SETTLEMENT_INITIAL, type SettlementState } from './settlement-state'

// One driver, one week.
//
// The dates DEFAULT TO THE LAST FULL WEEK, because that is what somebody
// opening this screen on a Monday morning wants and typing two dates to get it
// is the friction that makes people put settlements off. They stay editable —
// a week gets missed, and catching up must not require arithmetic.

interface Props {
  drivers: readonly SelectOption[]
  defaultStart: string
  defaultEnd: string
  translate: Record<string, string>
  labels: {
    heading: string
    hint: string
    driver: string
    from: string
    to: string
    generate: string
  }
}

export function GeneratePanel({
  drivers,
  defaultStart,
  defaultEnd,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<SettlementState, FormData>(
    generateSettlementAction,
    SETTLEMENT_INITIAL,
  )

  return (
    <section className="border-b border-border bg-surface px-gutter py-z4">
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      <form action={act} className="mt-z3 flex flex-wrap items-end gap-z3">
        <Select
          name="driverId"
          label={labels.driver}
          required
          options={drivers}
          className="w-[240px]"
        />
        <Input
          name="periodStart"
          label={labels.from}
          required
          defaultValue={defaultStart}
          inputMode="numeric"
          className="w-[140px]"
        />
        <Input
          name="periodEnd"
          label={labels.to}
          required
          defaultValue={defaultEnd}
          inputMode="numeric"
          className="w-[140px]"
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.generate}
        </Button>
      </form>

      {state.error ? (
        <p role="alert" className="mt-z2 max-w-[68ch] text-sm text-danger">
          {/* The refusals name the loads. "Nothing to settle" and "these three
           * loads have no rule" send a person to different places. */}
          {(translate[state.error] ?? state.error).replace(
            '{loads}',
            state.loadNumbers.join(', '),
          )}
        </p>
      ) : null}
    </section>
  )
}
