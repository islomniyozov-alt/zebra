'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { applyToInvoiceAction } from '../actions'
import { PAYMENT_INITIAL, type PaymentState } from '../payment-state'

// A broker pays a DOCUMENT. Choose which one and say how much of this payment
// settles it — usually all of the balance, sometimes less, and the field is
// pre-filled with the smaller of the two so the common case is one click.

export interface OpenInvoice {
  invoiceId: string
  invoiceNumber: string
  due: string
  balanceCents: number
  /** Pre-formatted for the amount box: min(balance, unapplied). */
  suggested: string
  balance: string
}

interface Props {
  paymentId: string
  invoices: readonly OpenInvoice[]
  translate: Record<string, string>
  labels: {
    heading: string
    hint: string
    invoice: string
    amount: string
    apply: string
    unapplied: string
  }
}

export function ApplyToInvoice({
  paymentId,
  invoices,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<PaymentState, FormData>(
    applyToInvoiceAction.bind(null, paymentId),
    PAYMENT_INITIAL,
  )
  const [chosen, setChosen] = useState(invoices[0]?.invoiceId ?? '')

  const invoice = invoices.find((row) => row.invoiceId === chosen)

  return (
    <form action={act} className="flex flex-col gap-z3">
      <div>
        <h2 className="text-md font-medium text-ink">{labels.heading}</h2>
        <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-end gap-z3">
        <Select
          name="invoiceId"
          label={labels.invoice}
          required
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          options={invoices.map((row) => ({
            value: row.invoiceId,
            label: `${row.invoiceNumber} · ${row.balance} · ${row.due}`,
          }))}
        />
        <Input
          name="amount"
          label={labels.amount}
          required
          inputMode="decimal"
          // `key` forces the box to re-take its default when the invoice
          // changes; an uncontrolled input keeps the old value otherwise, and
          // the old value is the previous invoice's balance.
          key={chosen}
          defaultValue={invoice?.suggested ?? ''}
        />
        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {labels.apply}
          </Button>
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {translate[state.error] ?? state.error}
        </p>
      ) : null}
      {state.unappliedCents !== null && !state.error ? (
        <p role="status" className="text-sm text-ink-2">
          {labels.unapplied}
        </p>
      ) : null}
    </form>
  )
}
