import { describe, expect, it } from 'vitest'
import { planTrucks } from '@/lib/datatruck/trucks'
import { asRecords, parseSharedStrings, parseSheet } from '@/lib/datatruck/xlsx'

// ---------------------------------------------------------------------------
// THE DATATRUCK TRUCK IMPORT, INCLUDING EVERY WAY IT REFUSES.
//
// BOTH BRANCHES OF EVERY GUARD ARE EXERCISED HERE, which is the standing rule:
// a guard nobody has watched fail is not known to work. So each refusal has a
// row that trips it AND a neighbouring row that does not, because a check that
// rejects everything passes a test suite that only ever feeds it bad input.
//
// The fixtures are the real export's own values — `1Q2W3E4R`, `FREGHITLAINR`,
// `TEXAS`, `NAN`, `3AKJHHDROMSMC1119` — not invented ones. The corpus is
// gitignored, so this suite carries the shapes rather than the file, and a
// clean checkout runs it.
// ---------------------------------------------------------------------------

/** One export row, with only the columns under test spelled out. */
const row = (over: Record<string, string>): Record<string, string> => ({
  'Unit number': '1001',
  'MC number': 'RAM Haulage LLC',
  Vin: '3AKJHHDR7MSMR8235',
  Make: 'FRHT',
  Model: 'Cascadia',
  Year: '2021',
  'Plate number': 'DF671G',
  State: 'IL',
  ...over,
})

const only = (over: Record<string, string>) => planTrucks([row(over)])

describe('which authority a truck files under', () => {
  it('maps the two spellings the export actually uses', () => {
    const plan = planTrucks([
      row({ 'MC number': 'RAM Haulage LLC' }),
      row({ 'MC number': 'Dolphin Transport inc', 'Unit number': '1002' }),
    ])
    expect(plan.planned.map((t) => t.authority)).toEqual([
      'RAM Haulage',
      'Dolphins Transport',
    ])
    expect(plan.held).toEqual([])
  })

  it('holds a retired authority, a blank one, and an unknown one apart', () => {
    const plan = planTrucks([
      row({ 'MC number': 'Midwest Global Logistics LLC', 'Unit number': '1' }),
      row({ 'MC number': '', 'Unit number': '2' }),
      row({ 'MC number': 'Someone Else LLC', 'Unit number': '3' }),
    ])
    expect(plan.planned).toEqual([])
    expect(plan.held.map((h) => h.reason)).toEqual([
      'filed under Midwest Global Logistics LLC, which this system does not operate under',
      'no authority in the export',
      'unrecognised authority "Someone Else LLC"',
    ])
  })

  it('never guesses at a near-miss spelling', () => {
    // The whole point of the stated table. "Dolphins Transport Inc" is what
    // this system calls the carrier and it is NOT what the export says, so a
    // matcher loose enough to accept it here is loose enough to file a load
    // under the wrong carrier somewhere else.
    expect(only({ 'MC number': 'Dolphins Transport Inc' }).held).toHaveLength(1)
  })
})

describe('a VIN, or nothing at all', () => {
  it('keeps a real one', () => {
    expect(only({ Vin: '3AKJHHDR7MSMR8235' }).planned[0]!.vin).toBe(
      '3AKJHHDR7MSMR8235',
    )
  })

  it('drops the keyboard walks somebody typed past a required field', () => {
    for (const walk of ['1', '1B2A3D', '1W2E3R4T', '1Q2W3E4R']) {
      const truck = only({ Vin: walk }).planned[0]!
      expect(truck.vin).toBeNull()
      expect(truck.corrections.join()).toContain('a VIN is 17')
    }
  })

  it('drops a 17-character string containing a letter the standard excludes', () => {
    // Three rows in the real export carry an O where a zero belongs. Correct
    // length, wrong alphabet — the length check alone lets all three through.
    const truck = only({ Vin: '3AKJHHDROMSMC1119' }).planned[0]!
    expect(truck.vin).toBeNull()
    expect(truck.corrections.join()).toContain('contains O')
  })

  it('does not reject the digits O and Q resemble', () => {
    // The guard fires on I, O, Q. If it fired on 0 or 1 it would reject most
    // of the fleet, and every test above would still pass.
    const truck = only({ Vin: '1FUJHHDR0NLMZ7022' }).planned[0]!
    expect(truck.vin).toBe('1FUJHHDR0NLMZ7022')
    expect(truck.corrections.join()).not.toContain('contains')
  })
})

describe('the plate state, which stateCode would get wrong', () => {
  it('resolves the spelled-out names in the export', () => {
    expect(only({ State: 'ILLINOIS' }).planned[0]!.plateState).toBe('IL')
    expect(only({ State: 'Illinois' }).planned[0]!.plateState).toBe('IL')
    expect(only({ State: 'Alabama' }).planned[0]!.plateState).toBe('AL')
  })

  it('resolves TEXAS to TX rather than truncating it to TE', () => {
    // THE REASON THIS TABLE EXISTS. `stateCode` truncates to two characters,
    // which is right on a stop and silently wrong here: a plate registered in
    // "TE" is a registration lookup that will never find anything.
    expect(only({ State: 'TEXAS' }).planned[0]!.plateState).toBe('TX')
  })

  it('drops a name it was not told about instead of shortening it', () => {
    // `Ontario` rather than `Wisconsin` since 2026-09-09 — the table grew to
    // all fifty states for the load import, so Wisconsin resolves now. A
    // province is a name this table will never hold, which is what the
    // assertion needs.
    const truck = only({ State: 'Ontario' }).planned[0]!
    expect(truck.plateState).toBeNull()
    expect(truck.corrections.join()).toContain('not in the stated name table')
  })

  it('passes a two-letter code through untouched', () => {
    expect(only({ State: 'ny' }).planned[0]!.plateState).toBe('NY')
  })
})

