import { describe, expect, it } from 'vitest'
import { cdlFillForMain, mainCdlView, newestCdlRecord } from '@/lib/driver-cdl'

// MAIN'S LICENCE FIELDS FROM THE CDL RECORD (driver-cdl.ts, 2026-11-18). The
// decision is pure; tests/integration/driver-cdl.test.ts holds the read and
// the write against each other on a real row.

const blank = { cdlNumber: null, cdlState: null, cdlClass: null }
const cdl = (
  id: string,
  expires: string,
  identifier: string | null,
  issuer: string | null,
) => ({
  id,
  type: 'CDL',
  identifier,
  issuer,
  expiresAt: new Date(`${expires}T00:00:00Z`),
})

describe('cdlFillForMain', () => {
  it('fills only what Main is missing, normalised as the Main form does', () => {
    expect(
      cdlFillForMain(blank, { number: ' A1 ', state: ' il ', class: 'a' }),
    ).toEqual({
      cdlNumber: 'A1',
      cdlState: 'IL',
      cdlClass: 'A',
    })
  })

  it('never overwrites a value Main holds, and treats an empty string as empty', () => {
    expect(
      cdlFillForMain(
        { cdlNumber: 'MAIN', cdlState: '', cdlClass: 'B' },
        { number: 'REC', state: 'TX', class: 'A' },
      ),
    ).toEqual({ cdlState: 'TX' })
  })

  it('supplies nothing from nothing', () => {
    expect(cdlFillForMain(blank, { number: '  ', state: null })).toEqual({})
  })
})

describe('newestCdlRecord', () => {
  it('is the latest expiry, then the lowest id — the record head’s order — and only CDLs', () => {
    const rows = [
      cdl('b', '2028-01-01', 'OLD', null),
      { ...cdl('z', '2040-01-01', 'MED', null), type: 'MEDICAL_CARD' },
      cdl('d', '2030-01-01', 'NEW-D', null),
      cdl('c', '2030-01-01', 'NEW-C', null),
    ]
    expect(newestCdlRecord(rows)?.identifier).toBe('NEW-C')
    expect(newestCdlRecord([])).toBeNull()
  })
})

describe('mainCdlView', () => {
  it('reads an empty Main field from the newest record and names it', () => {
    const view = mainCdlView({ ...blank, cdlNumber: 'MAIN' }, [
      cdl('a', '2030-01-01', 'REC', 'fl'),
    ])
    expect(view.values).toEqual({
      cdlNumber: 'MAIN',
      cdlState: 'FL',
      cdlClass: null,
    })
    expect(view.fromRecord).toEqual(['cdlState'])
  })

  it('a record never supplies a class — it has no column for one', () => {
    expect(
      mainCdlView(blank, [cdl('a', '2030-01-01', 'N', 'IL')]).values.cdlClass,
    ).toBeNull()
  })

  it('with no record readable (a role without compliance), Main is Main', () => {
    expect(mainCdlView(blank, [])).toEqual({ values: blank, fromRecord: [] })
  })
})
