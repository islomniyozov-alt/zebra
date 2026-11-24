import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  decodableVin,
  decodeVin,
  readVpic,
  vpicUrl,
  VPIC_ORIGIN,
} from '@/lib/vin-decode'
import { NEW_ASSET_FIELDS } from '@/components/forms/NewAssetForm'
import { TRUCK_DETAIL_FIELDS, TRUCK_STATUS_FIELDS } from '@/lib/truck-form'
import { translator } from '@/lib/i18n'

// ADD TRUCK, THE SHORT FORM (TMS §6.5 part 3, v11.54; owner's ruling
// 2026-11-24). The VIN decodes on blur through NHTSA vPIC, fills make, model
// and year, and never blocks. The vPIC rows below are trimmed from real
// answers read on 2026-11-24 (DecodeVinValues, format=json).

const KENWORTH = {
  Count: 1,
  Results: [
    {
      Make: 'KENWORTH',
      Model: 'T680',
      ModelYear: '2020',
      ErrorCode: '1',
      ErrorText: '1 - Check Digit (9th position) does not calculate properly',
      BodyClass: 'Truck-Tractor',
    },
  ],
}
const UNKNOWN = {
  Count: 1,
  Results: [
    {
      Make: '',
      Model: '',
      ModelYear: '',
      ErrorCode: '1,7,11,400',
      ErrorText: '400 - Invalid Characters Present',
    },
  ],
}

const answer = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('reading vPIC', () => {
  it('fills make, model and year from a decoded VIN, check-digit error and all', () => {
    expect(readVpic(KENWORTH)).toEqual({
      ok: true,
      decoded: { make: 'KENWORTH', model: 'T680', year: 2020 },
    })
  })

  it('an answer with no make, model or year could not be decoded', () => {
    expect(readVpic(UNKNOWN)).toEqual({ ok: false })
    expect(readVpic({ Results: [] })).toEqual({ ok: false })
    expect(readVpic(null)).toEqual({ ok: false })
  })

  it('a value vPIC does not give is null, so the field keeps what it had', () => {
    const yearOnly = {
      Results: [{ Make: '', Model: 'Not Applicable', ModelYear: '2010' }],
    }
    expect(readVpic(yearOnly)).toEqual({
      ok: true,
      decoded: { make: null, model: null, year: 2010 },
    })
    const badYear = { Results: [{ Make: 'MACK', ModelYear: '20X0' }] }
    expect(readVpic(badYear)).toEqual({
      ok: true,
      decoded: { make: 'MACK', model: null, year: null },
    })
  })
})

