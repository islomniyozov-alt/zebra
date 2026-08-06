'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { recordPaymentAction } from '../actions'
import { PAYMENT_INITIAL, type PaymentState } from '../payment-state'

// Recording is deliberately SHORT: what landed, from whom, when, and how.
//
// It does not ask what the money paid, because at the moment a bank line
// appears that is frequently not known — and a form that demands the answer
// gets a guess. Applying is the next screen, and it can wait a week.

interface Props {
  companies: readonly SelectOption[]
  customers: readonly SelectOption[]
  methods: readonly SelectOption[]
  /** Today, as the server sees it — the client's clock is not the record. */
  today: string
  translate: Record<string, string>
  labels: {
    heading: string
    authority: string
    payer: string
    method: string
    reference: string
    referenceHint: string
    amount: string
    received: string
    notes: string
    save: string
    cancel: string
  }
}

export function RecordForm({
  companies,
  customers,
  methods,
  today,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<PaymentState, FormData>(
    recordPaymentAction,
    PAYMENT_INITIAL,
  )

  return (
    <form
      action={act}
      className="flex flex-col gap-z4 rounded-card border border-border bg-surface p-z4"
    >
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-z3">
        <Input
          name="amount"
          label={labels.amount}
          required
          inputMode="decimal"
          autoFocus
        />
        <Input
          name="receivedAt"
          label={labels.received}
          required
          defaultValue={today}
          // "810" is the 10th of August — the same typed-date field as the
          // load form, for the same measured reason (see typed-date.ts).
          inputMode="numeric"
        />
        <Select
          name="method"
          label={labels.method}
          required
          options={methods}
        />
        <Input
          name="referenceNumber"
          label={labels.reference}
          hint={labels.referenceHint}
        />
        <Select
          name="companyId"
          label={labels.authority}
          required
          options={companies}
        />
        <Select name="customerId" label={labels.payer} options={customers} />
        <Input name="notes" label={labels.notes} />
      </div>

      <div className="flex items-center gap-z3">
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </Button>
        <Link href="/payments" className="text-sm text-ink-2 hover:text-ink">
          {labels.cancel}
        </Link>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {translate[state.error] ?? state.error}
          </p>
        ) : null}
      </div>
    </form>
  )
}
