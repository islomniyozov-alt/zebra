'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Select, type SelectOption } from '@/components/ui/Select'
import type { DetailState } from './actions'

// Truck and driver, on a load that already exists.
//
// THE SCREEN HAD NO WAY TO DO THIS. Assignment lived only on the create form,
// so freight booked by the Relay trips import — which nobody types — arrived
// with no driver and no way to give it one. It could not be dispatched, and it
// could not be paid: a settlement period selects loads by `driverId`.
//
// ONE FORM, BOTH FIELDS, ONE SAVE. Not two independent selects that write on
// change: a dispatcher moving a load from one driver to another usually moves
// the truck with it, and two writes means two conflict checks, the first of
// which can refuse a pairing the second would have made legal.
//
// NOT exported from actions.ts — a 'use server' file may only export async
// functions, and it refuses at BUILD time, which `npm run check` never reaches.
const DETAIL_INITIAL: DetailState = { error: null, notice: null }

interface Props {
  trucks: readonly SelectOption[]
  drivers: readonly SelectOption[]
  truckId: string | null
  driverId: string | null
  disabled: boolean
  assign: (previous: DetailState, formData: FormData) => Promise<DetailState>
  labels: {
    title: string
    truck: string
    driver: string
    unassigned: string
    save: string
    saving: string
  }
}

export function LoadAssignment({
  trucks,
  drivers,
  truckId,
  driverId,
  disabled,
  assign,
  labels,
}: Props) {
  const [state, action, pending] = useActionState(assign, DETAIL_INITIAL)

  // BLANK IS A REAL CHOICE, not a prompt to pick something. Selecting it takes
  // the driver off the load, which is why the option carries a word rather
  // than an empty string with a dash in it.
  const withBlank = (options: readonly SelectOption[]): SelectOption[] => [
    { value: '', label: labels.unassigned },
    ...options,
  ]

  return (
    <section className="flex flex-col gap-z3 rounded-card border border-border bg-surface p-z4">
      <h2 className="text-sm font-semibold text-ink">{labels.title}</h2>

      <form action={action} className="flex flex-col gap-z3">
        <div className="grid gap-z3 sm:grid-cols-2">
          <Select
            name="truckId"
            label={labels.truck}
            options={withBlank(trucks)}
            defaultValue={truckId ?? ''}
            disabled={disabled || pending}
          />
          <Select
            name="driverId"
            label={labels.driver}
            options={withBlank(drivers)}
            defaultValue={driverId ?? ''}
            disabled={disabled || pending}
          />
        </div>

        {/* EVERY refusal at once, as one sentence — `assignLoadAction` joins
         * them. A dispatcher fixing one double-booking to be told about the
         * next is the interaction this shape exists to prevent. */}
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}

        <div>
          <Button type="submit" disabled={disabled || pending}>
            {pending ? labels.saving : labels.save}
          </Button>
        </div>
      </form>
    </section>
  )
}
