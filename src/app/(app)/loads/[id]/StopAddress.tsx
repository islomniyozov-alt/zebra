'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cx } from '@/lib/cx'
import { useDirtyGuard } from './useDirtyGuard'

// ---------------------------------------------------------------------------
// THE ADDRESS AS A SENTENCE, WITH AN EDIT BEHIND IT.
//
// An address that resolved from the facility book is already correct — the seed
// carries 4,367 of them and the overwhelming case is that nothing needs doing.
// Showing four input boxes on every stop of an eight-stop trip made the screen
// look like a form somebody had abandoned halfway, and put thirty-two fields in
// front of a dispatcher who wanted to read a lane.
//
// SO: text, and an edit affordance. Editing is the exception it actually is.
//
// A MISSING ADDRESS IS NOT BLANK SPACE. MEM4-DRAY on load 1013 has a facility
// row and no street, and the screen simply showed nothing — dispatch sending a
// driver to a code with no address, with the screen silent about it. Absence
// has to look like absence, and it carries the fix beside it.
//
// UNSAVED STATE CANNOT HIDE. Save commits, Escape and Cancel abandon, and
// `useDirtyGuard` stops the page leaving with something typed and uncommitted.
// The form keeps its Save because four fields are one change — committing a
// half-typed address on the blur of the city box would write a wrong address
// far more often than it would save anybody a click.
// ---------------------------------------------------------------------------

export interface StopAddressValue {
  addressLine1: string
  city: string
  state: string
  postalCode: string
}

interface Props {
  /** The address as it renders today, from the stop or the facility book. */
  shown: string | null
  /** The stop's OWN values, which are what an edit starts from. */
  value: StopAddressValue
  /** What the facility book holds, shown as placeholder text. */
  fallback: StopAddressValue
  /** True when neither the stop nor the book has an address at all. */
  missing: boolean
  mayEdit: boolean
  save: (formData: FormData) => Promise<void>
  labels: {
    street: string
    city: string
    state: string
    zip: string
    edit: string
    save: string
    cancel: string
    saving: string
    missing: string
  }
}

export function StopAddress({
  shown,
  value,
  fallback,
  missing,
  mayEdit,
  save,
  labels,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [pending, startTransition] = useTransition()

  const dirty =
    editing &&
    (Object.keys(draft) as (keyof StopAddressValue)[]).some(
      (key) => draft[key] !== value[key],
    )
  useDirtyGuard(dirty)

  const open = () => {
    setDraft(value)
    setEditing(true)
  }

  if (!editing) {
    return (
      <div className="mt-z1 flex flex-wrap items-center gap-z2">
        {missing ? (
          // THE FLAG. Colour alone would fail §12's contrast rule and anyone
          // reading in a hurry, so it says the words as well.
          <span
            className={cx(
              'inline-flex items-center gap-z1 rounded-control',
              'border border-danger bg-danger-soft px-z2 py-z1',
              'text-sm text-danger',
            )}
          >
            <span aria-hidden>▲</span>
            {labels.missing}
          </span>
        ) : (
          <span className="text-sm text-ink-2">{shown}</span>
        )}

        {mayEdit ? (
          <button
            type="button"
            onClick={open}
            className={cx(
              'rounded-control text-xs text-ink-3 underline underline-offset-2',
              'hover:text-accent focus-visible:outline focus-visible:outline-2',
              'focus-visible:outline-offset-2 focus-visible:outline-accent',
            )}
          >
            {labels.edit}
          </button>
        ) : null}
      </div>
    )
  }

  const field = (key: keyof StopAddressValue, label: string, width: string) => (
    <Input
      name={key}
      label={label}
      value={draft[key]}
      placeholder={fallback[key]}
      onChange={(event) =>
        setDraft((previous) => ({ ...previous, [key]: event.target.value }))
      }
      disabled={pending}
      className={width}
    />
  )

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          await save(formData)
          setEditing(false)
        })
      }
      onKeyDown={(event) => {
        if (event.key === 'Escape') setEditing(false)
      }}
      className="mt-z2 flex flex-wrap items-end gap-z2"
    >
      {field('addressLine1', labels.street, 'w-[220px]')}
      {field('city', labels.city, 'w-[140px]')}
      {field('state', labels.state, 'w-[70px]')}
      {field('postalCode', labels.zip, 'w-[100px] font-mono')}
      <Button
        type="submit"
        variant="secondary"
        size="compact"
        disabled={pending}
      >
        {pending ? labels.saving : labels.save}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="compact"
        disabled={pending}
        onClick={() => setEditing(false)}
      >
        {labels.cancel}
      </Button>
    </form>
  )
}
