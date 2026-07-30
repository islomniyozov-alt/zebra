'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { signInAction, type AuthFormState } from '../actions'

// The client half of the login screen. The action is a server action, so the
// form posts and works with JavaScript disabled; this adds the pending state
// and the error slot on top.

interface LoginFormProps {
  /** Pre-translated strings, so this component does no i18n of its own. */
  labels: Record<'signIn' | 'email' | 'password' | 'forgot', string>
  /** Pre-translated error strings, keyed by the action's error key. */
  errors: Record<string, string>
}

const INITIAL: AuthFormState = { error: null }

export function LoginForm({ labels, errors }: LoginFormProps) {
  const [state, action, pending] = useActionState(signInAction, INITIAL)

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
      <Input
        label={labels.password}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />

      {/* One error region, above the button, in the interface's voice. It says
       * what happened — never which half of the credentials was wrong. */}
      {state.error ? (
        <p role="alert" className="text-base text-danger">
          {errors[state.error] ?? errors['auth.invalid']}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="large" disabled={pending}>
        {labels.signIn}
      </Button>

      <Link
        href="/reset-password"
        className="text-base text-accent underline underline-offset-2"
      >
        {labels.forgot}
      </Link>
    </form>
  )
}
