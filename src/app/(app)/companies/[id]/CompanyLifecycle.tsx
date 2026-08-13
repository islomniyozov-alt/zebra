'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

// Deactivate, reactivate and remove — the three things flag 11's minimal scope
// skipped, under the edit form rather than beside Save.
//
// DEACTIVATE IS THE ORDINARY ACT AND REMOVE IS THE EXCEPTION, and the layout
// says so: deactivate is a plain secondary button, remove is danger-coloured
// and behind a confirm, and remove is ABSENT ENTIRELY once anything is filed
// under the authority. A disabled button invites somebody to go looking for
// the way around it; a button that is not there, next to a sentence saying
// what is filed under this carrier, does not.

interface Props {
  isActive: boolean
  usageSentence: string
  deactivate: () => Promise<void>
  reactivate: () => Promise<void>
  /**
   * ABSENT ENTIRELY when anything is filed under this authority — not present
   * and disabled, and not present with a guard inside.
   *
   * The words go with it, which is the point. Passing the labels anyway and
   * hiding the button renders nothing but still SERIALISES "Remove
   * permanently" into the payload of a page where removing is impossible; the
   * walkthrough's grep found exactly that and was right to. Same rule the
   * money fields follow: what the situation does not allow is not sent.
   */
  remove?: {
    action: () => Promise<void>
    labels: { remove: string; confirm: string; body: string; cancel: string }
  }
  labels: {
    deactivate: string
    deactivateHint: string
    reactivate: string
    reactivateHint: string
  }
}

export function CompanyLifecycle({
  isActive,
  usageSentence,
  deactivate,
  reactivate,
  remove,
  labels,
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <section className="mt-z6 flex flex-col gap-z3 border-t border-border pt-z4">
      {isActive ? (
        <div className="flex flex-col gap-z1">
          {/* Its own form: a nested <form> is invalid, and these actions must
           * not carry the edit form's fields. */}
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void deactivate()}
            >
              {labels.deactivate}
            </Button>
          </div>
          <p className="text-xs text-ink-3">{labels.deactivateHint}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-z1">
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void reactivate()}
            >
              {labels.reactivate}
            </Button>
          </div>
          <p className="text-xs text-ink-3">{labels.reactivateHint}</p>
        </div>
      )}

      {/* WHAT IS FILED UNDER IT, ALWAYS — not only when it blocks something.
       * "3 loads, 1 invoice" is the reason the remove button is missing, and
       * a reason shown only at the moment of refusal is a reason nobody
       * planned around. */}
      <p className="text-xs text-ink-3">{usageSentence}</p>

      {remove ? (
        <>
          <div>
            {/* Standing rule 11: destructive actions are never accent-coloured. */}
            <Button
              type="button"
              variant="danger"
              onClick={() => setOpen(true)}
            >
              {remove.labels.remove}
            </Button>
          </div>

          <Modal
            open={open}
            onClose={() => setOpen(false)}
            title={remove.labels.confirm}
          >
            <p className="text-sm text-ink-2">{remove.labels.body}</p>
            <div className="mt-z4 flex items-center gap-z2">
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setOpen(false)
                  void remove.action()
                }}
              >
                {remove.labels.remove}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
              >
                {remove.labels.cancel}
              </Button>
            </div>
          </Modal>
        </>
      ) : null}
    </section>
  )
}