describe('asking vPIC', () => {
  it('asks the keyless DecodeVinValues endpoint about the VIN as typed, normalized', () => {
    expect(vpicUrl(' 1xkydp9x5lj407290 ')).toBe(
      `${VPIC_ORIGIN}/api/vehicles/DecodeVinValues/1XKYDP9X5LJ407290?format=json`,
    )
  })

  it('a VIN that is not 17 letters and digits is not sent', async () => {
    let calls = 0
    const counting = (async () => {
      calls++
      return new Response('{}')
    }) as unknown as typeof fetch
    expect(decodableVin('1XKYDP9X5LJ40729')).toBe(false)
    expect(await decodeVin('1XKYDP9X5LJ40729', counting)).toEqual({
      ok: false,
    })
    expect(await decodeVin('1XKYDP9X5LJ40729-', counting)).toEqual({
      ok: false,
    })
    expect(calls).toBe(0)
  })

  it('decodes a good answer', async () => {
    expect(await decodeVin('1XKYDP9X5LJ407290', answer(KENWORTH))).toEqual({
      ok: true,
      decoded: { make: 'KENWORTH', model: 'T680', year: 2020 },
    })
  })

  it('every failure is "could not decode", never a throw', async () => {
    const vin = '1XKYDP9X5LJ407290'
    expect(await decodeVin(vin, answer(KENWORTH, 503))).toEqual({ ok: false })
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await decodeVin(vin, offline)).toEqual({ ok: false })
    const notJson = (async () =>
      new Response('<html>')) as unknown as typeof fetch
    expect(await decodeVin(vin, notJson)).toEqual({ ok: false })
  })

  it('gives up at the timeout rather than holding the form', async () => {
    const hangs = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })) as unknown as typeof fetch
    const started = Date.now()
    expect(await decodeVin('1XKYDP9X5LJ407290', hangs, 50)).toEqual({
      ok: false,
    })
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('the short form', () => {
  const form = readFileSync('src/components/forms/NewAssetForm.tsx', 'utf8')
  const truckPage = readFileSync('src/app/(app)/trucks/new/page.tsx', 'utf8')
  const trailerPage = readFileSync(
    'src/app/(app)/trailers/new/page.tsx',
    'utf8',
  )

  it('asks for what identifies the unit and nothing else', () => {
    expect(NEW_ASSET_FIELDS.truck).toEqual([
      'companyId',
      'unitNumber',
      'vin',
      'make',
      'model',
      'year',
      'plate',
      'plateState',
    ])
    expect(NEW_ASSET_FIELDS.trailer).toEqual([
      'companyId',
      'unitNumber',
      'vin',
      'year',
      'type',
      'plate',
      'plateState',
    ])
    // Every name the form posts is one of those, and none of the Details tab's.
    const posted = [...form.matchAll(/name="(\w+)"/g)].map((m) => m[1])
    const listed = new Set<string>([
      ...NEW_ASSET_FIELDS.truck,
      ...NEW_ASSET_FIELDS.trailer,
    ])
    for (const name of posted) expect(listed.has(name!)).toBe(true)
    for (const name of TRUCK_DETAIL_FIELDS) expect(posted).not.toContain(name)
    expect(posted).not.toContain('status')
    expect(posted).not.toContain('ownershipType')
  })

  it('both pages use it, and the old long form is gone from them', () => {
    expect(truckPage).toContain('<NewAssetForm')
    expect(truckPage).toContain('kind="truck"')
    expect(trailerPage).toContain('kind="trailer"')
    expect(truckPage).not.toContain('RecordForm')
    expect(trailerPage).not.toContain('RecordForm')
  })

  it('decodes on blur and fills, never on submit', () => {
    expect(form).toContain('onBlur={(event) => void onVinBlur(event)}')
    expect(form).toContain('const result = await decodeVin(vin)')
    expect(form).toContain('if (decoded.make !== null) setMake(decoded.make)')
    expect(form).toContain(
      'if (decoded.year !== null) setYear(String(decoded.year))',
    )
    expect(form).not.toMatch(/disabled=\{[^}]*decod/)
  })

  it('Save opens the record', () => {
    const trucks = readFileSync('src/app/(app)/trucks/actions.ts', 'utf8')
    const trailers = readFileSync('src/app/(app)/trailers/actions.ts', 'utf8')
    expect(trucks).toContain('redirect(`/trucks/${created.id}`)')
    expect(trailers).toContain('redirect(`/trailers/${created.id}`)')
  })

  it('the odometer is on Details, not Main', () => {
    expect(TRUCK_DETAIL_FIELDS).toContain('currentOdometer')
    expect(TRUCK_STATUS_FIELDS).not.toContain('currentOdometer')
  })

  it('/trucks has no stripe caption', () => {
    const list = readFileSync('src/app/(app)/trucks/page.tsx', 'utf8')
    expect(list).not.toContain('stripeMeaning')
  })

  it('says it in both languages', () => {
    const en = translator('en')
    const ru = translator('ru')
    expect(en('fleet.vinNotDecoded')).toBe('Could not decode VIN')
    for (const key of ['fleet.vinNotDecoded', 'fleet.vinDecoding'] as const) {
      expect(ru(key)).toEqual(expect.stringMatching(/\S/))
      expect(ru(key)).not.toBe(en(key))
    }
  })
})
