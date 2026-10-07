'use client'

import { useActionState, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { saveTicksAction } from '../actions'

// THE BATCH SCREEN'S TICKS (§6.2.10 part 2b): the same form the picker has,
// over a batch that already exists. The grid's checkboxes are this form's
// inputs; Save posts shown and ticked, and `setExclusions` writes the delta.
//
// THE COUNT IS LIVE AND IT IS THE BUTTON'S OWN LABEL — "Save ticks · 31 in" is
// a sentence a person can check against the screen before pressing it.

const INITIAL = { error: null as string | null, blocked: [] as string[] }

interface Props {
  batchId: string
  /** How many boxes the grid rendered ticked, so the count starts right. */
  ticked: number
  labels: {
    /** `Save ticks · {count} in` — `{count}` substituted live. */
    save: string
    saving: string
    selectAll: string
  }
  children: ReactNode
}

export function BatchTicks({ batchId, ticked, labels, children }: Props) {
  const [state, save, pending] = useActionState(
    saveTicksAction.bind(null, batchId),
    INITIAL,
  )
  const form = useRef<HTMLFormElement>(null)
  const [picked, setPicked] = useState(ticked)

  // COUNTED OFF THE DOM, not mirrored into React state per row: the inputs are
  // server-rendered inside this form, so the form is the source of truth.
  const recount = () => {
    const boxes =
      form.current?.querySelectorAll<HTMLInputElement>('input[name="trip"]')
    if (!boxes) return
    setPicked([...boxes].filter((box) => box.checked).length)
  }

  const selectAll = () => {
    const boxes =
      form.current?.querySelectorAll<HTMLInputElement>('input[name="trip"]')
    if (!boxes) return
    for (const box of boxes) box.checked = true
    recount()
  }

  return (
    <form action={save} ref={form} onChange={recount}>
      <div className="flex items-center gap-z3 border-b border-border bg-surface-2 px-gutter py-z2">
        <Button
          type="button"
          variant="secondary"
          size="compact"
          onClick={selectAll}
          disabled={pending}
        >
          {labels.selectAll}
        </Button>
        <span className="ms-auto">
          <Button
            type="submit"
            variant="primary"
            size="compact"
            disabled={pending}
          >
            {pending
              ? labels.saving
              : labels.save.replace('{count}', String(picked))}
          </Button>
        </span>
      </div>
      {state.error ? (
        <p
          className="border-b border-border bg-danger-soft px-gutter py-z2 text-xs text-danger"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      {children}
    </form>
  )
}
