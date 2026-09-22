'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { RecordFormState } from '@/components/forms/RecordForm'

// RECORDING WHAT HAPPENED TO ONE SELECTION.
//
// A `<details>` rather than a modal, for the same reason the register's void
// control is one: this screen is read beside an auditor and printed, and a
// dialog prints as nothing.
//
// THE REASON BOX APPEARS ONLY FOR "NOT TESTED", and it is required when it
// does. §382.305(j)(3) allows a selected driver to be excused, but each one
// needs a reason on the record — the database refuses it without one, and
// this asks before the server has to.

const INITIAL: RecordFormState = { error: null, field: null }

interface Props {
  action: (
    previous: RecordFormState,
    formData: FormData,
  ) => Promise<RecordFormState>
  labels: {
    resolve: string
    tested: string
    notTested: string
    outcome: string
    reason: string
    reasonHint: string
    testedAt: string
    save: string
  }
}

export function ResolveSelection({ action, labels }: Props) {
  const [state, submit, pending] = useActionState(action, INITIAL)
  const [outcome, setOutcome] = useState('TESTED')

  return (
    <details className="inline-block print:hidden">
      <summary className="cursor-pointer list-none text-xs text-ink-3 hover:text-accent">
        {labels.resolve}
      </summary>
      <form action={submit} className="mt-z2 flex flex-col gap-z2">
        <label className="flex flex-col gap-z1 text-xs text-ink-2">
          {labels.outcome}
          <select
            name="outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            className="h-control rounded-control border border-border bg-surface px-z2 text-sm text-ink"
          >
            <option value="TESTED">{labels.tested}</option>
            <option value="NOT_TESTED">{labels.notTested}</option>
          </select>
        </label>

        {outcome === 'TESTED' ? (
          <label className="flex flex-col gap-z1 text-xs text-ink-2">
            {labels.testedAt}
            <input
              type="date"
              name="testedAt"
              className="h-control rounded-control border border-border bg-surface px-z2 text-sm text-ink"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-z1 text-xs text-ink-2">
            {labels.reason}
            <input
              name="reason"
              required
              className="h-control rounded-control border border-border bg-surface px-z2 text-sm text-ink"
            />
            <span className="max-w-[46ch] text-xs text-ink-3">
              {labels.reasonHint}
            </span>
          </label>
        )}

        {state.error ? (
          <p className="text-xs text-danger">{state.error}</p>
        ) : null}
        <Button type="submit" variant="ghost" size="compact" disabled={pending}>
          {labels.save}
        </Button>
      </form>
    </details>
  )
}
