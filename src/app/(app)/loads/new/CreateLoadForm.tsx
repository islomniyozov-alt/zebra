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
import { normalizeTypedDate, normalizeTypedTime } from '@/lib/typed-date'
import { createLoadAction, type CreateLoadState } from './actions'
import { fieldAt, stopRowsFrom, type StopRowValues } from './prefill'
import { cx } from '@/lib/cx'

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
  /** Most-recently-booked first, deduped. A memory, not a lookup. */
  recentCustomers: readonly string[]
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
  methodManual: string
  methodUpload: string
  methodPaste: string
  methodAmazon: string
  methodAmazonImport: string
  methodManualHint: string
  methodDropHint: string
  methodPastePlaceholder: string
  methodPasteRead: string
  methodAmazonSoon: string
  extracted: string
  extractedUnsure: string
  /** Carries `{printed}`, replaced with what the document actually said. */
  extractedRemembered: string
  /** Carries `{was}` — the value the document had before somebody changed it. */
  extractedChanged: string
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
  stopPlace: string
  stopType: string
  stopDate: string
  stopPickup: string
  stopDelivery: string
  stopIntermediate: string
  stopAdd: string
  stopRemove: string
  stopMoveUp: string
  stopMoveDown: string
  timePlaceholder: string
  stopTo: string
  stopFrom: string
  bol: string
  po: string
  warnTitle: string
  warnSaveAnyway: string
  save: string
  cancel: string
}

const INITIAL: CreateLoadState = { error: null, field: null, loadId: null }

