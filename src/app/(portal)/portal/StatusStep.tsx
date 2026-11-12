'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { isNetworkFailure, newQueueId, QUEUE_EVENT } from '@/lib/offline-queue'
import { enqueue, queued } from '@/lib/offline-queue-store'
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
//
// OFFLINE, THE TAP IS KEPT (step 6; §9). The tap carries its own time; if
// the phone says it is offline, or the action dies before the office
// answers, the tap goes to the phone's queue with that time and the shell
// replays it — and this button gives way to a sentence naming the kept rung,
// so a second tap cannot queue a second step. A refusal the office answered
// is shown here in words and never kept.

interface Props {
  loadId: string
  /** The enum value the tap asks for, and its word in the reader's language. */
  to: string
  labels: {
    set: string
    setting: string
    landed: string
    /** The rung's word alone, for the queue's strip. */
    word: string
    /** "Kept on this phone: {status}. …" */
    queued: string
    failed: string
  }
}

export function StatusStep({ loadId, to, labels }: Props) {
  const router = useRouter()
  const [state, setState] = useState<StatusStepState>(STATUS_STEP_INITIAL)
  const [kept, setKept] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    const read = async () => {
      const waiting = (await queued()).find(
        (entry) =>
          entry.kind === 'status' &&
          entry.loadId === loadId &&
          entry.failure === null,
      )
      setKept(waiting ? waiting.label : null)
    }
    const changed = () => void read()
    void read()
    window.addEventListener(QUEUE_EVENT, changed)
    return () => window.removeEventListener(QUEUE_EVENT, changed)
  }, [loadId])

  const keep = async (tappedAt: string) => {
    await enqueue({
      kind: 'status',
      id: newQueueId(),
      loadId,
      to,
      label: labels.word,
      tappedAt,
      queuedAt: new Date().toISOString(),
      failure: null,
    })
    setState(STATUS_STEP_INITIAL)
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    startTransition(async () => {
      const tappedAt = new Date().toISOString()
      if (!navigator.onLine) {
        await keep(tappedAt)
        return
      }
      const form = new FormData()
      form.set('to', to)
      form.set('tappedAt', tappedAt)
      try {
        const result = await advanceStatusAction(
          loadId,
          STATUS_STEP_INITIAL,
          form,
        )
        setState(result)
        if (!result.error) router.refresh()
      } catch (error) {
        if (isNetworkFailure(error)) {
          await keep(tappedAt)
          return
        }
        setState({ error: labels.failed, movedTo: null })
      }
    })
  }

  if (kept) {
    return (
      <p
        role="status"
        className="rounded-card border border-border bg-warning-soft p-z3 text-sm text-ink"
      >
        {labels.queued.replace('{status}', kept)}
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-z2">
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
