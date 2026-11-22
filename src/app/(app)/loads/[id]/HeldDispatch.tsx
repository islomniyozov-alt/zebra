'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import type { DetailState } from './actions'

// DISPATCH HELD (TMS §7.14 item 3). A broker load with truck and driver and
// no rate con stays Booked; this card says so and offers the one release that
// is not the rate con landing — a reason in words, which becomes the timeline
// note. The rule is `dispatchWithReason`; this only carries the words.

export function HeldDispatch({
  action,
  mayDispatch,
  labels,
}: {
  action: (previous: DetailState, formData: FormData) => Promise<DetailState>
  mayDispatch: boolean
  labels: {
    title: string
    body: string
    reasonLabel: string
    submit: string
  }
}) {
  const [state, act, pending] = useActionState<DetailState, FormData>(action, {
    error: null,
    notice: null,
  })
  return (
    <section
      role="status"
      data-held-dispatch
      className="flex flex-col gap-z2 rounded-card border border-danger bg-danger-soft p-z3"
    >
      <p className="text-sm font-medium text-danger">{labels.title}</p>
      <p className="text-sm text-ink">{labels.body}</p>
      {mayDispatch ? (
        <form action={act} className="flex flex-col gap-z2">
          <label className="flex flex-col gap-z1 text-sm text-ink">
            {labels.reasonLabel}
            <textarea
              name="reason"
              required
              rows={2}
              className="rounded-control border border-border bg-surface px-z2 py-z1 text-base text-ink"
            />
          </label>
          <div>
            <Button type="submit" variant="danger" disabled={pending}>
              {labels.submit}
            </Button>
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  )
}
