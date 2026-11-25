'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { DropZone } from '@/components/forms/DropZone'
import {
  decodeVin,
  mergeDecode,
  normalizeVin,
  type DecodeField,
  type FieldSource,
} from '@/lib/vin-decode'
import { photoPagesRefusalKey } from '@/lib/photo-pages'
import { photosAsDocument, uploadDocument } from '@/lib/upload-client'
import { HELD_CARD_PARAM, HELD_CARD_VALUE, takeHeldCard } from '@/lib/held-card'
import {
  verdictFor,
  type RegistrationFormField,
  type RegistrationVerdicts,
} from '@/lib/extraction/registration-fields'
import type { NewAssetState } from '@/lib/new-asset'
import { RECORD_FORM_INITIAL } from '@/components/forms/RecordForm'

// ADD TRUCK AND ADD TRAILER, THE SHORT FORM (TMS §6.5 parts 3 and 4, v11.54
// and v11.55; owner's rulings 2026-11-24). What identifies the unit and
// nothing else: Authority (last used, §6.3), Unit number, VIN, what the VIN
// decodes to, Plate and state on one row. Odometer and the item-12 facts live
// on the record's Details tab, and Save opens the record.
//
// THE VIN DECODES ON BLUR (`vin-decode.ts`, NHTSA vPIC from the browser). A
// field that is empty, or that the decode itself filled, takes vPIC's value;
// a field holding a value from the registration or the keyboard keeps it and,
// where vPIC disagrees, shows "VIN decodes to …" beside it. Nothing about the
// decode ever blocks Save.
//
// A REGISTRATION DROPPED ON THE ZONE (part 4) is read by
// `/api/registration/read`, which never writes. Each field it read fills;
// each it could not is left as it was and says "Unreadable — enter by hand"
// with what was seen. Then the decode runs on the VIN, as on blur. While the
// document is held the form also asks the registration's expiry (and, on a
// truck, shows owner name and GVWR, which fill Details), and Save files the
// REGISTRATION item with the unit; the browser then puts the file on it and
// opens the record.
//
// PART 5 (v11.56): the card's unit number fills Unit number; its issue date,
// fuel and lessor fill beside the expiry (issued files on the REGISTRATION
// item, fuel and lessor on the truck's Details); its type code is shown under
// the held document and not kept. The decode's make REPLACES the card's, the
// card's spelling shown beside it as "Card: …" (`mergeDecode`), and a field the
// decode filled says "From VIN", never "Unreadable".

type Kind = 'truck' | 'trailer'

interface Props {
  kind: Kind
  authorities: readonly SelectOption[]
  defaultAuthority: string
  action: (
    previous: NewAssetState,
    formData: FormData,
  ) => Promise<NewAssetState>
  cancelHref: string
  labels: {
    authority: string
    unitNumber: string
    vin: string
    make: string
    model: string
    year: string
    type: string
    typeHint: string
    plate: string
    plateState: string
    vinDecoding: string
    vinNotDecoded: string
    /** "VIN decodes to {value}". */
    vinMismatch: string
    save: string
    cancel: string
    registration: {
      dropTitle: string
      dropBody: string
      dropHint: string
      reading: string
      filled: string
      unreadable: string
      failed: string
      byHand: string
      /** "read as “{printed}”". */
      seen: string
      /** "Registration: {name}". */
      held: string
      remove: string
      expires: string
      expiresHint: string
      ownerName: string
      gvwr: string
      fromVin: string
      /** "Card: {value}". */
      cardSays: string
      /** "Card type: {code}". */
      cardType: string
      issued: string
      fuel: string
      /** The truck's fuel code list, `FUEL_TYPES`. */
      fuelOptions: readonly string[]
      lessorName: string
      attachFailed: string
      openRecord: string
    }
    /** The several-photos refusals, by key. */
    pageErrors: Record<string, string>
  }
}

type Decoding = 'idle' | 'decoding' | 'failed'
type Source = FieldSource
type Reading = 'idle' | 'reading' | 'filled' | 'unreadable' | 'failed'

