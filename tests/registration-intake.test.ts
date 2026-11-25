import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ExtractedRegistration } from '@/lib/extraction/registration-shape'
import { judgeRegistration } from '@/lib/extraction/registration-fields'
import {
  addFormFor,
  matchRegistrationUnit,
  readUnitKey,
  unitKey,
  type RegistrationUnitCandidate,
} from '@/lib/registration-match'
import { READABLE_COMPLIANCE_DOCUMENTS } from '@/app/(app)/safety/compliance-documents'
import { heldCardHref } from '@/lib/held-card'
import { translator } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// A CAB CARD ON THE SAFETY INTAKE (TMS §7.8, v11.57; owner's ruling
// 2026-11-25): the fourth readable document; the truck matched by VIN, then
// unit number, then plate, and confirmed; File is Add truck's own filing; no
// match hands the card, read once, to Add truck.
// ---------------------------------------------------------------------------

const GOOD_VIN = '1M8GDM9AXKP042788'
const OTHER_VIN = '4V4NC9EJ3LN222109'
const UPLOADED = '2026-11-25'

const high = (value: string) => ({ value, confidence: 'high' as const })
const card = (
  over: Partial<ExtractedRegistration> = {},
): ExtractedRegistration => ({
  vin: high(GOOD_VIN),
  plate: high('P 1297245'),
  plateState: high('IL'),
  expiresAt: high('03/31/27'),
  year: high('2020'),
  make: high('VOLV'),
  model: null,
  ownerName: high('EASY EQUIPMENT LEASING LLC'),
  gvwr: high('80,000'),
  unitNumber: high('524'),
  issuedAt: high('03/31/26'),
  fuel: high('D'),
  vehicleType: high('TT'),
  lessorName: null,
  ...over,
})

const truck = (
  id: string,
  over: Partial<RegistrationUnitCandidate> = {},
): RegistrationUnitCandidate => ({
  kind: 'truck',
  id,
  unitNumber: id,
  vin: null,
  plate: null,
  plateState: null,
  ...over,
})

const match = (
  fields: ExtractedRegistration,
  units: RegistrationUnitCandidate[],
) => matchRegistrationUnit(judgeRegistration(fields, UPLOADED), units)

const trailer = (
  id: string,
  over: Partial<RegistrationUnitCandidate> = {},
): RegistrationUnitCandidate => ({ ...truck(id, over), kind: 'trailer' })

describe('the truck is matched: VIN, then unit number, then plate', () => {
  it('the VIN wins over a unit number that names another truck', () => {
    const result = match(card(), [
      truck('524'),
      truck('101', { vin: GOOD_VIN.toLowerCase() }),
    ])
    expect(result).toMatchObject({
      kind: 'one',
      by: 'vin',
      unit: { id: '101' },
    })
  })

  it('no VIN match: the unit number, trimmed and upper-cased', () => {
    const result = match(card({ unitNumber: high(' 524a ') }), [
      truck('524A', { vin: OTHER_VIN }),
    ])
    expect(result).toMatchObject({ kind: 'one', by: 'unit' })
  })

  it('then the plate, spaces ignored, the state agreeing', () => {
    expect(
      match(card({ unitNumber: null }), [
        truck('7', { plate: 'P1297245', plateState: 'il' }),
      ]),
    ).toMatchObject({ kind: 'one', by: 'plate', unit: { id: '7' } })
    // Same plate, another state: not this truck.
    expect(
      match(card({ unitNumber: null }), [
        truck('7', { plate: 'P1297245', plateState: 'IN' }),
      ]),
    ).toEqual({ kind: 'none' })
  })

  it('two trucks on one rule propose none, and a lower rule does not break the tie', () => {
    const result = match(card(), [
      truck('524', { vin: null, plate: 'P1297245', plateState: 'IL' }),
      truck('524 ', { vin: null }),
    ])
    expect(result).toMatchObject({ kind: 'several', by: 'unit' })
  })

  it('an unreadable VIN is never matched on; nothing found is none', () => {
    expect(
      match(
        card({ vin: high('1M8GDM9AYKP042788'), unitNumber: null, plate: null }),
        [truck('1', { vin: '1M8GDM9AYKP042788' })],
      ),
    ).toEqual({ kind: 'none' })
  })
})

describe('trucks and trailers together (v11.58)', () => {
  it('a trailer matched by VIN is proposed as the trailer', () => {
    expect(
      match(card(), [truck('524'), trailer('5301', { vin: GOOD_VIN })]),
    ).toMatchObject({
      kind: 'one',
      by: 'vin',
      unit: { kind: 'trailer', id: '5301' },
    })
  })

  it('truck 524 and trailer 524 tie on the unit rule and propose none', () => {
    const result = match(card({ plate: null }), [truck('524'), trailer('524')])
    expect(result).toMatchObject({ kind: 'several', by: 'unit' })
  })

  it('the select posts kind and id, and reads back only those two kinds', () => {
    expect(unitKey({ kind: 'trailer', id: 'c1' })).toBe('trailer:c1')
    expect(readUnitKey('trailer:c1')).toEqual({ kind: 'trailer', id: 'c1' })
    expect(readUnitKey('truck:c2')).toEqual({ kind: 'truck', id: 'c2' })
    expect(readUnitKey('driver:c3')).toBeNull()
    expect(readUnitKey('')).toBeNull()
  })

  it('the card type picks the Add form; TT stays a truck (the Illinois tractor)', () => {
    const form = (type: string | null) =>
      addFormFor(
        judgeRegistration(
          card({ vehicleType: type ? high(type) : null }),
          UPLOADED,
        ),
      )
    for (const code of ['SE', 'ST', 'TRL', 'Semi', 'TRAILER', 'S.E.'])
      expect(form(code)).toBe('trailer')
    for (const code of ['TT', 'TK', 'TR', 'XX'])
      expect(form(code)).toBe('truck')
    expect(form(null)).toBe('truck')
  })
})

