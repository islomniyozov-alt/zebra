'use client'

import { useRef, useState, useTransition } from 'react'
import { cx } from '@/lib/cx'
import type { DetailState } from './actions'
import { useDirtyGuard } from './useDirtyGuard'

// DISPATCHED MILES, SHOWN AS A VALUE AND EDITED ON DEMAND.
//
// NO SAVE BUTTON, which is the point. Load 1013 carried five of them and a
// screen full of Save buttons makes a dispatcher wonder what is committed. The
// saved value is what you see; clicking it opens an input; blur or Enter
// commits; Escape abandons the edit and puts the saved value back.
//
// AND IT IS A DRIVER-PAY INPUT, which is why the states are visible rather than
// implied. `driver-pay.ts` computes `miles = actualMiles ?? dispatchedMiles`
// and multiplies by the per-mile rate, so on a per-mile driver with no actual
// miles this field IS the pay basis. Settlement lines snapshot the basis they
// paid on, so a later edit cannot rewrite what a driver was already paid — but
// a number fumbled in here becomes the next settlement's arithmetic, so a
// commit that failed must never look like one that worked.
//
// ESCAPE DISCARDS, DELIBERATELY AND ONLY THERE. Every other exit commits, and
// `useDirtyGuard` catches the one path that is neither — the page going away
// while an edit is pending.
const DIGITS = /^\d{0,6}$/

interface Props {
  dispatchedMiles: number | null
  save: (previous: DetailState, formData: FormData) => Promise<DetailState>
  locale: string
  labels: {
    miles: string
    edit: string
    saving: string
    failed: string
  }
}

export function MilesField({ dispatchedMiles, save, locale, labels }: Props) {
  const saved = dispatchedMiles === null ? '' : String(dispatchedMiles)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(saved)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Escape must not let the blur handler commit on the way out.
  const abandoned = useRef(false)

  const dirty = editing && value !== saved
  useDirtyGuard(dirty)

  const commit = () => {
    setEditing(false)
    if (value === saved) return

    const data = new FormData()
    data.set('miles', value)
    startTransition(async () => {
      const result = await save({ error: null, notice: null }, data)
      // A REFUSAL IS SHOWN AND THE TYPED VALUE IS KEPT. Snapping back to the
      // old number would discard the edit and look like a successful save of
      // something else.
      setError(result.error)
      if (result.error) setEditing(true)
    })
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-z2">
        <button
          type="button"
          onClick={() => {
            setValue(saved)
            setError(null)
            setEditing(true)
          }}
          title={labels.edit}
          aria-label={`${labels.edit}: ${labels.miles}`}
          className={cx(
            'rounded-control font-mono tabular-nums hover:text-accent',
            'focus-visible:outline focus-visible:outline-2',
            'focus-visible:outline-offset-2 focus-visible:outline-accent',
            error && 'text-danger',
          )}
        >
          {dispatchedMiles === null
            ? '—'
            : dispatchedMiles.toLocaleString(locale)}
        </button>
        {pending ? (
          <span className="text-xs text-ink-3">{labels.saving}</span>
        ) : null}
        {error ? (
          <span role="alert" className="text-xs text-danger">
            {labels.failed}
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <input
      autoFocus
      name="miles"
      inputMode="numeric"
      aria-label={labels.miles}
      value={value}
      onChange={(event) => {
        const next = event.target.value
        // Digits only, and bounded — `wholeNumber` refuses the rest server-side
        // and this keeps the field from ever holding something that cannot land.
        if (DIGITS.test(next)) setValue(next)
      }}
      onBlur={() => {
        if (abandoned.current) {
          abandoned.current = false
          return
        }
        commit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        if (event.key === 'Escape') {
          abandoned.current = true
          setValue(saved)
          setEditing(false)
        }
      }}
      className={cx(
        'w-[90px] rounded-control border border-accent bg-surface px-z1',
        'text-end font-mono tabular-nums text-ink',
        'focus-visible:outline focus-visible:outline-2',
        'focus-visible:outline-offset-1 focus-visible:outline-accent',
      )}
    />
  )
}
