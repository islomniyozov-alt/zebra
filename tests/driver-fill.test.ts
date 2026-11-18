import { describe, expect, it } from 'vitest'
import { planDriverFill, type CurrentDriver } from '@/lib/datatruck/driver-fill'

// FILL ONLY EMPTY DRIVER FIELDS FROM A FULLER EXPORT (2026-11-18). Every rule
// in driver-fill.ts is a refusal; each is asked here by name.

const driver = (over: Partial<CurrentDriver>): CurrentDriver => ({
  id: 'd1',
  externalId: '3',
  firstName: 'Adzhmal',
  lastName: 'Alimi',
  hireDate: null,
  cdlNumber: null,
  cdlState: null,
  cdlClass: null,
  hasCdlRecord: false,
  hasMedicalRecord: false,
  qualifiable: true,
  ...over,
})

const row = (over: Record<string, string>): Record<string, string> => ({
  'Driver ID': '3',
  'First name': 'Adzhmal',
  'Last name': 'Alimi',
  'Hire date': '',
  'Driver license': '',
  'Driver license state': '',
  'Driver license expiration': '',
  ...over,
})

describe('planDriverFill', () => {
  it('fills empty fields from the export, normalised, and creates a missing record', () => {
    const plan = planDriverFill(
      [
        row({
          'Hire date': 'Sep 15, 2025',
          'Driver license': ' A123 ',
          'Driver license state': 'Illinois',
          'Driver license expiration': 'Jul 11, 2028',
          'CDL class': 'a',
          'Medical card expiration': 'Mar 01, 2027',
        }),
      ],
      [driver({})],
    )
    expect(plan.fills.map((f) => [f.field, f.value])).toEqual([
      ['hireDate', '2025-09-15'],
      ['cdlNumber', 'A123'],
      ['cdlState', 'IL'],
      ['cdlClass', 'A'],
    ])
    expect(plan.records.map((r) => [r.field, r.expiresAt])).toEqual([
      ['cdlExpiresAt', '2028-07-11'],
      ['medicalExpiresAt', '2027-03-01'],
    ])
  })

  it('NEVER overwrites: a held value that differs is KEPT and listed, one that agrees is silent', () => {
    const plan = planDriverFill(
      [row({ 'Driver license': 'EXPORT-9', 'Driver license state': 'tx' })],
      [driver({ cdlNumber: 'MAIN-1', cdlState: 'TX' })],
    )
    expect(plan.fills).toEqual([])
    expect(plan.kept).toEqual([
      {
        who: 'Adzhmal Alimi',
        field: 'cdlNumber',
        current: 'MAIN-1',
        exported: 'EXPORT-9',
      },
    ])
  })

  it('a different person under the same Driver ID is HELD by both names, and nothing fills', () => {
    const plan = planDriverFill(
      [row({ 'First name': 'Someone', 'Driver license': 'X1' })],
      [driver({})],
    )
    expect(plan.fills).toEqual([])
    expect(plan.heldByName).toEqual([
      { externalId: '3', exported: 'Someone Alimi', current: 'Adzhmal Alimi' },
    ])
  })

  it('names the columns this export lacks, so "nothing to fill" and "never looked" differ', () => {
    const plan = planDriverFill([row({})], [driver({})])
    const absent = plan.columns
      .filter((c) => c.header === null)
      .map((c) => c.field)
    expect(absent).toEqual(['cdlClass', 'medicalExpiresAt'])
  })

  it('no record for a driver who already has one, or who is not qualifiable', () => {
    const records = [row({ 'Driver license expiration': 'Jul 11, 2028' })]
    expect(
      planDriverFill(records, [driver({ hasCdlRecord: true })]).records,
    ).toEqual([])
    expect(
      planDriverFill(records, [driver({ qualifiable: false })]).records,
    ).toEqual([])
  })

  it('an unreadable value is named, not dropped silently, and an unknown id is listed', () => {
    const plan = planDriverFill(
      [
        row({ 'Hire date': '15/09/2025' }),
        row({ 'Driver ID': '999', 'First name': 'Nobody' }),
      ],
      [driver({})],
    )
    expect(plan.unreadable.map((u) => [u.field, u.raw])).toEqual([
      ['hireDate', '15/09/2025'],
    ])
    expect(plan.unmatched).toEqual([{ externalId: '999', who: 'Nobody Alimi' }])
    expect(plan.fills).toEqual([])
  })
})
