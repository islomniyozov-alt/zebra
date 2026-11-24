import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  REGISTRATION_FIELDS,
  REGISTRATION_FORBIDDEN_FIELDS,
  REGISTRATION_SCHEMA,
  type ExtractedRegistration,
} from '@/lib/extraction/registration-shape'
import { REGISTRATION_SYSTEM } from '@/lib/extraction/registration-prompt'
import { parseRegistrationResponse } from '@/lib/extraction/registration-parse'
import {
  judgeRegistration,
  readGvwr,
  readModelYear,
  readPlateState,
  registrationPrefill,
} from '@/lib/extraction/registration-fields'
import { decodeMismatches } from '@/lib/vin-decode'
import { readRegistrationFiling } from '@/lib/new-asset'
import { translator } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// THE VEHICLE-REGISTRATION READER (TMS §6.5 part 4, v11.55; owner's ruling
// 2026-11-24): nine fields, each read or unreadable, never a guess; the form
// fills, the VIN decode cross-checks, and Save files the REGISTRATION item.
// The accuracy run against a real cab card is a separate instrument
// (`corpus/registration/`, truth written first); these hold the contract.
// ---------------------------------------------------------------------------

/** A VIN whose check digit holds (the ISO 3779 worked example). */
const GOOD_VIN = '1M8GDM9AXKP042788'
const UPLOADED = '2026-11-24'

const high = (value: string) => ({ value, confidence: 'high' as const })
const card = (
  over: Partial<ExtractedRegistration> = {},
): ExtractedRegistration => ({
  vin: high(GOOD_VIN),
  plate: high('P123456'),
  plateState: high('IL'),
  expiresAt: high('03/31/2027'),
  year: high('2020'),
  make: high('FRHT'),
  model: high('CASCADIA'),
  ownerName: high('CYBER TRUCKING INC'),
  gvwr: high('80,000'),
  ...over,
})

describe('the contract', () => {
  it('asks for exactly the nine fields, and the prompt lists each', () => {
    expect(REGISTRATION_FIELDS).toEqual([
      'vin',
      'plate',
      'plateState',
      'expiresAt',
      'year',
      'make',
      'model',
      'ownerName',
      'gvwr',
    ])
    expect(REGISTRATION_SCHEMA.required).toEqual(REGISTRATION_FIELDS)
    expect(REGISTRATION_SCHEMA.additionalProperties).toBe(false)
    const list = REGISTRATION_SYSTEM.slice(
      REGISTRATION_SYSTEM.indexOf('RETURN EXACTLY'),
      REGISTRATION_SYSTEM.indexOf('A FIELD YOU CANNOT READ'),
    )
    for (const name of REGISTRATION_FIELDS) expect(list).toContain(name)
  })

  it('never grows a field for the rest of the card', () => {
    const shape = readFileSync(
      'src/lib/extraction/registration-shape.ts',
      'utf8',
    )
    const typeBlock = shape.slice(
      shape.indexOf('export interface ExtractedRegistration'),
      shape.indexOf('const field ='),
    )
    for (const name of REGISTRATION_FORBIDDEN_FIELDS) {
      expect(Object.keys(REGISTRATION_SCHEMA.properties)).not.toContain(name)
      expect(typeBlock).not.toMatch(new RegExp(`\\b${name}\\??:`))
    }
  })

  it('the prompt says null over a guess, and refuses to convert dates', () => {
    expect(REGISTRATION_SYSTEM).toContain(
      'A null is correct; a plausible guess is',
    )
    expect(REGISTRATION_SYSTEM).toContain('DO NOT CONVERT THEM')
    expect(REGISTRATION_SYSTEM).toContain(
      'do not take the year or the make from the VIN',
    )
  })

  it('parses what the model said, field by field', () => {
    const parsed = parseRegistrationResponse(
      JSON.stringify({
        vin: { value: GOOD_VIN, confidence: 'high' },
        plate: null,
        plateState: { value: 'IL', confidence: 'medium' },
        expiresAt: { value: '03/31/2027', confidence: 'high' },
        year: null,
        make: null,
        model: null,
        ownerName: null,
        gvwr: null,
      }),
    )
    expect(parsed.vin?.value).toBe(GOOD_VIN)
    expect(parsed.plate).toBeNull()
    expect(parsed.plateState?.confidence).toBe('medium')
  })
})

