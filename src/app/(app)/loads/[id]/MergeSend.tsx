'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import type { PacketSendState } from './packet-send-actions'

// MERGE & SEND (TMS §7.14 item 6). The button names where the packet goes;
// no address names the empty field and links to where it is filled. The rule
// is `sendInvoicePacket`; this carries the click and says what happened.

export function MergeSend({
  action,
  recipient,
  labels,
}: {
  action: (
    previous: PacketSendState,
    formData: FormData,
  ) => Promise<PacketSendState>
  recipient: { to: string } | { missing: string; href: string }
  labels: { send: string; sending: string; to: string; fix: string }
}) {
  const [state, act, pending] = useActionState<PacketSendState, FormData>(
    action,
    { error: null, notice: null },
  )
  if ('missing' in recipient) {
    return (
      <p data-merge-send className="text-xs text-ink-2">
        {recipient.missing}{' '}
        <Link className="underline underline-offset-2" href={recipient.href}>
          {labels.fix}
        </Link>
      </p>
    )
  }
  return (
    <form data-merge-send action={act} className="flex flex-col gap-z1">
      <div className="flex flex-wrap items-center gap-z2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? labels.sending : labels.send}
        </Button>
        <span className="text-xs text-ink-2">
          {labels.to.replace('{to}', recipient.to)}
        </span>
      </div>
      {state.notice ? (
        <p role="status" className="text-sm text-ink">
          {state.notice}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
