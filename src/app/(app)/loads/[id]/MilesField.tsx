'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { DetailState } from './actions'

// DISPATCHED MILES, IN THE SUMMARY WHERE THEY ALREADY RENDER.
//
// THE RULING (2026-09-03), and it corrects a placement of mine. Miles went
// into the rate panel first because that is where the request put them — and
// that panel is behind `load.financials`, so the field was invisible to a
// dispatcher, who is exactly the person the request was for. Intent was
// "dispatch can edit miles", not "miles beside money".
//
// GATED ON `load:update`. Permission follows the FIELD: a trip is 583 miles
// long whether or not the reader may see what it paid.
//
// A BLANK CLEARS, because "we do not know yet" is a real state for a load
// booked from an email that printed no distance, and zero is a different
// claim from unknown.
//
// NOT exported from actions.ts — a 'use server' file may only export async
// functions, and it refuses at BUILD time, which `npm run check` never reaches.
const DETAIL_INITIAL: DetailState = { error: null, notice: null }

interface Props {
  dispatchedMiles: number | null
  save: (previous: DetailState, formData: FormData) => Promise<DetailState>
  labels: { miles: string; save: string }
}

export function MilesField({ dispatchedMiles, save, labels }: Props) {
  const [state, action, pending] = useActionState(save, DETAIL_INITIAL)

  return (
    <form action={action} className="flex flex-col items-end gap-z1">
      <div className="flex items-center gap-z2">
        <Input
          name="miles"
          label={labels.miles}
          labelHidden
          defaultValue={dispatchedMiles === null ? '' : String(dispatchedMiles)}
          disabled={pending}
          inputMode="numeric"
          className="w-[90px] text-end font-mono"
        />
        <Button type="submit" variant="ghost" size="compact" disabled={pending}>
          {labels.save}
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
