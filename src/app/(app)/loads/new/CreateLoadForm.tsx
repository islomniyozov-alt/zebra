'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { uploadDocument, type UploadPhase } from '@/lib/upload-client'
import { normalizeTypedDate } from '@/lib/typed-date'
import { createLoadAction, type CreateLoadState } from './actions'

// ---------------------------------------------------------------------------
// ADD LOAD — the hot path (design system §7.6, brief §9).
//
// Single column, keyboard-first, tab order exactly the workflow:
//
//   authority → broker → truck → driver → pickup → delivery → dates
//     → miles → rate → rate confirmation → save
//
// TYPEAHEAD IS A NATIVE <datalist>, and that is a considered choice rather
// than a shortcut. It gives filter-as-you-type, arrow-key selection and
// create-on-miss for nothing — a value that matches nothing in the list is
// just text, and the server creates the broker or the location from it. A
// hand-rolled combobox would be several hundred lines of ARIA to arrive at
// the same keyboard behaviour, with more ways to be slower than the typist.
//
// CREATE-ON-MISS IS THE WHOLE FORTY SECONDS. A dispatcher who has to open
// Brokers in another tab to add "Meridian Freight" before booking has already
// lost, and goes back to the old TMS.
//
// THE UPLOAD NEVER BLOCKS THE SAVE (§9). It runs against the load AFTER the
// load exists, because a presigned URL is minted against a target entity and
// there is no load to target until save returns. So: save, then attach. The
// form says so rather than pretending the file went first.
// ---------------------------------------------------------------------------

export interface Option {
  value: string
  label: string
}

interface Props {
  authorities: readonly Option[]
  defaultAuthority: string
  brokers: readonly string[]
  trucks: readonly Option[]
  drivers: readonly Option[]
  places: readonly string[]
  /** Absent entirely for a role without `load.financials` (§7). */
  economics: {
    fuelCostPerMileCents: number
    driverPayPercentBps: number
  } | null
  labels: CreateLoadLabels
}

/**
 * Named rather than `Record<string, string>`.
 *
 * With `noUncheckedIndexedAccess` a record index is `string | undefined`, so
 * every label would need a `?? ''` — and a missing label would render as
 * nothing instead of failing the build. Spelling them out means a forgotten
 * translation is a type error at the call site, which is the same bargain the
 * `Dictionary` type makes in src/lib/i18n.ts.
 */
export interface CreateLoadLabels {
  authority: string
  broker: string
  truck: string
  driver: string
  unassigned: string
  pickup: string
  delivery: string
  pickupDate: string
  datePlaceholder: string
  dateHint: string
  deliveryDate: string
  miles: string
  rate: string
  rpm: string
  driverPay: string
  fuel: string
  profit: string
  rateCon: string
  rateConHint: string
  preparing: string
  uploading: string
  uploaded: string
  uploadFailed: string
  createOnMiss: string
  placeHint: string
  save: string
  cancel: string
}

const INITIAL: CreateLoadState = { error: null, field: null, loadId: null }

