import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANNUAL_INSPECTION_FIELDS,
  ANNUAL_INSPECTION_SCHEMA,
  INSPECTION_FORBIDDEN_FIELDS,
} from '@/lib/extraction/inspection-shape'
import { ANNUAL_INSPECTION_SYSTEM } from '@/lib/extraction/inspection-prompt'
import { parseAnnualInspectionResponse } from '@/lib/extraction/inspection-parse'
import {
  inspectionExpiry,
  judgeInspection,
  readResult,
} from '@/lib/extraction/inspection-fields'
import type { ExtractedAnnualInspection } from '@/lib/extraction/inspection-shape'
import { READABLE_COMPLIANCE_DOCUMENTS } from '@/app/(app)/safety/compliance-documents'

// ---------------------------------------------------------------------------
// THE ANNUAL DOT INSPECTION READER (TMS §7.8, v11.47; owner's ruling
// 2026-11-23): header fields only, each read or unreadable, never a guess.
// ---------------------------------------------------------------------------

const askModel = vi.fn()
vi.mock('@/lib/model-engine', () => ({
  askModel: (...a: unknown[]) => askModel(...a),
}))

const UPLOADED = '2026-11-23'

/** The sample as a careful reader would return it: three legible, four not. */
const SAMPLE: ExtractedAnnualInspection = {
  reportNumber: { value: '160526036', confidence: 'high' },
  inspectionDate: { value: '02/18/2026', confidence: 'high' },
  fleetUnit: { value: '4974', confidence: 'high' },
  vin: null,
  inspectorName: null,
  agency: null,
  result: null,
}

describe('header only, and that is asserted', () => {
  it('the schema, the type and the order are the same seven fields', () => {
    expect(ANNUAL_INSPECTION_FIELDS).toEqual([
      'reportNumber',
      'inspectionDate',
      'fleetUnit',
      'vin',
      'inspectorName',
      'agency',
      'result',
    ])
    expect(ANNUAL_INSPECTION_SCHEMA.required).toEqual(ANNUAL_INSPECTION_FIELDS)
    expect(ANNUAL_INSPECTION_SCHEMA.additionalProperties).toBe(false)
  })

  it('no checklist field anywhere — schema, type file or prompt field list', () => {
    const shape = readFileSync(
      join('src', 'lib', 'extraction', 'inspection-shape.ts'),
      'utf8',
    )
    const typeBlock = shape.slice(
      shape.indexOf('export interface ExtractedAnnualInspection'),
      shape.indexOf('const field ='),
    )
    for (const name of INSPECTION_FORBIDDEN_FIELDS) {
      expect(Object.keys(ANNUAL_INSPECTION_SCHEMA.properties)).not.toContain(
        name,
      )
      expect(typeBlock).not.toMatch(new RegExp(`\\b${name}\\??:`))
    }
    const fieldList = ANNUAL_INSPECTION_SYSTEM.slice(
      ANNUAL_INSPECTION_SYSTEM.indexOf('RETURN EXACTLY'),
      ANNUAL_INSPECTION_SYSTEM.indexOf('A FIELD YOU CANNOT READ'),
    )
    for (const name of ANNUAL_INSPECTION_FIELDS)
      expect(fieldList).toContain(name)
  })

  it('the prompt says null over a guess, and refuses the checklist by name', () => {
    expect(ANNUAL_INSPECTION_SYSTEM).toContain(
      'A FIELD YOU CANNOT READ IS NULL',
    )
    expect(ANNUAL_INSPECTION_SYSTEM).toContain(
      'DO NOT RETURN THE INSPECTION CHECKLIST',
    )
    expect(ANNUAL_INSPECTION_SYSTEM).toContain('DO NOT CONVERT THEM')
  })
})

