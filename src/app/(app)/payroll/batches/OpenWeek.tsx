'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { openWeekAction } from './actions'
import { PAYROLL_INITIAL } from './state'

interface Props {
  /** The Sunday, as `yyyy-mm-dd`. Posted back and re-validated server-side. */
  week: string
  label: string
}

/** Open a batch for the week being looked at. The only write this page adds. */
export function OpenWeek({ week, label }: Props) {
  const [state, open, pending] = useActionState(openWeekAction, PAYROLL_INITIAL)

  return (
    <form action={open} className="flex items-center gap-z2">
      <input type="hidden" name="week" value={week} />
      <Button type="submit" variant="primary" size="compact" disabled={pending}>
        {label}
      </Button>
      {state.error ? (
        <p className="text-xs text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
