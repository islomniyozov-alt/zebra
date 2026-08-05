'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { markSentAction } from '../actions'
import { INVOICE_INITIAL, type InvoiceState } from '../invoice-state'

// §6's honest constraint, as a control.
//
// There is no send button, and there will not be one until RESEND_FROM is on a
// verified domain — the only working sender reaches the owner's inbox alone,
// so a button promising to email a broker would reach nobody and report
// success. Download, send it yourself, then tell the system you did.
//
// The CHANNEL is required rather than optional because "did we send it?" and
// "where did it go?" are different questions during a payment chase, and the
// second is the one that gets answered wrong from memory a month later.

interface Props {
  invoiceId: string
  labels: { markSent: string; channel: string; channelHint: string }
  translate: Record<string, string>
}

export function MarkSent({ invoiceId, labels, translate }: Props) {
  const [state, act, pending] = useActionState<InvoiceState, FormData>(
    markSentAction.bind(null, invoiceId),
    INVOICE_INITIAL,
  )

  return (
    <form action={act} className="flex flex-wrap items-end gap-z2">
      <Input
        name="channel"
        label={labels.channel}
        hint={labels.channelHint}
        required
        className="w-[240px]"
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        {labels.markSent}
      </Button>
      {state.error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {translate[state.error] ?? state.error}
        </p>
      ) : null}
    </form>
  )
}
