import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ExtractedRegistration } from '@/lib/extraction/registration-shape'
import { judgeRegistration } from '@/lib/extraction/registration-fields'
import {
  matchRegistrationTruck,
  type RegistrationTruckCandidate,
} from '@/lib/registration-match'
import { READABLE_COMPLIANCE_DOCUMENTS } from '@/app/(app)/safety/compliance-documents'
import { HELD_CARD_HREF } from '@/lib/held-card'
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
  over: Partial<RegistrationTruckCandidate> = {},
): RegistrationTruckCandidate => ({
  id,
  unitNumber: id,
  vin: null,
  plate: null,
  plateState: null,
  ...over,
})

const match = (
  fields: ExtractedRegistration,
  trucks: RegistrationTruckCandidate[],
) => matchRegistrationTruck(judgeRegistration(fields, UPLOADED), trucks)

describe('the truck is matched: VIN, then unit number, then plate', () => {
  it('the VIN wins over a unit number that names another truck', () => {
    const result = match(card(), [
      truck('524'),
      truck('101', { vin: GOOD_VIN.toLowerCase() }),
    ])
    expect(result).toMatchObject({
      kind: 'one',
      by: 'vin',
      truck: { id: '101' },
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
    ).toMatchObject({ kind: 'one', by: 'plate', truck: { id: '7' } })
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
    expect(branch).toContain('matchRegistrationTruck(outcome.verdicts, trucks)')
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
    expect(action).toContain("fileRegistration(tx, 'truck', truckId, filing)")
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

  it('no match offers Add truck, with the card handed over', () => {
    expect(confirm).toContain("match.kind === 'none' ? (")
    expect(confirm).toContain('{labels.noTruck}')
    expect(confirm).toContain('await holdCard(file, { verdicts, prefill })')
    expect(confirm).toContain('router.push(HELD_CARD_HREF)')
    expect(HELD_CARD_HREF).toBe('/trucks/new?card=held')
    const form = readFileSync('src/components/forms/NewAssetForm.tsx', 'utf8')
    expect(form).toContain(
      'if (query.get(HELD_CARD_PARAM) !== HELD_CARD_VALUE) return',
    )
    expect(form).toContain('takeHeldCard<ReadingView>()')
  })

  it('says it in both languages', () => {
    const en = translator('en')
    const ru = translator('ru')
    expect(en('safety.registration.noTruck')).toBe(
      'No truck with this VIN — add it',
    )
    for (const key of [
      'safety.registration.name',
      'safety.registration.noTruck',
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