/** A stop as the FORM holds it. The place lives in the DOM, uncontrolled. */
type StopRow = StopRowValues

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
  recentCustomers,
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
    // A CHANGED field says so first. It outranks the provenance hint because
    // it is the more surprising fact: "from the document" on a value nobody
    // touched is background, and "you changed this" is not.
    const was = changed[path]
    if (was !== undefined) {
      return labels.extractedChanged.replace('{was}', was)
    }
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

  /**
   * THE STOPS, AS A LIST (Phase 6 §4 step 1).
   *
   * `Load -> LoadStop` has been the schema since Phase 1 and the recorded
   * decision was "multi-stop in the data, single-stop in the UI". This is the
   * UI half arriving; the database needed nothing.
   *
   * TWO ROWS BY DEFAULT, in the same order and with the same tab stops as the
   * pair they replace, because §9's forty seconds is measured on the typed
   * path and a third row nobody asked for is a third row everybody tabs
   * through. Adding one is a button.
   *
   * The DATE is state and the place is not: the typed-date convention
   * normalises on blur, and the place field is an uncontrolled `defaultValue`
   * with a changing key, exactly as before. A stop's identity is its `key`,
   * not its index, so reordering does not make React reuse the wrong row's
   * uncontrolled input.
   */
  const [stops, setStops] = useState<StopRow[]>(() => [
    { key: 'stop-0', type: 'PICKUP', date: '', from: '', to: '' },
    { key: 'stop-1', type: 'DELIVERY', date: '', from: '', to: '' },
  ])
  const nextKey = useRef(2)

  const setStop = (index: number, patch: Partial<StopRow>) =>
    setStops((current) =>
      current.map((stop, at) => (at === index ? { ...stop, ...patch } : stop)),
    )

  const addStop = () =>
    setStops((current) => {
      const key = `stop-${nextKey.current++}`
      // Inserted BEFORE the last row, not appended: the last stop is the
      // delivery on almost every load, and a dispatcher adding a stop is
      // adding one on the way rather than after the end. They can change its
      // type; they should not have to reorder to get the common case.
      return [
        ...current.slice(0, -1),
        { key, type: 'DELIVERY' as const, date: '', from: '', to: '' },
        ...current.slice(-1),
      ]
    })

  const removeStop = (index: number) =>
    setStops((current) =>
      current.length <= 2 ? current : current.filter((_, at) => at !== index),
    )

  const moveStop = (index: number, by: -1 | 1) =>
    setStops((current) => {
      const to = index + by
      if (to < 0 || to >= current.length) return current
      const next = [...current]
      const [row] = next.splice(index, 1)
      next.splice(to, 0, row!)
      return next
    })

  const [miles, setMiles] = useState('')
  const [rate, setRate] = useState('')

  // PHASE 5 §3 STEP 2. What the extraction gave us, and which fields it was
  // unsure about. `null` means nobody uploaded anything, which is the normal
  // case and must stay the fast one.
  const [prefill, setPrefill] = useState<Prefill | null>(null)

  /**
   * MANUALLY-MODIFIED INDICATORS (Phase 6 §4 step 1).
   *
   * Which prefilled fields the dispatcher has since typed over, and what the
   * document had said. The provenance hint from Phase 5 answers "where did
   * this come from"; this answers the question after it — "and did somebody
   * change it" — which is the one an argument three weeks later turns on.
   *
   * Keyed by the same dotted path the correction log uses, so the screen and
   * the audit row are talking about the same field.
   *
   * TRACKED ONLY WHEN THERE IS A PREFILL. The typed path has nothing to
   * diverge from, so it attaches no handler and pays nothing — §9's forty
   * seconds is measured on exactly that path.
   */
  const [changed, setChanged] = useState<Record<string, string>>({})

  const noteChange = (path: string, value: string) => {
    const was = fieldAt(prefill, path)
    const original = was === null ? null : String(was.value)
    setChanged((current) => {
      const isBack = original !== null && value.trim() === original.trim()
      if (isBack) {
        if (!(path in current)) return current
        const { [path]: _dropped, ...rest } = current
        return rest
      }
      if (original === null || current[path] === original) return current
      return { ...current, [path]: original }
    })
  }

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

    // AS MANY STOPS AS THE DOCUMENT HAD, and their types as it READ them.
    setStops((current) => {
      const rows = stopRowsFrom(
        next,
        current,
        () => `stop-${nextKey.current++}`,
      )
      return rows ?? current
    })

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
          methodManual: labels.methodManual,
          methodUpload: labels.methodUpload,
          methodPaste: labels.methodPaste,
          methodAmazon: labels.methodAmazon,
          methodAmazonImport: labels.methodAmazonImport,
          methodManualHint: labels.methodManualHint,
          methodDropHint: labels.methodDropHint,
          methodPastePlaceholder: labels.methodPastePlaceholder,
          methodPasteRead: labels.methodPasteRead,
          methodAmazonSoon: labels.methodAmazonSoon,
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
        {...(prefill
          ? {
              onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                noteChange('brokerName', event.target.value),
            }
          : {})}
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

      {/* RECENT CUSTOMERS (Phase 6 §4 step 2). One click instead of typing a
       * name booked yesterday. Buttons rather than a second list: the datalist
       * above already holds every broker in alphabetical order, which is a
       * lookup — this is the short answer to "who am I probably booking".
       *
       * `tabIndex={-1}`, so the typed path still tabs from the broker straight
       * to the truck. Six buttons in the way would be six tab stops before the
       * next field, and §9's forty seconds is measured on exactly that path. */}
      {recentCustomers.length > 0 ? (
        <div className="-mt-z2 flex flex-wrap gap-z1">
          {recentCustomers.map((name) => (
            <button
              key={name}
              type="button"
              tabIndex={-1}
              onClick={() => {
                const input = formRef.current?.querySelector<HTMLInputElement>(
                  'input[name="broker"]',
                )
                if (!input) return
                input.value = name
                // Setting `.value` programmatically does not fire React's
                // onChange, so the manually-modified indicator would never
                // hear about it. Told directly instead.
                if (prefill) noteChange('brokerName', name)
              }}
              className="h-control-compact rounded-control border border-border bg-surface px-z2 text-xs text-ink-2 hover:bg-surface-3 hover:text-ink"
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

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

      {/* THE STOP LIST (Phase 6 §4 step 1).
       *
       * Each row is place + type + date on one line, in the order the load
       * runs. TWO ROWS BY DEFAULT and the tab order through them is exactly
       * what the pair of place fields and the pair of dates used to be — the
       * forty-second path is measured, and a row of new controls between the
       * places and the dates would cost it.
       *
       * §8's timeline in Zebra's own language: the sequence is carried by a
       * NUMBER and a rule down the leading edge rather than by a graphic.
       * The design system has no timeline component and this phase is not the
       * place to invent one; a numbered list reads the same in RTL, prints,
       * and survives a screen reader. Named in the report as a judgment made
       * where the spec is not in the repository. */}
      <div className="flex flex-col gap-z2">
        {stops.map((stop, index) => (
          <div
            key={stop.key}
            className="flex flex-col gap-z1 border-s-2 border-border-strong ps-z3"
          >
            <div className="flex items-end gap-z2">
              <span className="pb-z2 font-mono text-xs text-ink-3">
                {index + 1}
              </span>
              <div className="flex-1">
                <Input
                  name={`stops[${index}].place`}
                  label={
                    index === 0
                      ? labels.pickup
                      : index === stops.length - 1
                        ? labels.delivery
                        : labels.stopPlace
                  }
                  list="place-options"
                  hint={hintFor(
                    `stops[${index}].city`,
                    index === 0 ? labels.placeHint : undefined,
                  )}
                  key={`place-${stop.key}-${prefill?.pendingUploadId ?? 'typed'}`}
                  defaultValue={stopPlace(index)}
                  {...(prefill
                    ? {
                        onChange: (
                          event: React.ChangeEvent<HTMLInputElement>,
                        ) =>
                          noteChange(
                            `stops[${index}].place`,
                            event.target.value,
                          ),
                      }
                    : {})}
                  required
                />
              </div>
              <Select
                name={`stops[${index}].type`}
                label={labels.stopType}
                value={stop.type}
                onChange={(event) =>
                  setStop(index, {
                    type: event.target.value as StopRow['type'],
                  })
                }
                options={[
                  { value: 'PICKUP', label: labels.stopPickup },
                  { value: 'DELIVERY', label: labels.stopDelivery },
                  { value: 'INTERMEDIATE', label: labels.stopIntermediate },
                ]}
                className="w-[130px]"
              />
              <div className="w-[130px]">
                {/* NOT `required`, since Phase 5 §3 step 5: a missing date is a
                 * WARNING naming what it costs, and an HTML `required` makes
                 * that warning unreachable — the browser refuses the submit
                 * and the sentence is never printed.
                 *
                 * TEXT, not type="date". A native date input holds three
                 * internal segments and Tab moves between them, so the dates
                 * cost three tab stops each instead of one. The first timed
                 * run put every keystroke after the first date into the wrong
                 * field and saved a delivery in the year 1. */}
                <Input
                  name={`stops[${index}].date`}
                  label={labels.stopDate}
                  inputMode="numeric"
                  placeholder={labels.datePlaceholder}
                  hint={hintFor(
                    `stops[${index}].scheduledAt`,
                    index === 0 ? labels.dateHint : undefined,
                  )}
                  value={stop.date}
                  onChange={(event) =>
                    setStop(index, { date: event.target.value })
                  }
                  onBlur={(event) =>
                    setStop(index, {
                      date:
                        normalizeTypedDate(event.target.value) ??
                        event.target.value,
                    })
                  }
                  className="font-mono"
                />
              </div>
              {/* THE APPOINTMENT WINDOW (Phase 6, the window gap).
               *
               * `LoadStop.windowStart` and `windowEnd` have been columns
               * since Phase 1 and the extraction has read them since Phase 5
               * — and until now the form had nowhere to put them, so every
               * printed `08:00–10:00` was read and dropped at save. Amazon
               * paper is window-rich, so this lands before Step 3 meets it.
               *
               * Two fields rather than one range input: a range needs parsing
               * and `0800-600` is a real thing a broker prints (Phase 5 flag
               * 30). Two plain times cannot be malformed, only empty.
               *
               * Empty is the ordinary answer. Most stops carry an
               * appointment, not a window, and rule 1 of the extraction
               * contract says a window needs two DIFFERENT ends. */}
              <div className="w-[86px]">
                <Input
                  name={`stops[${index}].from`}
                  label={labels.stopFrom}
                  inputMode="numeric"
                  placeholder={labels.timePlaceholder}
                  value={stop.from}
                  onChange={(event) =>
                    setStop(index, { from: event.target.value })
                  }
                  onBlur={(event) =>
                    setStop(index, {
                      from:
                        normalizeTypedTime(event.target.value) ??
                        event.target.value,
                    })
                  }
                  className="font-mono"
                />
              </div>
              <div className="w-[86px]">
                <Input
                  name={`stops[${index}].to`}
                  label={labels.stopTo}
                  inputMode="numeric"
                  placeholder={labels.timePlaceholder}
                  value={stop.to}
                  onChange={(event) =>
                    setStop(index, { to: event.target.value })
                  }
                  onBlur={(event) =>
                    setStop(index, {
                      to:
                        normalizeTypedTime(event.target.value) ??
                        event.target.value,
                    })
                  }
                  className="font-mono"
                />
              </div>

              {/* Reorder and remove are BUTTONS AFTER the fields, so a typist
               * tabbing through a two-stop load never lands on them before
               * the next stop. Disabled rather than hidden at the ends: a
               * control that vanishes moves everything after it. */}
              <div className="flex gap-[2px] pb-z2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => moveStop(index, -1)}
                  disabled={index === 0}
                  aria-label={labels.stopMoveUp}
                  tabIndex={-1}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => moveStop(index, 1)}
                  disabled={index === stops.length - 1}
                  aria-label={labels.stopMoveDown}
                  tabIndex={-1}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => removeStop(index)}
                  disabled={stops.length <= 2}
                  aria-label={labels.stopRemove}
                  tabIndex={-1}
                >
                  ×
                </Button>
              </div>
            </div>
            <FacilityNote facility={facilityAt(index)} labels={labels} />
          </div>
        ))}

        <div>
          <Button type="button" variant="ghost" onClick={addStop} tabIndex={-1}>
            {labels.stopAdd}
          </Button>
        </div>
      </div>

      <datalist id="place-options">
        {places.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {/* THE SHIPPER'S NUMBERS, and only when a document brought them.
       *
       * §5's last box is "typing path untouched: the repeat-load walkthrough
       * still passes at its Phase 2 timing", and two more tab stops on the hot
       * path is exactly how that stops being true. A load that was typed has no
       * BOL yet anyway — it is known at pickup, not at booking — so the fields
       * appear because an extraction filled them, and the duplicate warnings
       * they feed are about numbers a document actually carried. */}
      {prefill && (valueOf('bolNumber') || valueOf('poNumber')) ? (
        <div className="flex gap-z3">
          <div className="flex-1">
            <Input
              name="bol"
              label={labels.bol}
              identifier
              hint={hintFor('bolNumber', undefined)}
              key={`bol-${prefill.pendingUploadId}`}
              defaultValue={valueOf('bolNumber')}
              className="font-mono"
            />
          </div>
          <div className="flex-1">
            <Input
              name="po"
              label={labels.po}
              identifier
              hint={hintFor('poNumber', undefined)}
              key={`po-${prefill.pendingUploadId}`}
              defaultValue={valueOf('poNumber')}
              className="font-mono"
            />
          </div>
        </div>
      ) : null}

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

      {/* §3 STEP 5 — WARN, NOT BLOCK. In warning colours rather than danger,
       * because none of this is an error: the load is bookable and the office
       * knows things the database does not. Each sentence names the record it
       * conflicts with, which is the difference between "duplicate BOL" and
       * something a dispatcher can act on without opening another screen. */}
      {state.warnings?.length ? (
        <div
          role="alert"
          className="flex flex-col gap-z1 rounded-card border border-warning bg-warning-soft p-z3"
        >
          <p className="text-sm font-medium text-ink">{labels.warnTitle}</p>
          <ul className="flex list-disc flex-col gap-[2px] ps-z3 text-sm text-ink-2">
            {state.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* THE SIGNATURE OF EXACTLY THESE WARNINGS. Recomputed on arrival, so a
       * dispatcher who changes the BOL after being warned about it is warned
       * again rather than waved through by a tick from a moment ago. */}
      {state.acknowledge ? (
        <input type="hidden" name="acknowledge" value={state.acknowledge} />
      ) : null}

      <div className="flex items-center gap-z2">
        <Button type="submit" variant="primary" disabled={pending}>
          {state.warnings?.length ? labels.warnSaveAnyway : labels.save}
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
  // `ltr` marks the values that are IDENTIFIERS rather than prose — design
  // system §12. A gate code of "#4417" renders as "4417#" in Farsi otherwise,
  // and a driver reading it off this screen punches it into a keypad that does
  // not open. Found in this phase's RTL pass, in a panel where nothing is typed.
  const lines: [string, string | null, boolean][] = [
    [labels.facilityGateCode, memory.gateCode, true],
    [labels.facilityHours, memory.hours, true],
    [labels.facilityDock, memory.dockNotes, false],
    [labels.facilityCheckIn, memory.instructions, false],
    [labels.facilityContact, contactLine(memory), true],
    [labels.facilityNotes, memory.notes, false],
  ]

  return (
    <div className="-mt-z2 rounded-card bg-surface-2 p-z2 text-sm">
      <p className="font-medium text-ink">
        {labels.facilityKnown} {facility.name}
      </p>
      {facility.hasMemory ? (
        <dl className="mt-z1 grid grid-cols-[auto_1fr] gap-x-z2 gap-y-[2px] text-ink-2">
          {lines
            .filter((line): line is [string, string, boolean] =>
              Boolean(line[1]),
            )
            .map(([label, value, isIdentifier]) => (
              <Fragment key={label}>
                <dt className="text-ink-3">{label}</dt>
                <dd
                  className={cx('text-ink', isIdentifier && 'text-start')}
                  dir={isIdentifier ? 'ltr' : undefined}
                >
                  {value}
                </dd>
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
