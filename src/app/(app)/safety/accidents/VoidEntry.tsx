'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import type { RecordFormState } from '@/components/forms/RecordForm'

// VOIDING AN ENTRY, WITH THE REASON ATTACHED.
//
// A `<details>` rather than a modal: the register is a printable document and
// a dialog that cannot be printed is the wrong shape for a screen somebody
// reads beside an auditor. Closed, it is a link; open, it is a reason box.
//
// THERE IS NO DELETE HERE AND THERE IS NO DELETE ANYWHERE. `Accident` has no
// `deletedAt` column, `accidents.ts` exports no delete, and this is the only
// control that changes an entry after it is filed.

const INITIAL: RecordFormState = { error: null, field: null }

interface Props {
  action: (
    previous: RecordFormState,
    formData: FormData,
  ) => Promise<RecordFormState>
  labels: {
    void: string
    title: string
    body: string
    reason: string
    confirm: string
  }
}

export function VoidEntry({ action, labels }: Props) {
  const [state, submit, pending] = useActionState(action, INITIAL)

  return (
    <details className="inline-block">
      <summary className="cursor-pointer list-none text-xs text-ink-3 hover:text-accent">
        {labels.void}
      </summary>
      <form action={submit} className="mt-z2 flex flex-col gap-z2">
        <p className="max-w-[46ch] text-xs text-ink-3">{labels.body}</p>
        <label className="flex flex-col gap-z1 text-xs text-ink-2">
          {labels.reason}
          <input
            name="voidReason"
            required
            className="h-control rounded-control border border-border bg-surface px-z2 text-sm text-ink"
          />
        </label>
        {state.error ? (
          <p className="text-xs text-danger">{state.error}</p>
        ) : null}
        <Button type="submit" variant="ghost" size="compact" disabled={pending}>
          {labels.confirm}
        </Button>
      </form>
    </details>
  )
}