/** The fields each form can render, so a message for any other lands below. */
export const NEW_ASSET_FIELDS = {
  truck: [
    'companyId',
    'unitNumber',
    'vin',
    'make',
    'model',
    'year',
    'plate',
    'plateState',
    'registration',
    'registrationExpiresAt',
    'registrationIssuedAt',
    'ownerName',
    'lessorName',
    'fuelType',
    'grossWeightLbs',
  ],
  trailer: [
    'companyId',
    'unitNumber',
    'vin',
    'year',
    'type',
    'plate',
    'plateState',
    'registration',
    'registrationExpiresAt',
    'registrationIssuedAt',
  ],
} as const

/** What the decode may fill, per unit: a trailer has no make or model. */
const DECODED: Record<Kind, readonly DecodeField[]> = {
  truck: ['make', 'model', 'year'],
  trailer: ['year'],
}

/** What a registration may fill, per unit, in the form's own names. */
const FROM_REGISTRATION: Record<Kind, readonly RegistrationFormField[]> = {
  truck: [
    'unitNumber',
    'vin',
    'plate',
    'plateState',
    'year',
    'make',
    'model',
    'ownerName',
    'grossWeightLbs',
    'registrationExpiresAt',
    'registrationIssuedAt',
    'fuelType',
    'lessorName',
  ],
  trailer: [
    'unitNumber',
    'vin',
    'plate',
    'plateState',
    'year',
    'registrationExpiresAt',
    'registrationIssuedAt',
  ],
}

type Values = Record<RegistrationFormField, string>
const EMPTY: Values = {
  vin: '',
  plate: '',
  plateState: '',
  year: '',
  make: '',
  model: '',
  ownerName: '',
  grossWeightLbs: '',
  registrationExpiresAt: '',
  unitNumber: '',
  registrationIssuedAt: '',
  fuelType: '',
  lessorName: '',
}

interface ReadingView {
  verdicts: RegistrationVerdicts
  prefill: Partial<Values>
}

