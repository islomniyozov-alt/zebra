'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { changePasswordAction, type PasswordFormState } from './actions'

interface Props {
  /** Pre-translated. A translator closure cannot cross to a client component. */
  labels: Record<
    'current' | 'next' | 'confirm' | 'save' | 'done' | 'hint',
    string
  >
  errors: Record<string, string>
}

const INITIAL: PasswordFormState = { error: null, done: false }

export function PasswordForm({ labels, errors }: Props) {
  const [state, action, pending] = useActionState(changePasswordAction, INITIAL)

  if (state.done) {
    return (
      <p role="status" className="text-base text-success">
        {labels.done}
      </p>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-z4">
      <Input
        label={labels.current}
        name="current"
        type="password"
        autoComplete="current-password"
        required
      />
      <Input
        label={labels.next}
        name="password"
        type="password"
        autoComplete="new-password"
        hint={labels.hint}
        required
      />
      <Input
        label={labels.confirm}
        name="confirmation"
        type="password"
        autoComplete="new-password"
        required
      />
      {state.error ? (
        <p role="alert" className="text-base text-danger">
          {errors[state.error] ?? errors['account.password.wrongCurrent']}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {labels.save}
      </Button>
    </form>
  )
}