describe('each field read or unreadable', () => {
  it('the sample: three read, four unreadable, nothing guessed', () => {
    const v = judgeInspection(SAMPLE, UPLOADED)
    expect(v.reportNumber).toMatchObject({ read: true, value: '160526036' })
    expect(v.inspectionDate).toMatchObject({ read: true, value: '2026-02-18' })
    expect(v.fleetUnit).toMatchObject({ read: true, value: '4974' })
    for (const key of ['vin', 'inspectorName', 'agency', 'result'] as const) {
      expect(v[key]).toEqual({ read: false, why: 'not_shown', printed: null })
    }
  })

  it('low confidence is unreadable, and keeps what was seen', () => {
    const v = judgeInspection(
      { ...SAMPLE, reportNumber: { value: '16O526036', confidence: 'low' } },
      UPLOADED,
    )
    expect(v.reportNumber).toEqual({
      read: false,
      why: 'low_confidence',
      printed: '16O526036',
    })
  })

  it('one unreadable field does not discard the others', () => {
    const v = judgeInspection(
      { ...SAMPLE, inspectionDate: { value: '18 Feb', confidence: 'high' } },
      UPLOADED,
    )
    expect(v.inspectionDate).toMatchObject({ read: false, why: 'not_a_date' })
    expect(v.reportNumber.read).toBe(true)
    expect(v.fleetUnit.read).toBe(true)
  })

  it('an inspection dated after the upload is unreadable', () => {
    const v = judgeInspection(
      {
        ...SAMPLE,
        inspectionDate: { value: '02/18/2027', confidence: 'high' },
      },
      UPLOADED,
    )
    expect(v.inspectionDate).toMatchObject({ read: false, why: 'after_upload' })
  })

  it('a VIN that fails its check is unreadable, never corrected', () => {
    // The sample's VIN with its cut-off first character guessed as "1".
    const v = judgeInspection(
      { ...SAMPLE, vin: { value: '1JGLDR96S8P4974', confidence: 'high' } },
      UPLOADED,
    )
    expect(v.vin).toEqual({
      read: false,
      why: 'vin_invalid',
      printed: '1JGLDR96S8P4974',
    })
    const good = judgeInspection(
      { ...SAMPLE, vin: { value: '1HGCM82633A004352', confidence: 'medium' } },
      UPLOADED,
    )
    expect(good.vin).toMatchObject({ read: true, value: '1HGCM82633A004352' })
  })

  it('a result is passed or failed only in so many words', () => {
    expect(
      readResult('THIS VEHICLE HAS PASSED ALL THE INSPECTION ITEMS'),
    ).toEqual({
      ok: true,
      value: 'passed',
    })
    expect(readResult('Failed')).toEqual({ ok: true, value: 'failed' })
    expect(readResult('☑')).toEqual({ ok: false, why: 'not_pass_fail' })
    expect(readResult('passed / failed')).toEqual({
      ok: false,
      why: 'not_pass_fail',
    })
  })
})

describe('the expiry is derived, never read', () => {
  it('is the same day twelve months on (49 CFR 396.17)', () => {
    expect(inspectionExpiry('2026-02-18')).toBe('2027-02-18')
    expect(inspectionExpiry('2028-02-29')).toBe('2029-02-28')
  })
})

describe('the parser', () => {
  it('reads the envelope, and a non-object is refused', () => {
    const fields = parseAnnualInspectionResponse(
      JSON.stringify({
        reportNumber: { value: '160526036', confidence: 'high' },
        inspectionDate: null,
        fleetUnit: null,
        vin: null,
        inspectorName: null,
        agency: null,
        result: null,
      }),
    )
    expect(fields.reportNumber).toEqual({
      value: '160526036',
      confidence: 'high',
    })
    expect(fields.vin).toBeNull()
    expect(() => parseAnnualInspectionResponse('[]')).toThrow()
  })
})

