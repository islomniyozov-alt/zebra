'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { requestResetAction, type ResetRequestState } from '../reset-actions'

interface Props {
  labels: Record<'email' | 'send' | 'sent' | 'rateLimited', string>
}

const INITIAL: ResetRequestState = { status: 'idle' }

export function ResetRequestForm({ labels }: Props) {
  const [state, action, pending] = useActionState(requestResetAction, INITIAL)

  // One sentence for both "sent" and "no such account". The difference is
  // exactly the fact worth hiding.
  if (state.status === 'sent') {
    return (
      <p role="status" className="text-base text-success">
        {labels.sent}
      </p>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-z4">
      <Input
        label={labels.email}
        name="email"
        type="email"
        autoComplete="username"
        required
        autoFocus
      />
      {state.status === 'rate_limited' ? (
        <p role="alert" className="text-base text-danger">
          {labels.rateLimited}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="large" disabled={pending}>
        {labels.send}
      </Button>
    </form>
  )
}
