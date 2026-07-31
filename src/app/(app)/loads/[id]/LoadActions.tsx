'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import type { DetailState } from './actions'

// NOT exported from actions.ts. A 'use server' file may only export async
// functions — Next refuses the build with "can only export async functions,
// found object", and it refuses at BUILD time, which npm run check never
// reaches. Deploy is what caught it. Standing rule 9 earning its place again.
const DETAIL_INITIAL: DetailState = { error: null, notice: null }

// The one manual status click, and the cancellation (§7).
//
// Cancel is behind a Modal because it looks final. It is not — cancelling
// never deletes anything and never touches the operational status, so a load
// cancelled in transit still says it was in transit. But it looks final to the
// person clicking at 6am, and that is who the confirmation is for.

interface Props {
  isCancelled: boolean
  canDeliver: boolean
  markDelivered: (previous: DetailState) => Promise<DetailState>
  cancel: (previous: DetailState, formData: FormData) => Promise<DetailState>
  uncancel: () => Promise<void>
  labels: {
    markDelivered: string
    cancel: string
    cancelTitle: string
    cancelBody: string
    reason: string
    confirmCancel: string
    uncancel: string
    close: string
  }
}

export function LoadActions({
  isCancelled,
  canDeliver,
  markDelivered,
  cancel,
  uncancel,
  labels,
}: Props) {
  const [open, setOpen] = useState(false)
  const [deliverState, deliverAction, delivering] = useActionState(
    markDelivered,
    DETAIL_INITIAL,
  )
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancel,
    DETAIL_INITIAL,
  )

  if (isCancelled) {
    return (
      <form action={uncancel}>
        <Button type="submit" variant="secondary" size="compact">
          {labels.uncancel}
        </Button>
      </form>
    )
  }

  return (
    <div className="flex items-center gap-z2">
      {canDeliver ? (
        <form action={deliverAction}>
          <Button
            type="submit"
            variant="primary"
            size="compact"
            disabled={delivering}
          >
            {labels.markDelivered}
          </Button>
        </form>
      ) : null}

      {/* Standing rule 11 of the design system: destructive actions are never
       * accent-coloured. */}
      <Button
        type="button"
        variant="danger"
        size="compact"
        onClick={() => setOpen(true)}
      >
        {labels.cancel}
      </Button>

      {/* A declined transition is a NOTICE, not an error. The person clicking
       * did nothing wrong — the load is simply further along than their screen
       * was, which is the race §7's idempotence exists to survive. */}
      {deliverState.notice ? (
        <p role="status" className="text-sm text-warning">
          {deliverState.notice}
        </p>
      ) : null}

      <Modal
        open={open}
        title={labels.cancelTitle}
        onClose={() => setOpen(false)}
      >
        <form
          action={cancelAction}
          onSubmit={() => setOpen(false)}
          className="flex flex-col gap-z4"
        >
          <p className="text-sm text-ink-2">{labels.cancelBody}</p>
          <Input name="reason" label={labels.reason} required autoFocus />
          {cancelState.error ? (
            <p role="alert" className="text-base text-danger">
              {cancelState.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-z2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {labels.close}
            </Button>
            <Button type="submit" variant="danger" disabled={cancelling}>
              {labels.confirmCancel}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

interface NotesProps {
  notes: ReadonlyArray<{
    id: string
    body: string
    at: string
    by: string | null
  }>
  add: (previous: DetailState, formData: FormData) => Promise<DetailState>
  labels: { title: string; placeholder: string; post: string; empty: string }
}

/** The communication log (§10). Writes `Communication` rows, not free text. */
export function LoadNotes({ notes, add, labels }: NotesProps) {
  const [state, action, pending] = useActionState(add, DETAIL_INITIAL)

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>

      <form action={action} className="mt-z3 flex items-end gap-z2">
        <div className="flex-1">
          <Input
            name="body"
            label={labels.title}
            placeholder={labels.placeholder}
            required
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {labels.post}
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="mt-z2 text-base text-danger">
          {state.error}
        </p>
      ) : null}

      {notes.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-3">{labels.empty}</p>
      ) : (
        <ul className="mt-z3 flex flex-col gap-z2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="border-b border-border pb-z2 last:border-b-0"
            >
              <p className="text-base text-ink">{note.body}</p>
              <p className="mt-z1 text-xs text-ink-3">
                <span className="font-mono">{note.at}</span>
                {note.by ? ` · ${note.by}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