describe('the reader', () => {
  beforeEach(() => askModel.mockReset())
  const base64 = 'A'.repeat(8_000)
  const answer = (text: string) => ({
    text,
    model: 'gemini-test',
    usage: { inputTokens: 100, outputTokens: 50 },
  })

  it('a failed call is refused as call_failed, never as a blank reading', async () => {
    const { readAnnualInspection } = await import('@/lib/annual-inspection')
    askModel.mockRejectedValueOnce(new Error('down'))
    expect(
      await readAnnualInspection({ base64, mimeType: 'image/jpeg' }),
    ).toEqual({
      ok: false,
      reason: 'call_failed',
      cost: null,
    })
  })

  it('a substantial photo that yields nothing is read_nothing', async () => {
    const { readAnnualInspection } = await import('@/lib/annual-inspection')
    const nulls = Object.fromEntries(
      ANNUAL_INSPECTION_FIELDS.map((k) => [k, null]),
    )
    askModel.mockResolvedValueOnce(answer(JSON.stringify(nulls)))
    const out = await readAnnualInspection({ base64, mimeType: 'image/jpeg' })
    expect(out).toMatchObject({ ok: false, reason: 'read_nothing' })
  })

  it('a partial reading is kept, with the unreadable fields marked', async () => {
    const { readAnnualInspection } = await import('@/lib/annual-inspection')
    askModel.mockResolvedValueOnce(answer(JSON.stringify(SAMPLE)))
    const out = await readAnnualInspection({
      base64,
      mimeType: 'image/jpeg',
      uploadedOn: new Date(`${UPLOADED}T12:00:00Z`),
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.verdicts.fleetUnit).toMatchObject({ read: true, value: '4974' })
    expect(out.verdicts.vin).toMatchObject({ read: false, why: 'not_shown' })
    expect(askModel.mock.calls[0]![0]).toMatchObject({ kind: 'inspection' })
  })
})

describe('the truck is proposed, never chosen', () => {
  const trucks = [
    { id: 't1', unitNumber: '4974', vin: '1HGCM82633A004352' },
    { id: 't2', unitNumber: '497', vin: null },
    { id: 't3', unitNumber: '5010', vin: '1M8GDM9AXKP042788' },
  ]

  it('an exact fleet unit, ignoring case and space — never the nearest', async () => {
    const { matchTruck } = await import('@/lib/annual-inspection')
    const v = judgeInspection(SAMPLE, UPLOADED)
    expect(matchTruck(v, trucks)).toEqual({
      kind: 'one',
      truck: trucks[0],
      by: 'unit',
    })
    const near = judgeInspection(
      { ...SAMPLE, fleetUnit: { value: '49', confidence: 'high' } },
      UPLOADED,
    )
    expect(matchTruck(near, trucks)).toEqual({ kind: 'none' })
  })

  it('falls back to the VIN, and names several rather than picking one', async () => {
    const { matchTruck } = await import('@/lib/annual-inspection')
    const byVin = judgeInspection(
      {
        ...SAMPLE,
        fleetUnit: null,
        vin: { value: '1M8GDM9AXKP042788', confidence: 'high' },
      },
      UPLOADED,
    )
    expect(matchTruck(byVin, trucks)).toEqual({
      kind: 'one',
      truck: trucks[2],
      by: 'vin',
    })
    const twins = [...trucks, { id: 't4', unitNumber: '4974 ', vin: null }]
    expect(matchTruck(judgeInspection(SAMPLE, UPLOADED), twins).kind).toBe(
      'several',
    )
  })
})

describe('the prefill leaves an unreadable field empty', () => {
  it('fills what was read, derives the expiry, and guesses nothing', async () => {
    const { inspectionPrefill } = await import('@/lib/annual-inspection')
    expect(inspectionPrefill(judgeInspection(SAMPLE, UPLOADED))).toEqual({
      issuedAt: '02/18/2026',
      expiresAt: '02/18/2027',
      identifier: '160526036',
      issuer: '',
      notes: '',
    })
  })
})

describe('the intake reads it', () => {
  it('is a readable compliance document, filed as an annual inspection', () => {
    expect(READABLE_COMPLIANCE_DOCUMENTS).toContainEqual(
      expect.objectContaining({
        type: 'ANNUAL_INSPECTION',
        documentType: 'INSPECTION_REPORT',
        route: '/api/compliance/read',
      }),
    )
  })

  it('the route branches on it, and the confirm files through the panel’s form reader', () => {
    const route = readFileSync(
      join('src', 'app', 'api', 'compliance', 'read', 'route.ts'),
      'utf8',
    )
    expect(route).toMatch(/documentType === 'INSPECTION_REPORT'/)
    expect(route).toMatch(/readAnnualInspection\(/)
    const action = readFileSync(
      join('src', 'app', '(app)', 'safety', 'inspection-actions.ts'),
      'utf8',
    )
    expect(action).toMatch(/readRenewalForm\(formData\)/)
    expect(action).toMatch(/recordRenewal\(/)
    const confirm = readFileSync(
      join('src', 'app', '(app)', 'safety', 'InspectionConfirm.tsx'),
      'utf8',
    )
    expect(confirm).toMatch(/labels\.byHand/)
  })
})