export function NewAssetForm({
  kind,
  authorities,
  defaultAuthority,
  action,
  cancelHref,
  labels,
}: Props) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(
    action,
    RECORD_FORM_INITIAL as NewAssetState,
  )
  const [values, setValues] = useState<Values>(EMPTY)
  const [sources, setSources] = useState<Record<DecodeField, Source>>({
    make: 'none',
    model: 'none',
    year: 'none',
  })
  const [mismatch, setMismatch] = useState<
    Partial<Record<DecodeField, string>>
  >({})
  const [card, setCard] = useState<Partial<Record<DecodeField, string>>>({})
  const [decoding, setDecoding] = useState<Decoding>('idle')
  const [held, setHeld] = useState<File | null>(null)
  const [reading, setReading] = useState<Reading>('idle')
  const [view, setView] = useState<ReadingView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [attach, setAttach] = useState<'idle' | 'failed'>('idle')
  /** The VIN the last decode was asked about, so a stale answer is dropped. */
  const asked = useRef('')
  // The latest values and sources, for the decode's answer, which arrives
  // after the render that asked.
  const valuesRef = useRef(values)
  const sourcesRef = useRef(sources)
  useEffect(() => {
    valuesRef.current = values
    sourcesRef.current = sources
  }, [values, sources])

  const set = (name: RegistrationFormField, value: string) =>
    setValues((current) => ({ ...current, [name]: value }))

  const errorFor = (name: string) =>
    state.field === name && state.error ? state.error : undefined

  // ── THE DECODE ────────────────────────────────────────────────────────
  const runDecode = async (raw: string) => {
    const vin = normalizeVin(raw)
    if (vin === asked.current) return
    asked.current = vin
    if (vin === '') {
      setDecoding('idle')
      setMismatch({})
      return
    }
    setDecoding('decoding')
    const result = await decodeVin(vin)
    if (asked.current !== vin) return
    if (!result.ok) {
      setDecoding('failed')
      setMismatch({})
      return
    }
    setDecoding('idle')
    const merge = mergeDecode(
      DECODED[kind],
      valuesRef.current,
      sourcesRef.current,
      result.decoded,
    )
    const filled: Partial<Record<DecodeField, Source>> = {}
    for (const field of merge.filled) filled[field] = 'vin'
    setValues((current) => ({ ...current, ...merge.fill }))
    setSources((current) => ({ ...current, ...filled }))
    setMismatch(merge.mismatch)
    setCard((current) => ({ ...current, ...merge.card }))
  }

  const typedDecoded = (field: DecodeField, value: string) => {
    set(field, value)
    setSources((current) => ({ ...current, [field]: 'typed' }))
    const without = (current: Partial<Record<DecodeField, string>>) => {
      const next = { ...current }
      delete next[field]
      return next
    }
    setMismatch(without)
    setCard(without)
  }

  // ── THE REGISTRATION ──────────────────────────────────────────────────
  /** A reading, from this zone or handed over by the Safety intake. */
  const applyReading = (file: File, reading: ReadingView) => {
    const fill: Partial<Values> = {}
    for (const name of FROM_REGISTRATION[kind]) {
      const value = reading.prefill[name]
      if (value !== undefined) fill[name] = value
    }
    const next = { ...valuesRef.current, ...fill }
    const nextSources = { ...sourcesRef.current }
    for (const field of DECODED[kind])
      if (fill[field] !== undefined) nextSources[field] = 'doc'
    valuesRef.current = next
    sourcesRef.current = nextSources
    setValues(next)
    setSources(nextSources)
    setHeld(file)
    setView(reading)
    setReading('filled')
    // The decode cross-checks what the document said, as on blur.
    asked.current = ''
    void runDecode(next.vin)
  }

  // THE SAFETY INTAKE'S HANDOFF (TMS §7.8, v11.57): "No truck with this VIN —
  // add it" opens this page as `?card=held` with the card already read on
  // this device. Taken once; absent or stale, the page is simply empty.
  const handoff = useRef(false)
  useEffect(() => {
    if (handoff.current) return
    handoff.current = true
    const query = new URLSearchParams(window.location.search)
    if (query.get(HELD_CARD_PARAM) !== HELD_CARD_VALUE) return
    void takeHeldCard<ReadingView>().then((card) => {
      if (card)
        applyReading(
          new File([card.file], card.file.name, { type: card.file.type }),
          card.reading,
        )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [])

  const take = async (files: readonly File[]) => {
    setNotice(null)
    if (files.length > 1 && files.some((f) => !f.type.startsWith('image/'))) {
      setNotice(labels.pageErrors['pages.error.pdfAmong'] ?? null)
      return
    }
    setReading('reading')
    let file = files[0]!
    try {
      if (files.length > 1) {
        const built = await photosAsDocument(files)
        if (!built.ok) {
          setReading('idle')
          setNotice(
            labels.pageErrors[photoPagesRefusalKey(built.reason)] ?? null,
          )
          return
        }
        file = built.file
      }
      const body = new FormData()
      body.append('file', file)
      const response = await fetch('/api/registration/read', {
        method: 'POST',
        body,
      })
      if (!response.ok) {
        setReading('failed')
        return
      }
      const payload = (await response.json()) as {
        reading: ReadingView | null
        notice: string | null
      }
      if (!payload.reading) {
        setReading(
          payload.notice === 'fleet.registration.failed'
            ? 'failed'
            : 'unreadable',
        )
        return
      }
      applyReading(file, payload.reading)
    } catch {
      setReading('failed')
    }
  }

  const removeDocument = () => {
    setHeld(null)
    setView(null)
    setReading('idle')
    setCard({})
    set('registrationExpiresAt', '')
    set('registrationIssuedAt', '')
  }

  // ── AFTER SAVE: THE FILE GOES ON THE REGISTRATION ITEM ────────────────
  const created = state.created ?? null
  const recordHref = created ? `/${kind}s/${created.id}` : null
  useEffect(() => {
    if (!created?.registrationId || !held || attach !== 'idle') return
    uploadDocument(held, {
      entity: 'complianceItem',
      entityId: created.registrationId,
      documentType: 'REGISTRATION',
    })
      .then(() => router.push(`/${kind}s/${created.id}`))
      .catch(() => setAttach('failed'))
  }, [created, held, attach, kind, router])

  /**
   * Under a field the registration could not read: by hand, and what was
   * seen. A field the decode filled says "From VIN" instead (part 5).
   */
  const unreadHint = (name: RegistrationFormField): string | undefined => {
    if (
      (name === 'make' || name === 'model' || name === 'year') &&
      sources[name] === 'vin' &&
      values[name].trim() !== ''
    )
      return labels.registration.fromVin
    if (!view) return undefined
    const verdict = verdictFor(view.verdicts, name)
    if (verdict.read) return undefined
    return verdict.printed
      ? `${labels.registration.byHand} — ${labels.registration.seen.replace('{printed}', verdict.printed)}`
      : labels.registration.byHand
  }

  const vinHint =
    decoding === 'decoding'
      ? labels.vinDecoding
      : decoding === 'failed'
        ? labels.vinNotDecoded
        : unreadHint('vin')

  /** A decoded field, with the mismatch beside it when vPIC disagrees. */
  const decodedField = (field: DecodeField, label: string) => (
    <div className="flex flex-col gap-z1">
      <Input
        id={`asset-${field}`}
        name={field}
        label={label}
        inputMode={field === 'year' ? 'numeric' : undefined}
        value={values[field]}
        onChange={(event) => typedDecoded(field, event.target.value)}
        hint={unreadHint(field)}
        error={errorFor(field)}
      />
      {card[field] ? (
        <p className="text-xs text-ink-2">
          {labels.registration.cardSays.replace('{value}', card[field]!)}
        </p>
      ) : null}
      {mismatch[field] ? (
        <p role="status" className="text-xs text-warning">
          {labels.vinMismatch.replace('{value}', mismatch[field]!)}
        </p>
      ) : null}
    </div>
  )

  const readingLine =
    reading === 'reading'
      ? null
      : reading === 'filled'
        ? labels.registration.filled
        : reading === 'unreadable'
          ? labels.registration.unreadable
          : reading === 'failed'
            ? labels.registration.failed
            : null

  if (created && attach === 'failed' && recordHref) {
    return (
      <div className="flex max-w-[520px] flex-col gap-z3">
        <p role="alert" className="text-sm text-warning">
          {labels.registration.attachFailed}
        </p>
        <Link href={recordHref} className="text-sm text-accent underline">
          {labels.registration.openRecord}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex max-w-[520px] flex-col gap-z4">
      {held ? (
        <div className="flex items-center justify-between gap-z3 rounded-card border border-border bg-surface px-z3 py-z2 text-sm">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ink">
              {labels.registration.held.replace('{name}', held.name)}
            </span>
            {view?.verdicts.vehicleType.read ? (
              <span className="text-xs text-ink-2">
                {labels.registration.cardType.replace(
                  '{code}',
                  view.verdicts.vehicleType.value,
                )}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={removeDocument}
            className="shrink-0 text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-accent"
          >
            {labels.registration.remove}
          </button>
        </div>
      ) : (
        <DropZone
          labels={{
            title: labels.registration.dropTitle,
            body: labels.registration.dropBody,
            hint: labels.registration.dropHint,
            busy: labels.registration.reading,
          }}
          busy={reading === 'reading'}
          onFile={() => {}}
          onFiles={(files) => void take(files)}
        />
      )}
      {notice ? (
        <p role="status" className="text-sm text-warning">
          {notice}
        </p>
      ) : null}
      {readingLine ? (
        <p
          role="status"
          className={
            reading === 'filled' ? 'text-sm text-ink-2' : 'text-sm text-warning'
          }
        >
          {readingLine}
        </p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-z4">
        {authorities.length > 0 ? (
          <Select
            name="companyId"
            label={labels.authority}
            options={authorities}
            defaultValue={defaultAuthority}
            required
            error={errorFor('companyId')}
          />
        ) : null}
        <Input
          id="asset-unitNumber"
          name="unitNumber"
          label={labels.unitNumber}
          required
          autoFocus
          value={values.unitNumber}
          onChange={(event) => set('unitNumber', event.target.value)}
          hint={unreadHint('unitNumber')}
          error={errorFor('unitNumber')}
          className="font-mono"
        />
        <Input
          id="asset-vin"
          name="vin"
          label={labels.vin}
          value={values.vin}
          onChange={(event) => set('vin', event.target.value)}
          onBlur={(event) => void runDecode(event.target.value)}
          hint={vinHint}
          error={errorFor('vin')}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        {kind === 'truck' ? decodedField('make', labels.make) : null}
        {kind === 'truck' ? decodedField('model', labels.model) : null}
        {decodedField('year', labels.year)}
        {kind === 'trailer' ? (
          <Input
            id="asset-type"
            name="type"
            label={labels.type}
            hint={labels.typeHint}
            error={errorFor('type')}
          />
        ) : null}
        <div className="grid grid-cols-[1fr_8rem] gap-z3">
          <Input
            id="asset-plate"
            name="plate"
            label={labels.plate}
            value={values.plate}
            onChange={(event) => set('plate', event.target.value)}
            hint={unreadHint('plate')}
            error={errorFor('plate')}
            className="font-mono"
          />
          <Input
            id="asset-plateState"
            name="plateState"
            label={labels.plateState}
            maxLength={2}
            value={values.plateState}
            onChange={(event) => set('plateState', event.target.value)}
            hint={unreadHint('plateState')}
            error={errorFor('plateState')}
            className="uppercase"
          />
        </div>

        {held ? (
          <>
            <input type="hidden" name="registration" value="yes" />
            <Input
              id="asset-registrationExpiresAt"
              name="registrationExpiresAt"
              label={labels.registration.expires}
              required
              inputMode="numeric"
              value={values.registrationExpiresAt}
              onChange={(event) =>
                set('registrationExpiresAt', event.target.value)
              }
              hint={
                unreadHint('registrationExpiresAt') ??
                labels.registration.expiresHint
              }
              error={errorFor('registrationExpiresAt')}
            />
            <Input
              id="asset-registrationIssuedAt"
              name="registrationIssuedAt"
              label={labels.registration.issued}
              inputMode="numeric"
              value={values.registrationIssuedAt}
              onChange={(event) =>
                set('registrationIssuedAt', event.target.value)
              }
              hint={unreadHint('registrationIssuedAt')}
              error={errorFor('registrationIssuedAt')}
            />
            {kind === 'truck' ? (
              <>
                <Input
                  id="asset-ownerName"
                  name="ownerName"
                  label={labels.registration.ownerName}
                  value={values.ownerName}
                  onChange={(event) => set('ownerName', event.target.value)}
                  hint={unreadHint('ownerName')}
                  error={errorFor('ownerName')}
                />
                <Input
                  id="asset-lessorName"
                  name="lessorName"
                  label={labels.registration.lessorName}
                  value={values.lessorName}
                  onChange={(event) => set('lessorName', event.target.value)}
                  hint={unreadHint('lessorName')}
                  error={errorFor('lessorName')}
                />
                <Input
                  id="asset-grossWeightLbs"
                  name="grossWeightLbs"
                  label={labels.registration.gvwr}
                  inputMode="numeric"
                  value={values.grossWeightLbs}
                  onChange={(event) =>
                    set('grossWeightLbs', event.target.value)
                  }
                  hint={unreadHint('grossWeightLbs')}
                  error={errorFor('grossWeightLbs')}
                />
                <div className="flex flex-col gap-z1">
                  <Select
                    id="asset-fuelType"
                    name="fuelType"
                    label={labels.registration.fuel}
                    options={[
                      { value: '', label: '—' },
                      ...labels.registration.fuelOptions.map((value) => ({
                        value,
                        label: value,
                      })),
                    ]}
                    value={values.fuelType}
                    onChange={(event) => set('fuelType', event.target.value)}
                    error={errorFor('fuelType')}
                  />
                  {unreadHint('fuelType') ? (
                    <p className="text-sm text-ink-3">
                      {unreadHint('fuelType')}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {/* A message for no field, or for one this short form does not show,
         * still has to land somewhere. */}
        {state.error &&
        !(NEW_ASSET_FIELDS[kind] as readonly string[]).includes(
          state.field ?? '',
        ) ? (
          <p role="alert" className="text-base text-danger">
            {state.error}
          </p>
        ) : null}

        <div className="flex items-center gap-z2">
          <Button
            type="submit"
            variant="primary"
            disabled={pending || reading === 'reading' || created !== null}
          >
            {labels.save}
          </Button>
          <Link
            href={cancelHref}
            className="inline-flex h-control items-center rounded-control px-z3 text-base font-medium text-ink-2 hover:bg-surface-3"
          >
            {labels.cancel}
          </Link>
        </div>
      </form>
    </div>
  )
}