const money = (cents: number) =>
  (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export function CreateLoadForm({
  authorities,
  defaultAuthority,
  brokers,
  trucks,
  drivers,
  places,
  economics,
  labels,
}: Props) {
  const [state, action, pending] = useActionState(createLoadAction, INITIAL)
  const formRef = useRef<HTMLFormElement>(null)

  const [pickupAt, setPickupAt] = useState('')
  const [deliveryAt, setDeliveryAt] = useState('')
  const [miles, setMiles] = useState('')
  const [rate, setRate] = useState('')

  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)

  // ⌘/Ctrl + Enter saves from anywhere in the form (§7.6). Bound on the form
  // rather than the window so it cannot fire from somewhere else on the page.
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        form.requestSubmit()
      }
    }
    form.addEventListener('keydown', onKeyDown)
    return () => form.removeEventListener('keydown', onKeyDown)
  }, [])

  // The load exists; attach the rate confirmation to it now. Deliberately
  // AFTER the save — a mint is authorised against a target entity, and until
  // the load is saved there is no entity to authorise against.
  // Every setState below happens in a CALLBACK — `onProgress` and `.catch` —
  // never synchronously in the effect body. The effect's job is to start an
  // external process and subscribe to it, which is what effects are actually
  // for; a synchronous setState here would be a cascading render and React's
  // lint rule says so.
  useEffect(() => {
    const loadId = state.loadId
    if (!loadId || !file) return
    let cancelled = false

    uploadDocument(
      file,
      { entity: 'load', entityId: loadId, documentType: 'RATE_CONFIRMATION' },
      (progress) => {
        if (cancelled) return
        setPhase(progress.phase)
        setUploadError(null)
      },
    ).catch((error: unknown) => {
      if (cancelled) return
      setPhase('failed')
      setUploadError(error instanceof Error ? error.message : String(error))
    })

    return () => {
      cancelled = true
    }
  }, [state.loadId, file])

  const computed = useMemo(() => {
    if (!economics) return null
    const milesValue = Number(miles.replace(/[,\s]/g, ''))
    const rateCents = Math.round(Number(rate.replace(/[,$\s]/g, '')) * 100)
    if (!Number.isFinite(rateCents) || rateCents <= 0) return null

    const driverPayCents = Math.round(
      (rateCents * economics.driverPayPercentBps) / 10_000,
    )
    const hasMiles = Number.isFinite(milesValue) && milesValue > 0
    const fuelCents = hasMiles
      ? Math.round(milesValue * economics.fuelCostPerMileCents)
      : 0

    return {
      rpm: hasMiles ? rateCents / 100 / milesValue : null,
      driverPayCents,
      fuelCents,
      profitCents: rateCents - driverPayCents - fuelCents,
    }
  }, [economics, miles, rate])

  return (
    <form
      ref={formRef}
      action={action}
      className="flex max-w-[560px] flex-col gap-z4"
    >
      {/* 1. Authority — the FIRST field, defaulting to last-used (§6.3). An
       * authority chosen elsewhere and carried invisibly is the worst outcome
       * this interface can produce. */}
      <Select
        name="companyId"
        label={labels.authority}
        options={authorities}
        defaultValue={defaultAuthority}
        required
        autoFocus
        error={
          state.field === 'companyId' ? (state.error ?? undefined) : undefined
        }
      />

      <Input
        name="broker"
        label={labels.broker}
        list="broker-options"
        hint={labels.createOnMiss}
        required
        error={
          state.field === 'customerId' ? (state.error ?? undefined) : undefined
        }
      />
      <datalist id="broker-options">
        {brokers.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <Select
        name="truckId"
        label={labels.truck}
        options={[{ value: '', label: labels.unassigned }, ...trucks]}
        error={
          state.field === 'truckId' ? (state.error ?? undefined) : undefined
        }
      />
      <Select
        name="driverId"
        label={labels.driver}
        options={[{ value: '', label: labels.unassigned }, ...drivers]}
        error={
          state.field === 'driverId' ? (state.error ?? undefined) : undefined
        }
      />

      <Input
        name="pickup"
        label={labels.pickup}
        list="place-options"
        hint={labels.placeHint}
        required
      />
      <Input
        name="delivery"
        label={labels.delivery}
        list="place-options"
        required
      />
      <datalist id="place-options">
        {places.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {/* TEXT, not type="date", and the forty-second measurement is why. A
       * native date input holds three internal segments and Tab moves between
       * them, so two dates cost six tab stops instead of two — §9 lists
       * "dates" as one step. The first timed run put every keystroke after the
       * pickup date into the wrong field and saved a delivery date in the
       * year 1. `normalizeTypedDate` accepts 810, 8/10, 08/10/26 and
       * 2026-08-10 alike. */}
      <div className="flex gap-z3">
        <div className="flex-1">
          <Input
            name="pickupAt"
            label={labels.pickupDate}
            inputMode="numeric"
            placeholder={labels.datePlaceholder}
            hint={labels.dateHint}
            value={pickupAt}
            onChange={(event) => setPickupAt(event.target.value)}
            onBlur={(event) =>
              setPickupAt(
                normalizeTypedDate(event.target.value) ?? event.target.value,
              )
            }
            required
            className="font-mono"
          />
        </div>
        <div className="flex-1">
          <Input
            name="deliveryAt"
            label={labels.deliveryDate}
            inputMode="numeric"
            placeholder={labels.datePlaceholder}
            value={deliveryAt}
            onChange={(event) => setDeliveryAt(event.target.value)}
            onBlur={(event) =>
              setDeliveryAt(
                normalizeTypedDate(event.target.value) ?? event.target.value,
              )
            }
            required
            className="font-mono"
          />
        </div>
      </div>

      <Input
        name="miles"
        label={labels.miles}
        inputMode="numeric"
        value={miles}
        onChange={(event) => setMiles(event.target.value)}
        error={
          state.field === 'dispatchedMiles'
            ? (state.error ?? undefined)
            : undefined
        }
      />

      <Input
        name="rate"
        label={labels.rate}
        inputMode="decimal"
        value={rate}
        onChange={(event) => setRate(event.target.value)}
        className="font-mono"
      />

      {/* §7.6 — the computed line sits UNDER the rate field, never in a panel
       * the dispatcher has to go looking for. Absent entirely, not hidden,
       * for a role without `load.financials` (§7). */}
      {computed ? (
        <dl className="-mt-z2 flex flex-wrap gap-x-z4 gap-y-z1 font-mono text-sm text-ink-2">
          <div className="flex gap-z1">
            <dt>{labels.rpm}</dt>
            <dd className="text-ink">
              {computed.rpm === null ? '—' : computed.rpm.toFixed(2)}
            </dd>
          </div>
          <div className="flex gap-z1">
            <dt>{labels.driverPay}</dt>
            <dd className="text-ink">{money(computed.driverPayCents)}</dd>
          </div>
          <div className="flex gap-z1">
            <dt>{labels.fuel}</dt>
            <dd className="text-ink">{money(computed.fuelCents)}</dd>
          </div>
          <div className="flex gap-z1">
            <dt>{labels.profit}</dt>
            <dd
              className={computed.profitCents < 0 ? 'text-danger' : 'text-ink'}
            >
              {money(computed.profitCents)}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="flex flex-col gap-z1">
        <label htmlFor="rateCon" className="text-sm font-medium text-ink-2">
          {labels.rateCon}
        </label>
        <input
          id="rateCon"
          name="rateCon"
          type="file"
          accept="application/pdf,image/*"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="text-sm text-ink-2 file:me-z2 file:rounded-control file:border file:border-border-strong file:bg-surface-2 file:px-z2 file:py-[6px] file:text-base file:text-ink"
        />
        {/* Two visibly distinct states. "Preparing" is local CPU — compress and
         * hash — and "Uploading" is the network. Merging them means a driver on
         * bad signal cannot tell a slow phone from a stalled upload, and the two
         * call for different responses. */}
        <p className="text-sm text-ink-3" role="status">
          {phase === 'preparing'
            ? labels.preparing
            : phase === 'uploading'
              ? labels.uploading
              : phase === 'done'
                ? labels.uploaded
                : phase === 'failed'
                  ? (uploadError ?? labels.uploadFailed)
                  : labels.rateConHint}
        </p>
      </div>

      {state.error && !state.field ? (
        <p role="alert" className="text-base text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-z2">
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </Button>
        <Link
          href="/loads"
          className="inline-flex h-control items-center rounded-control px-z3 text-base font-medium text-ink-2 hover:bg-surface-3"
        >
          {labels.cancel}
        </Link>
        <kbd className="ms-auto font-mono text-xs text-ink-3">⌘⏎</kbd>
      </div>
    </form>
  )
}