describe('each field read or unreadable', () => {
  it('reads a clean card, every field', () => {
    const verdicts = judgeRegistration(card(), UPLOADED)
    expect(registrationPrefill(verdicts)).toEqual({
      vin: GOOD_VIN,
      plate: 'P123456',
      plateState: 'IL',
      year: '2020',
      make: 'FRHT',
      model: 'CASCADIA',
      ownerName: 'CYBER TRUCKING INC',
      grossWeightLbs: '80000',
      registrationExpiresAt: '03/31/2027',
    })
  })

  it('an unsure field is unreadable and the rest still fill', () => {
    const verdicts = judgeRegistration(
      card({ plate: { value: 'P12345?', confidence: 'low' }, make: null }),
      UPLOADED,
    )
    expect(verdicts.plate).toEqual({
      read: false,
      why: 'low_confidence',
      printed: 'P12345?',
    })
    expect(verdicts.make).toEqual({
      read: false,
      why: 'not_shown',
      printed: null,
    })
    const prefill = registrationPrefill(verdicts)
    expect(prefill.plate).toBeUndefined()
    expect(prefill.make).toBeUndefined()
    expect(prefill.vin).toBe(GOOD_VIN)
  })

  it('a VIN that fails its check digit is unreadable, never corrected', () => {
    const verdicts = judgeRegistration(
      card({ vin: high('1M8GDM9AYKP042788') }),
      UPLOADED,
    )
    expect(verdicts.vin).toMatchObject({ read: false, why: 'vin_invalid' })
  })

  it('an expiry that is not a date is unreadable', () => {
    const verdicts = judgeRegistration(
      card({ expiresAt: high('MAR 2027?') }),
      UPLOADED,
    )
    expect(verdicts.expiresAt).toMatchObject({
      read: false,
      why: 'not_a_date',
    })
  })

  it('plate state: two letters or a full name, nothing else', () => {
    expect(readPlateState('il')).toEqual({ ok: true, value: 'IL' })
    expect(readPlateState('Illinois')).toEqual({ ok: true, value: 'IL' })
    expect(readPlateState('New York')).toEqual({ ok: true, value: 'NY' })
    expect(readPlateState('Ill.')).toEqual({ ok: false, why: 'not_a_state' })
  })

  it('year: four digits, 1950 to next year', () => {
    expect(readModelYear('2027', UPLOADED)).toEqual({ ok: true, value: 2027 })
    expect(readModelYear('2028', UPLOADED).ok).toBe(false)
    expect(readModelYear('1949', UPLOADED).ok).toBe(false)
    expect(readModelYear('20', UPLOADED).ok).toBe(false)
  })

  it('GVWR: whole pounds; a kilogram figure is not converted', () => {
    expect(readGvwr('80,000')).toEqual({ ok: true, value: 80_000 })
    expect(readGvwr('80000 LBS')).toEqual({ ok: true, value: 80_000 })
    expect(readGvwr('80 000 lb')).toEqual({ ok: true, value: 80_000 })
    expect(readGvwr('36287 KG').ok).toBe(false)
    expect(readGvwr('80.5').ok).toBe(false)
    expect(readGvwr('999').ok).toBe(false)
  })
})

describe('the VIN decode cross-checks', () => {
  const decoded = { make: 'FREIGHTLINER', model: 'Cascadia', year: 2020 }

  it('a cab card’s make code agrees with vPIC’s name', () => {
    expect(
      decodeMismatches(
        { make: 'FRHT', model: 'CASCADIA', year: '2020' },
        decoded,
      ),
    ).toEqual({})
    expect(
      decodeMismatches(
        { make: 'UTILITY', model: '', year: '' },
        { make: 'UTILITY TRAILER MANUFACTURER', model: null, year: null },
      ),
    ).toEqual({})
  })

  it('names vPIC’s value beside each field that disagrees', () => {
    expect(
      decodeMismatches({ make: 'KW', model: 'T680', year: '2019' }, decoded),
    ).toEqual({ make: 'FREIGHTLINER', model: 'Cascadia', year: '2020' })
  })

  it('an empty field, or one vPIC says nothing about, is never a mismatch', () => {
    expect(
      decodeMismatches(
        { make: '', model: 'X', year: '' },
        { make: 'MACK', model: null, year: 2020 },
      ),
    ).toEqual({})
  })
})

