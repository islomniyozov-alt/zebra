'use client'

import { useActionState } from 'react'
import { advanceStatusAction } from './status-actions'
import { STATUS_STEP_INITIAL, type StatusStepState } from './status-state'

// THE ONE PRIMARY ACTION ON LOAD (§9: one per screen, 52 px; Phase 7 step
// 4). A single button that names the next status in words — "At pickup",
// "Loaded" — and nothing else to press. The server re-reads the load and
// refuses a stale tap in words; the page then shows the real next step.
//
// Rendered for the DRIVER OF RECORD only. The page hands a co-driver the
// sentence instead, and the write refuses the second seat by name, so the
// absence of the button is never the only thing standing between a
// co-driver and the status.

interface Props {
  loadId: string
  /** The enum value the tap asks for, and its word in the reader's language. */
  to: string
  labels: { set: string; setting: string; landed: string }
}

export function StatusStep({ loadId, to, labels }: Props) {
  const [state, action, pending] = useActionState<StatusStepState, FormData>(
    advanceStatusAction.bind(null, loadId),
    STATUS_STEP_INITIAL,
  )

  return (
    <form action={action} className="flex flex-col gap-z2">
      <input type="hidden" name="to" value={to} />
      <button
        type="submit"
        disabled={pending}
        className="flex min-h-[52px] w-full items-center justify-center rounded-control bg-accent px-z4 text-base font-medium text-white disabled:opacity-60"
      >
        {pending ? labels.setting : labels.set}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.movedTo && !state.error ? (
        <p role="status" className="text-sm text-ink-2">
          {labels.landed} {state.movedTo}
        </p>
      ) : null}
    </form>
  )
}
