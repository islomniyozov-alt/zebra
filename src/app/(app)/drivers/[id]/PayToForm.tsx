'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { savePayToAction } from '../pay-actions'
import { PAY_TO_INITIAL, type PayToState } from '../pay-state'

// WHO THE STATEMENT IS MADE OUT TO (§6.4 part 2, queue item 17).
//
// Its own form rather than two more fields on Main, because the gate differs:
// Main is `driver:update`, this is `driver.pay:update` — the permission the
// pay rules beside it carry. A MANAGER sees the values and a disabled form; a
// DISPATCHER never reaches this tab at all.
//
// ONE SAVE, TWO FIELDS, A SENTENCE. The sentence says what the fields reach:
// the next statement, never one already issued, because generation freezes
// them onto the row.

interface Props {
  driverId: string
  payToName: string | null
  payToAddress: string | null
  disabled: boolean
  labels: {
    name: string
    address: string
    save: string
    saving: string
    saved: string
    hint: string
  }
}

export function PayToForm({
  driverId,
  payToName,
  payToAddress,
  disabled,
  labels,
}: Props) {
  const [state, action, pending] = useActionState<PayToState, FormData>(
    savePayToAction.bind(null, driverId),
    PAY_TO_INITIAL,
  )

  return (
    <form action={action} className="mt-z3 flex flex-col gap-z3">
      <div className="grid gap-z3 sm:grid-cols-2">
        <Input
          name="payToName"
          label={labels.name}
          defaultValue={payToName ?? ''}
          disabled={disabled || pending}
          maxLength={120}
        />
        <Input
          name="payToAddress"
          label={labels.address}
          defaultValue={payToAddress ?? ''}
          disabled={disabled || pending}
          maxLength={240}
        />
      </div>
      <p className="text-xs text-ink-3">{labels.hint}</p>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.saved && !state.error ? (
        <p role="status" className="text-sm text-ink-2">
          {labels.saved}
        </p>
      ) : null}
      {disabled ? null : (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? labels.saving : labels.save}
          </Button>
        </div>
      )}
    </form>
  )
}
