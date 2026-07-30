'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { confirmResetAction, type ResetConfirmState } from '../../reset-actions'

interface Props {
  token: string
  labels: Record<'newPassword' | 'confirmPassword' | 'save' | 'done', string>
  errors: Record<string, string>
}

const INITIAL: ResetConfirmState = { error: null, done: false }

export function ResetConfirmForm({ token, labels, errors }: Props) {
  const [state, action, pending] = useActionState(confirmResetAction, INITIAL)

  if (state.done) {
    return (
      <p role="status" className="text-base text-success">
        {labels.done}
      </p>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-z4">
      {/* The token rides in a hidden field rather than the query string: it is
       * a bearer capability, and the query string lands in history and in
       * every referrer along the way. */}
      <input type="hidden" name="token" value={token} />
      <Input
        label={labels.newPassword}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        autoFocus
      />
      <Input
        label={labels.confirmPassword}
        name="confirmation"
        type="password"
        autoComplete="new-password"
        required
      />
      {state.error ? (
        <p role="alert" className="text-base text-danger">
          {errors[state.error] ?? errors['auth.reset.invalidToken']}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="large" disabled={pending}>
        {labels.save}
      </Button>
    </form>
  )
}
