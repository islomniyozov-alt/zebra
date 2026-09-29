'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { openWeekAction } from '../actions'
import { PAYROLL_INITIAL } from '../state'

interface Props {
  /** The Sunday of the week Create would open. Re-validated server-side. */
  week: string
  disabled: boolean
  label: string
  weekLabel: string
}

/**
 * Create, with the week it would create written on it.
 *
 * ── THE BUTTON NAMES THE WEEK, NOT THE RANGE ──────────────────────────────
 *
 * The screen above it is filtered by a date range and the batch is a
 * settlement week; those are usually the same seven days and occasionally are
 * not. A button reading only "Create" after somebody typed a range would leave
 * the difference invisible until a batch existed for a week they had not
 * chosen.
 *
 * IT REUSES `openWeekAction`. The Batches page's own Open button posts the same
 * form to the same action — one create, two entry points, which is the rule
 * `openBatch` itself was written under.
 */
export function CreateBatch({ week, disabled, label, weekLabel }: Props) {
  const [state, open, pending] = useActionState(openWeekAction, PAYROLL_INITIAL)

  return (
    <form action={open} className="flex items-center gap-z2">
      <input type="hidden" name="week" value={week} />
      <Button
        type="submit"
        variant="primary"
        size="compact"
        disabled={disabled || pending}
        aria-disabled={disabled}
      >
        {label} {weekLabel}
      </Button>
      {state.error ? (
        <p className="text-xs text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
