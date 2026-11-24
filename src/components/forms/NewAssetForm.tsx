'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { decodeVin, normalizeVin } from '@/lib/vin-decode'
import {
  RECORD_FORM_INITIAL,
  type RecordFormState,
} from '@/components/forms/RecordForm'

// ADD TRUCK AND ADD TRAILER, THE SHORT FORM (TMS §6.5 part 3, v11.54; owner's
// ruling 2026-11-24). What identifies the unit and nothing else: Authority
// (last used, §6.3), Unit number, VIN, what the VIN decodes to, Plate and
// state on one row. Odometer and the item-12 facts live on the record's
// Details tab, and Save opens the record.
//
// THE VIN DECODES ON BLUR (`vin-decode.ts`, NHTSA vPIC from the browser).
// Make, model and year are controlled fields so the answer can be written
// into them, and stay editable; a value vPIC does not give leaves its field
// as it was. When it cannot decode, the field says so and nothing is
// blocked — Save posts whatever is in the fields, decoded or typed.

interface Props {
  kind: 'truck' | 'trailer'
  authorities: readonly SelectOption[]
  defaultAuthority: string
  action: (
    previous: RecordFormState,
    formData: FormData,
  ) => Promise<RecordFormState>
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
    save: string
    cancel: string
  }
}

type Decoding = 'idle' | 'decoding' | 'failed'

/** The fields each form renders, so a message for any other lands below. */
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
  ],
  trailer: [
    'companyId',
    'unitNumber',
    'vin',
    'year',
    'type',
    'plate',
    'plateState',
  ],
} as const

export function NewAssetForm({
  kind,
  authorities,
  defaultAuthority,
  action,
  cancelHref,
  labels,
}: Props) {
  const [state, formAction, pending] = useActionState(
    action,
    RECORD_FORM_INITIAL,
  )
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [decoding, setDecoding] = useState<Decoding>('idle')
  /** The VIN the last decode was asked about, so a stale answer is dropped. */
  const asked = useRef('')

  const errorFor = (name: string) =>
    state.field === name && state.error ? state.error : undefined

  const onVinBlur = async (event: React.FocusEvent<HTMLInputElement>) => {
    const vin = normalizeVin(event.target.value)
    if (vin === asked.current) return
    asked.current = vin
    if (vin === '') {
      setDecoding('idle')
      return
    }
    setDecoding('decoding')
    const result = await decodeVin(vin)
    if (asked.current !== vin) return
    if (!result.ok) {
      setDecoding('failed')
      return
    }
    setDecoding('idle')
    const { decoded } = result
    if (kind === 'truck') {
      if (decoded.make !== null) setMake(decoded.make)
      if (decoded.model !== null) setModel(decoded.model)
    }
    if (decoded.year !== null) setYear(String(decoded.year))
  }

  const vinHint =
    decoding === 'decoding'
      ? labels.vinDecoding
      : decoding === 'failed'
        ? labels.vinNotDecoded
        : undefined

  return (
    <form action={formAction} className="flex max-w-[520px] flex-col gap-z4">
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
        error={errorFor('unitNumber')}
        className="font-mono"
      />
      <Input
        id="asset-vin"
        name="vin"
        label={labels.vin}
        onBlur={(event) => void onVinBlur(event)}
        hint={vinHint}
        error={errorFor('vin')}
        className="font-mono"
        autoComplete="off"
        spellCheck={false}
      />
      {kind === 'truck' ? (
        <>
          <Input
            id="asset-make"
            name="make"
            label={labels.make}
            value={make}
            onChange={(event) => setMake(event.target.value)}
            error={errorFor('make')}
          />
          <Input
            id="asset-model"
            name="model"
            label={labels.model}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            error={errorFor('model')}
          />
        </>
      ) : null}
      <Input
        id="asset-year"
        name="year"
        label={labels.year}
        inputMode="numeric"
        value={year}
        onChange={(event) => setYear(event.target.value)}
        error={errorFor('year')}
      />
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
          error={errorFor('plate')}
          className="font-mono"
        />
        <Input
          id="asset-plateState"
          name="plateState"
          label={labels.plateState}
          maxLength={2}
          error={errorFor('plateState')}
          className="uppercase"
        />
      </div>

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
        <Button type="submit" variant="primary" disabled={pending}>
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
  )
}
