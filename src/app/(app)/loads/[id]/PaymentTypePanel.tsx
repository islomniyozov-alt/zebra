'use client'

import { useActionState } from 'react'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'

export interface PaymentTypeState {
  error: string | null
  saved: boolean
}

const INITIAL: PaymentTypeState = { error: null, saved: false }

interface Props {
  /** One of PAYMENT_TYPES, or null when nobody has said. */
  value: string | null
  /** The four, already translated is wrong — these are codes, shown as-is. */
  options: readonly string[]
  disabled: boolean
  save: (
    previous: PaymentTypeState,
    formData: FormData,
  ) => Promise<PaymentTypeState>
  labels: {
    title: string
    hint: string
    none: string
    save: string
    saving: string
    saved: string
  }
}

/**
 * The arrangement this load was booked under.
 *
 * ── ITS OWN ACTION, NOT THE RATE FORM ────────────────────────────────────
 *
 * The obvious place was `RatePanel`, and it was wrong: `setLoadRate` parses
 * money and returns money failures, and threading a code list through it would
 * make one function answer two unrelated questions badly. A label that drives
 * no arithmetic gets its own small action.
 *
 * ── THE CODES ARE NOT TRANSLATED ─────────────────────────────────────────
 *
 * "Quickpay", "Factored", "ACH", "Direct" are what the desk says and what the
 * invoice will carry; a localised label here would be a second vocabulary for
 * the same four values, and the receivables column would disagree with this
 * screen in two languages out of three.
 */
export function PaymentTypePanel({
  value,
  options,
  disabled,
  save,
  labels,
}: Props) {
  const [state, action, pending] = useActionState(save, INITIAL)

  return (
    <section className="flex flex-col gap-z3 rounded-card border border-border bg-surface p-z4">
      <div className="flex flex-col gap-z1">
        <h2 className="text-sm font-semibold text-ink">{labels.title}</h2>
        <p className="text-xs text-ink-3">{labels.hint}</p>
      </div>

      <form action={action} className="flex flex-col gap-z3">
        <Select
          name="paymentType"
          label={labels.title}
          options={[
            { value: '', label: labels.none },
            ...options.map((code) => ({ value: code, label: code })),
          ]}
          defaultValue={value ?? ''}
          disabled={disabled || pending}
        />

        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        {state.saved ? (
          <p className="text-sm text-success">{labels.saved}</p>
        ) : null}

        <div>
          <Button type="submit" disabled={disabled || pending}>
            {pending ? labels.saving : labels.save}
          </Button>
        </div>
      </form>
    </section>
  )
}