describe('placeholders, which are not values', () => {
  it('reads NAN on a plate as no plate', () => {
    expect(only({ 'Plate number': 'NAN' }).planned[0]!.plate).toBeNull()
  })

  it('reads the string "null" and "Not specified" as no model', () => {
    expect(only({ Model: 'null' }).planned[0]!.model).toBeNull()
    expect(only({ Model: 'Not specified' }).planned[0]!.model).toBeNull()
  })

  it('still keeps a real plate that merely looks odd', () => {
    // `SPG942660 IL TEMP` is a temporary tag as the export holds it. Ugly,
    // and the only record of that truck's registration — carried verbatim,
    // because splitting it into parts is parsing this seed did not measure.
    expect(
      only({ 'Plate number': 'SPG942660 IL TEMP' }).planned[0]!.plate,
    ).toBe('SPG942660 IL TEMP')
  })

  it('keeps a unit number the placeholder rule would otherwise eat', () => {
    // "0" and "NA" are in the placeholder list. The key does not go through
    // it, because a unit number is whatever is painted on the door.
    expect(only({ 'Unit number': '0' }).planned[0]!.unitNumber).toBe('0')
    expect(only({ 'Unit number': ' 03. ' }).planned[0]!.unitNumber).toBe('03.')
  })

  it('holds a row with no unit number at all', () => {
    expect(only({ 'Unit number': '   ' }).held[0]!.reason).toContain(
      'no unit number',
    )
  })
})

describe('the make table', () => {
  it('spells out the abbreviations', () => {
    expect(only({ Make: 'FRHT' }).planned[0]!.make).toBe('Freightliner')
    expect(only({ Make: 'VOLV' }).planned[0]!.make).toBe('Volvo')
    expect(only({ Make: 'PTRB' }).planned[0]!.make).toBe('Peterbilt')
  })

  it('maps the one typo by name, and says it did', () => {
    const truck = only({ Make: 'FREGHITLAINR' }).planned[0]!
    expect(truck.make).toBe('Freightliner')
    expect(truck.corrections.join()).toContain('"FREGHITLAINR" -> Freightliner')
  })

  it('carries an unknown make verbatim and flags it for reading', () => {
    const truck = only({ Make: 'KENWORTH' }).planned[0]!
    expect(truck.make).toBe('KENWORTH')
    expect(truck.corrections.join()).toContain('carried verbatim')
  })
})

describe('the year', () => {
  it('keeps a plausible one and drops an implausible one', () => {
    expect(only({ Year: '2000' }).planned[0]!.year).toBe(2000)
    expect(only({ Year: '1899' }).planned[0]!.year).toBeNull()
    expect(only({ Year: 'twenty twenty' }).planned[0]!.year).toBeNull()
  })
})

describe('two trucks claiming one unit number', () => {
  it('holds the second rather than letting the database refuse it', () => {
    const plan = planTrucks([row({}), row({ Vin: '3AKJHHDR8LSLU2283' })])
    expect(plan.planned).toHaveLength(1)
    expect(plan.held[0]!.reason).toContain('already used under RAM Haulage')
  })

  it('allows the same unit number under a different authority', () => {
    // Trucks are unique per company, not per organization — the partial index
    // is on (companyId, unitNumber). Two authorities may each run a unit 1001.
    const plan = planTrucks([
      row({}),
      row({ 'MC number': 'Dolphin Transport inc' }),
    ])
    expect(plan.planned).toHaveLength(2)
    expect(plan.held).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// THE READER ITSELF — the two parsing steps, which are pure and fiddly.
//
// The zip half is exercised against the real export by running the seed in
// preview; these cover the part where a mistake is silent rather than loud.
// ---------------------------------------------------------------------------

describe('reading the sheet XML', () => {
  const shared = parseSharedStrings(
    '<sst><si><t>Unit number</t></si><si><t>Vin</t></si>' +
      '<si><t>R&amp;M</t></si><si><r><t>split </t></r><r><t>run</t></r></si></sst>',
  )

  it('joins the runs of a shared string and unescapes it', () => {
    expect(shared).toEqual(['Unit number', 'Vin', 'R&M', 'split run'])
  })

  it('places cells by their reference, so a gap does not shift a row left', () => {
    // THE BUG THIS PREVENTS. A sheet omits empty cells entirely, so this row
    // has A and C and no B. Appending in document order would put the VIN in
    // the unit-number column of every row with a blank in it.
    const rows = parseSheet(
      '<sheetData>' +
        '<row><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '</sheetData>',
      shared,
    )
    expect(rows).toEqual([['Unit number', '', 'Vin']])
  })

  it('reads inline strings and bare numbers', () => {
    const rows = parseSheet(
      '<sheetData><row>' +
        '<c r="A1" t="inlineStr"><is><t>08</t></is></c>' +
        '<c r="B1"><v>2021</v></c>' +
        '</row></sheetData>',
      shared,
    )
    expect(rows).toEqual([['08', '2021']])
  })

  it('keys records by the header row and tolerates a short row', () => {
    expect(asRecords([['Unit number', 'Vin'], ['08']])).toEqual([
      { 'Unit number': '08', Vin: '' },
    ])
  })
})
