'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { DetailState } from './actions'

// The note box, with no list under it.
//
// ITEM 8: on Amazon loads a note is a timeline entry, not a panel of its own.
// The list moved into `StatusTimeline` — where it interleaves with the status
// events by time — and what is left is the composer, rendered inside that
// section so writing a note and reading what happened are one place.
//
// EXTRACTED RATHER THAN DUPLICATED. `LoadNotes` still exists unchanged for
// broker freight, which keeps the separate panel; both post through the same
// `addNoteAction`, so there is one way a note gets written.
//
// NOT exported from actions.ts — a 'use server' file may only export async
// functions, and it refuses at BUILD time, which `npm run check` never reaches.
const DETAIL_INITIAL: DetailState = { error: null, notice: null }

interface Props {
  add: (previous: DetailState, formData: FormData) => Promise<DetailState>
  labels: {
    label: string
    placeholder: string
    post: string
  }
}

export function NoteComposer({ add, labels }: Props) {
  const [state, action, pending] = useActionState(add, DETAIL_INITIAL)

  return (
    <>
      <form action={action} className="mt-z3 flex items-end gap-z2">
        <div className="flex-1">
          <Input
            name="body"
            label={labels.label}
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
    </>
  )
}