describe('the fourth readable document', () => {
  it('is a row the classifier is offered, read by the intake route', () => {
    expect(
      READABLE_COMPLIANCE_DOCUMENTS.map((row) => row.documentType),
    ).toEqual([
      'MEDICAL_CARD',
      'INSURANCE_CERT',
      'INSPECTION_REPORT',
      'REGISTRATION',
    ])
    const row = READABLE_COMPLIANCE_DOCUMENTS.find(
      (r) => r.documentType === 'REGISTRATION',
    )!
    expect(row).toMatchObject({
      type: 'REGISTRATION',
      route: '/api/compliance/read',
      nameKey: 'safety.registration.name',
    })
    expect(row.looksLike).toMatch(/cab card/i)
    expect(translator('en')(row.nameKey)).toBe('Registration (cab card)')
  })

  it('the route reads it, matches the truck, and never writes', () => {
    const route = readFileSync('src/app/api/compliance/read/route.ts', 'utf8')
    const branch = route.slice(
      route.indexOf("if (documentType === 'REGISTRATION') {"),
      route.indexOf('// MEDICAL_CARD'),
    )
    expect(branch).toContain(
      'readRegistration({ base64, mimeType: file.type })',
    )
    expect(branch).toContain('matchRegistrationUnit(outcome.verdicts, units)')
    expect(branch).toContain('tx.trailer.findMany(')
    // Read AND handed to the matcher, as trailers.
    expect(branch).toContain(
      "...trailers.map((row) => ({ kind: 'trailer' as const, ...row })),",
    )
    expect(branch).toContain('addForm: addFormFor(outcome.verdicts)')
    expect(branch).not.toMatch(/\.create\(|\.update\(|withCurrentOrg\('create'/)
  })
})

describe('File is Add truck’s filing, on the confirmed truck', () => {
  const confirm = readFileSync(
    'src/app/(app)/safety/RegistrationConfirm.tsx',
    'utf8',
  )
  const action = readFileSync(
    'src/app/(app)/safety/registration-actions.ts',
    'utf8',
  )
  const newAsset = readFileSync('src/lib/new-asset.ts', 'utf8')

  it('one filing function, called by both', () => {
    expect(action).toContain('fileRegistration(tx, unit.kind, unit.id, filing)')
    expect(action).toContain('readUnitKey(typed.unit)')
    expect(action).toContain('readRegistrationFiling(formData)')
    expect(newAsset).toContain(
      'const renewal = await fileRegistration(tx, kind, unit.id, filing)',
    )
  })

  it('the form posts the filing the reader expects, and the file goes on the item', () => {
    expect(confirm).toContain(
      '<input type="hidden" name="registration" value="yes" />',
    )
    expect(confirm).toContain('name="registrationExpiresAt"')
    expect(confirm).toContain("documentType: 'REGISTRATION',")
    expect(confirm).toContain('entityId: state.createdId,')
  })

  it('no match offers the Add form the card asks for, with the card handed over', () => {
    expect(confirm).toContain("match.kind === 'none' ? (")
    expect(confirm).toContain('{labels.addIt[addForm]}')
    expect(confirm).toContain('await holdCard(file, { verdicts, prefill })')
    expect(confirm).toContain('router.push(heldCardHref(addForm))')
    expect(heldCardHref('truck')).toBe('/trucks/new?card=held')
    expect(heldCardHref('trailer')).toBe('/trailers/new?card=held')
    const form = readFileSync('src/components/forms/NewAssetForm.tsx', 'utf8')
    expect(form).toContain(
      'if (query.get(HELD_CARD_PARAM) !== HELD_CARD_VALUE) return',
    )
    expect(form).toContain('takeHeldCard<ReadingView>()')
  })

  it('says it in both languages', () => {
    const en = translator('en')
    const ru = translator('ru')
    expect(en('safety.registration.addTrailer')).toBe(
      'No truck or trailer with this VIN — add the trailer',
    )
    for (const key of [
      'safety.registration.name',
      'safety.registration.addTruck',
      'safety.registration.addTrailer',
      'safety.registration.unit',
      'safety.registration.kind.trailer',
      'safety.registration.noUnit',
      'safety.registration.matchedByVin',
      'safety.registration.several',
      'safety.registration.unreadable',
      'safety.registration.filed',
    ] as const) {
      expect(ru(key)).toEqual(expect.stringMatching(/\S/))
      expect(ru(key)).not.toBe(en(key))
    }
  })
})
