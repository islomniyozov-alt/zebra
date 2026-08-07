'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { recordInspectionAction } from './inspection-actions'
import { INSPECTION_INITIAL, type InspectionState } from './inspection-state'

// PHASE 4 §5 STEP 4 — recording the event.
//
// THE EVENT FIRST, VIOLATIONS AFTERWARDS. A repeating sub-form would let
// somebody type six violations and lose all six to one bad date, and it is the
// same shape the compliance panel already refuses: the record exists, then
// things attach to it. The action redirects straight to the inspection so the
// violations go on without anybody hunting for the row they just made.
//
// All three subject fields are optional here and at least one is required by
// the service — a Level III has no truck on it and a Level V has no driver, so
// making any particular one mandatory would make a real inspection unrecordable.

interface Props {
  levels: readonly SelectOption[]
  trucks: readonly SelectOption[]
  trailers: readonly SelectOption[]
  drivers: readonly SelectOption[]
  today: string
  translate: Record<string, string>
  labels: {
    hint: string
    date: string
    dateHint: string
    level: string
    state: string
    stateHint: string
    report: string
    location: string
    inspector: string
    truck: string
    trailer: string
    driver: string
    subjectHint: string
    notes: string
    save: string
    cancel: string
  }
}

export function InspectionForm({
  levels,
  trucks,
  trailers,
  drivers,
  today,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<InspectionState, FormData>(
    recordInspectionAction,
    INSPECTION_INITIAL,
  )

  return (
    <form action={act} className="flex max-w-[900px] flex-col gap-z4">
      <p className="max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
        <Input
          name="inspectedAt"
          label={labels.date}
          hint={labels.dateHint}
          required
          defaultValue={today}
          inputMode="numeric"
        />
        <Select name="level" label={labels.level} required options={levels} />
        <Input
          name="state"
          label={labels.state}
          hint={labels.stateHint}
          required
          maxLength={2}
          className="uppercase"
        />
        <Input name="reportNumber" label={labels.report} />
        <Input name="location" label={labels.location} />
        <Input name="inspectorName" label={labels.inspector} />
      </div>

      <fieldset className="flex flex-col gap-z2 rounded-card border border-border p-z3">
        <legend className="px-z1 text-sm font-medium text-ink-2">
          {labels.subjectHint}
        </legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
          <Select name="truckId" label={labels.truck} options={trucks} />
          <Select name="trailerId" label={labels.trailer} options={trailers} />
          <Select name="driverId" label={labels.driver} options={drivers} />
        </div>
      </fieldset>

      <Input name="notes" label={labels.notes} />

      <div className="flex items-center gap-z3">
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </Button>
        <Link
          href="/safety/inspections"
          className="text-sm text-ink-2 hover:text-accent"
        >
          {labels.cancel}
        </Link>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {translate[state.error] ?? state.error}
          </p>
        ) : null}
      </div>
    </form>
  )
}