describe('Save files the registration', () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData()
    for (const [k, v] of Object.entries(entries)) data.set(k, v)
    return data
  }
  const today = new Date('2026-11-24T12:00:00Z')

  it('without a document, nothing is filed', () => {
    expect(
      readRegistrationFiling(
        form({ registrationExpiresAt: '03/31/2027' }),
        today,
      ),
    ).toEqual({ ok: true, filing: null })
  })

  it('with one, the expiry is required and must be a date', () => {
    expect(
      readRegistrationFiling(form({ registration: 'yes' }), today),
    ).toEqual({
      ok: false,
      error: 'fleet.registration.noExpiry',
    })
    expect(
      readRegistrationFiling(
        form({ registration: 'yes', registrationExpiresAt: '13/45/2027' }),
        today,
      ),
    ).toEqual({ ok: false, error: 'fleet.registration.expiryNotDate' })
  })

  it('files the expiry, the plate as identifier and the state as issuer', () => {
    const read = readRegistrationFiling(
      form({
        registration: 'yes',
        registrationExpiresAt: '03/31/2027',
        plate: 'P123456',
        plateState: 'il',
      }),
      today,
    )
    if (!read.ok || !read.filing) throw new Error('not filed')
    expect(read.filing.expiresAt.toISOString()).toBe('2027-03-31T00:00:00.000Z')
    expect(read.filing.identifier).toBe('P123456')
    expect(read.filing.issuer).toBe('IL')
  })
})

describe('the screens', () => {
  const formSource = readFileSync(
    'src/components/forms/NewAssetForm.tsx',
    'utf8',
  )
  const route = readFileSync('src/app/api/registration/read/route.ts', 'utf8')
  const truckActions = readFileSync('src/app/(app)/trucks/actions.ts', 'utf8')
  const trailerActions = readFileSync(
    'src/app/(app)/trailers/actions.ts',
    'utf8',
  )

  it('the read route reads and never writes', () => {
    expect(route).toContain('readRegistration(')
    expect(route).not.toMatch(/withCurrentOrg\(|\.create\(|\.update\(/)
    expect(route).toContain(
      "!can(session, 'create', 'truck') && !can(session, 'create', 'trailer')",
    )
  })

  it('the form posts the registration flag only while a document is held', () => {
    const at = formSource.indexOf(
      '<input type="hidden" name="registration" value="yes" />',
    )
    expect(at).toBeGreaterThan(-1)
    expect(formSource.lastIndexOf('{held ? (', at)).toBeGreaterThan(-1)
    expect(formSource).toContain("fetch('/api/registration/read'")
  })

  it('the file goes on the registration item, as a REGISTRATION document', () => {
    expect(formSource).toContain("entity: 'complianceItem',")
    expect(formSource).toContain('entityId: created.registrationId,')
    expect(formSource).toContain("documentType: 'REGISTRATION',")
  })

  it('both units save through the one writer, with the registration', () => {
    expect(truckActions).toContain(
      "saveNewAsset('truck', read(formData), formData, t)",
    )
    expect(trailerActions).toContain(
      "saveNewAsset('trailer', read(formData), formData, t)",
    )
    for (const actions of [truckActions, trailerActions])
      expect(actions).toContain('if (outcome.registrationId) {')
  })

  it('says it in both languages', () => {
    const en = translator('en')
    const ru = translator('ru')
    expect(en('fleet.registration.dropTitle')).toBe(
      'Drop the registration (cab card) or photo',
    )
    for (const key of [
      'fleet.registration.dropTitle',
      'fleet.registration.byHand',
      'fleet.registration.noExpiry',
      'fleet.registration.notAllowed',
      'fleet.vinMismatch',
    ] as const) {
      expect(ru(key)).toEqual(expect.stringMatching(/\S/))
      expect(ru(key)).not.toBe(en(key))
    }
  })
})
