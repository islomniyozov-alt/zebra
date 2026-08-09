'use client'

import {
  Fragment,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { RateConOffer, type Facility, type Prefill } from './RateConOffer'
import { centsToInput, parseMoneyToCents } from '@/lib/money'
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
  /** `load.financials:update` — Phase 3's RATE_ENTRY. Decided by the page. */
  mayEnterRate: boolean
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
  offerTitle: string
  offerHint: string
  offerChoose: string
  offerHashing: string
  offerUploading: string
  offerReading: string
  offerDone: string
  offerFailed: string
  offerTypeInstead: string
  extracted: string
  extractedUnsure: string
  /** Carries `{printed}`, replaced with what the document actually said. */
  extractedRemembered: string
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
  facilityKnown: string
  facilityNothingYet: string
  facilitySave: string
  facilityGateCode: string
  facilityHours: string
  facilityDock: string
  facilityCheckIn: string
  facilityContact: string
  facilityNotes: string
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
  mayEnterRate,
  labels,
}: Props) {
  const [state, action, pending] = useActionState(createLoadAction, INITIAL)

  /**
   * PROVENANCE, kept and shown (§3 step 2).
   *
   * A field the model filled says so, and one it was unsure about says that
   * too. The difference matters because a dispatcher verifies what they typed
   * and trusts what appeared — so the appearing has to carry its own warning.
   */
  const valueOf = (path: string): string | undefined => {
    const field = fieldAt(prefill, path)
    return field === null ? undefined : String(field.value)
  }

  const hintFor = (path: string, fallback: string | undefined) => {
    // §1.4's only visible effect, and it says so. When the broker name came
    // from a past correction rather than from this document, the hint names the
    // string the document actually printed — so a dispatcher can see the
    // substitution and undo it, rather than discovering it on an invoice.
    if (path === 'brokerName' && prefill?.remembered) {
      return labels.extractedRemembered.replace(
        '{printed}',
        prefill.remembered.printed,
      )
    }
    const field = fieldAt(prefill, path)
    if (!field) return fallback
    return field.confidence === 'low'
      ? labels.extractedUnsure
      : labels.extracted
  }

  /** What the extraction knows about this stop's dock, if anything (§3 step 4). */
  const facilityAt = (index: number) =>
    prefill?.facilities?.find((facility) => facility.index === index) ?? null

  /** "Chicago, IL" from a stop, which is what the place field expects. */
  const stopPlace = (index: number): string | undefined => {
    const city = fieldAt(prefill, `stops[${index}].city`)
    const state_ = fieldAt(prefill, `stops[${index}].state`)
    if (!city) return undefined
    return state_ ? `${city.value}, ${state_.value}` : String(city.value)
  }
  const formRef = useRef<HTMLFormElement>(null)

  const [pickupAt, setPickupAt] = useState('')
  const [deliveryAt, setDeliveryAt] = useState('')
  const [miles, setMiles] = useState('')
  const [rate, setRate] = useState('')

  // PHASE 5 §3 STEP 2. What the extraction gave us, and which fields it was
  // unsure about. `null` means nobody uploaded anything, which is the normal
  // case and must stay the fast one.
  const [prefill, setPrefill] = useState<Prefill | null>(null)

  /**
   * The controlled fields, filled when an extraction lands.
   *
   * The uncontrolled ones use `defaultValue` and a changing `key`; these three
   * hold their own state for reasons that predate this phase — the typed-date
   * blur normalisation and the live economics — so the prefill has to go
   * through their setters or the screen would show one thing and submit
   * another.
   *
   * ONLY WHERE THE FIELD IS EMPTY. A dispatcher who typed a date and then
   * uploaded the confirmation must not watch their own typing disappear.
   */
  const applyPrefill = (next: Prefill) => {
    setPrefill(next)

    const pickupDate = typedDateFrom(next, 'stops[0]')
    const deliveryDate = typedDateFrom(next, 'stops[1]')
    if (pickupDate) setPickupAt((current) => current || pickupDate)
    if (deliveryDate) setDeliveryAt((current) => current || deliveryDate)

    // §1.3 — THE RATE ONLY IF THIS ROLE MAY SEE ONE. The endpoint already
    // stripped the money for a dispatcher, so `extractedRate` is undefined for
    // them and this does nothing; the check is here as well because a form
    // that would have filled the field if the payload had carried it is a form
    // one API change away from filling it.
    if (mayEnterRate) {
      const linehaul = extractedRate(next)
      if (linehaul) setRate((current) => current || linehaul)
    }
  }
  const [authority, setAuthority] = useState(defaultAuthority)

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
      {/* §1: an OFFER above the form, never a gate through it. Everything
       * below works untouched if this is ignored, which is the 6.4-second
       * repeat-load path the brief refuses to slow down. */}
      <RateConOffer
        companyId={authority}
        onExtracted={applyPrefill}
        labels={{
          title: labels.offerTitle,
          hint: labels.offerHint,
          choose: labels.offerChoose,
          hashing: labels.offerHashing,
          uploading: labels.offerUploading,
          reading: labels.offerReading,
          done: labels.offerDone,
          failed: labels.offerFailed,
          typeInstead: labels.offerTypeInstead,
        }}
      />
      {prefill ? (
        <input
          type="hidden"
          name="pendingUploadId"
          value={prefill.pendingUploadId}
        />
      ) : null}

      <Select
        name="companyId"
        label={labels.authority}
        options={authorities}
        defaultValue={defaultAuthority}
        onChange={(event) => setAuthority(event.target.value)}
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
        hint={hintFor('brokerName', labels.createOnMiss)}
        key={`broker-${prefill?.pendingUploadId ?? 'typed'}`}
        defaultValue={valueOf('brokerName')}
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
        hint={hintFor('stops[0].city', labels.placeHint)}
        key={`pickup-${prefill?.pendingUploadId ?? 'typed'}`}
        defaultValue={stopPlace(0)}
        required
      />
      <FacilityNote facility={facilityAt(0)} labels={labels} />
      <Input
        name="delivery"
        label={labels.delivery}
        list="place-options"
        hint={hintFor('stops[1].city', undefined)}
        key={`delivery-${prefill?.pendingUploadId ?? 'typed'}`}
        defaultValue={stopPlace(1)}
        required
      />
      <FacilityNote facility={facilityAt(1)} labels={labels} />
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
            hint={hintFor('stops[0].scheduledAt', labels.dateHint)}
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
            hint={hintFor('stops[1].scheduledAt', undefined)}
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

      {/* §5's box: "a dispatcher's prefill carries no money key AND NO MONEY
       * LABEL". The field is absent rather than disabled — a greyed rate box
       * still tells a dispatcher a rate exists and invites the question of
       * whose it is. The action ignores a posted rate from this role too;
       * neither half is sufficient alone. */}
      {mayEnterRate ? (
        <Input
          name="rate"
          label={labels.rate}
          inputMode="decimal"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          hint={hintFor('money.linehaul', undefined)}
          className="font-mono"
        />
      ) : null}

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

/**
 * One field out of an extraction, by dotted path.
 *
 * Returns null when the model did not carry it OR when the whole extraction is
 * absent — the caller then falls back to an empty input, which is exactly the
 * typing path. A missing field must never become an empty string in a form,
 * because an empty string is a value somebody has to notice is wrong.
 */
function fieldAt(
  prefill: Prefill | null,
  path: string,
): { value: unknown; confidence: string } | null {
  if (!prefill) return null

  const stop = /^stops\[(\d+)\]\.(\w+)$/.exec(path)
  const source = prefill.extracted as unknown as Record<string, unknown>

  // Three shapes, and the third is the one that was missing: `money.linehaul`
  // was looked up as a literal key called "money.linehaul", found nothing, and
  // left the rate field empty on a form that had everything else right. The
  // walkthrough caught it; a type could not, because the payload is `unknown`
  // by the time it gets here.
  const money = /^money\.(\w+)$/.exec(path)

  const raw = stop
    ? ((source['stops'] as Record<string, unknown>[] | undefined)?.[
        Number(stop[1])
      ]?.[stop[2]!] ?? null)
    : money
      ? ((source['money'] as Record<string, unknown> | undefined)?.[
          money[1]!
        ] ?? null)
      : (source[path] ?? null)

  if (!raw || typeof raw !== 'object') return null
  return raw as { value: unknown; confidence: string }
}

/**
 * A stop's date, in the form's own typed-date convention.
 *
 * The model returns `2026-08-14T07:00` — a local ISO value with no zone, which
 * is what the document printed. `normalizeTypedDate` already accepts the date
 * half of that, so the conversion is a slice rather than a parse: no Date
 * object is constructed, and therefore no timezone is applied to a value that
 * never had one. A document saying 14 August must not become the 13th because
 * the browser is west of UTC.
 *
 * The window start is preferred over the appointment when both are present:
 * "06:00 - 10:00" means the driver may arrive at six, and the earlier number is
 * the one a dispatcher plans against.
 */
function typedDateFrom(prefill: Prefill, stopPath: string): string | null {
  const scheduled = fieldAt(prefill, `${stopPath}.scheduledAt`)
  const windowStart = fieldAt(prefill, `${stopPath}.windowStart`)
  const raw = windowStart?.value ?? scheduled?.value
  if (typeof raw !== 'string') return null

  const day = raw.slice(0, 10)
  return normalizeTypedDate(day)
}

/** The linehaul as the rate field expects it: a plain decimal, no symbol. */
function extractedRate(prefill: Prefill): string | null {
  const linehaul = fieldAt(prefill, 'money.linehaul')
  if (!linehaul || typeof linehaul.value !== 'string') return null

  // Parsed and re-rendered through money.ts rather than passed along as the
  // model printed it. "$2,450.00" in a decimal input is a value the form would
  // then have to strip, and rule 9-money says the cents are what is real: this
  // round-trips through the same parser the action will use, so what the user
  // sees is what will be saved or nothing is.
  try {
    return centsToInput(parseMoneyToCents(linehaul.value))
  } catch {
    return null
  }
}

/**
 * What the office knows about this dock, or an offer to start knowing (§3.4).
 *
 * Three states and three different sentences:
 *
 *   a KNOWN dock with notes  — the notes, because that is the whole point: the
 *                              gate code arrives with the address instead of
 *                              being remembered by whoever is on shift;
 *   a KNOWN dock with none   — one line saying it is known, so nobody re-saves
 *                              it and nobody wonders whether the match worked;
 *   a NEW address            — the offer, unticked. §3 says unknown facilities
 *                              are OFFERED for saving, and a box that saved
 *                              every extracted address would fill the list
 *                              with docks nobody chose.
 *
 * A stop with no street address gets nothing at all, which is most of them.
 */
function FacilityNote({
  facility,
  labels,
}: {
  facility: Facility | null
  labels: CreateLoadLabels
}) {
  if (!facility) return null

  if (facility.status === 'new') {
    return (
      <label className="-mt-z2 flex items-start gap-z2 rounded-card border border-dashed border-border-strong p-z2 text-sm text-ink-2">
        {/* The NAME is what identifies it for a person; the checkbox posts
         * only the decision. What gets saved is read from the server's own
         * copy of the extraction — a form that posted the address could post
         * any address. */}
        <input
          type="checkbox"
          name={`saveFacility${facility.index}`}
          value="1"
          className="mt-[2px]"
        />
        <span>
          <span className="font-medium text-ink">{labels.facilitySave}</span>{' '}
          {facility.name ? `${facility.name} — ` : ''}
          {facility.address}
        </span>
      </label>
    )
  }

  const memory = facility.memory
  const lines: [string, string | null][] = [
    [labels.facilityGateCode, memory.gateCode],
    [labels.facilityHours, memory.hours],
    [labels.facilityDock, memory.dockNotes],
    [labels.facilityCheckIn, memory.instructions],
    [labels.facilityContact, contactLine(memory)],
    [labels.facilityNotes, memory.notes],
  ]

  return (
    <div className="-mt-z2 rounded-card bg-surface-2 p-z2 text-sm">
      <p className="font-medium text-ink">
        {labels.facilityKnown} {facility.name}
      </p>
      {facility.hasMemory ? (
        <dl className="mt-z1 grid grid-cols-[auto_1fr] gap-x-z2 gap-y-[2px] text-ink-2">
          {lines
            .filter((line): line is [string, string] => Boolean(line[1]))
            .map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-ink-3">{label}</dt>
                <dd className="text-ink">{value}</dd>
              </Fragment>
            ))}
        </dl>
      ) : (
        // Known and blank is a fact worth printing: it stops a dispatcher
        // wondering whether the match failed, and it is the prompt to write
        // something down after the driver calls from the gate.
        <p className="mt-z1 text-ink-3">{labels.facilityNothingYet}</p>
      )}
    </div>
  )
}

/** "Dana — (503) 555-0134", or whichever half exists. */
function contactLine(memory: {
  contactName: string | null
  contactPhone: string | null
}): string | null {
  const parts = [memory.contactName, memory.contactPhone].filter(Boolean)
  return parts.length ? parts.join(' — ') : null
}
