'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { changeNameAction, type NameFormState } from './actions'

// ---------------------------------------------------------------------------
// YOUR OWN NAME, WHICH NOTHING COULD CHANGE UNTIL 2026-09-06.
//
// Production held `Owner`, `Dispatch`, `Accounting` and `Disptach` — job
// labels rather than people, one of them a typo of a job label — and they had
// been wrong since each account was made. Nobody could have fixed them: no
// screen displayed a name and no screen edited one.
//
// IT DOES NOT CLEAR ITSELF ON SUCCESS, unlike the password form beside it.
// That form empties because holding three password fields after a successful
// change is a liability; this one keeps the value because the value is the
// point — you have just told the application what you are called and it should
// still be on the screen saying so.
// ---------------------------------------------------------------------------

const INITIAL: NameFormState = { error: null, done: false }

interface Props {
  current: string
  labels: { label: string; save: string; saved: string }
  errors: Record<string, string>
}

export function NameForm({ current, labels, errors }: Props) {
  const [state, action, pending] = useActionState(changeNameAction, INITIAL)

  return (
    <form action={action} className="flex flex-col gap-z3">
      <Input
        label={labels.label}
        name="name"
        defaultValue={current}
        autoComplete="name"
        maxLength={120}
        required
      />
      {state.error ? (
        <p role="alert" className="text-base text-danger">
          {errors[state.error] ?? state.error}
        </p>
      ) : null}
      {state.done ? (
        <p role="status" className="text-base text-success">
          {labels.saved}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        className="self-start"
      >
        {labels.save}
      </Button>
    </form>
  )
}
