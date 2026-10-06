import { describe, expect, it } from 'vitest'
import {
  employmentFromColumn,
  employmentFromTariff,
  parseLicenceExpiry,
  parseTariff,
  planDrivers,
} from '@/lib/datatruck/drivers'
import { resolveState } from '@/lib/datatruck/states'

// ---------------------------------------------------------------------------
// WHAT A DRIVER IS PAID, AND WHEN THEIR LICENCE STOPS.
//
// The tariff cases are ALL TWELVE distinct spellings in the real export, by
// count, so this suite fails if a future export introduces a thirteenth shape
// the parser cannot read — rather than that driver being discovered later, in
// a settlement.
// ---------------------------------------------------------------------------

/** Every distinct `Driver tariff` value in the export, with its row count. */
const REAL_TARIFFS: readonly [string, number, number][] = [
  ['3% from gross', 2, 300],
  ['4% from gross', 1, 400],
  ['58 From Gross', 5, 5800],
  ['30% from gross', 3, 3000],
  ['32% from gross', 5, 3200],
  ['38% from gross', 1, 3800],
  ['52% FROM GROSS', 1, 5200],
  ['60% From Gross', 2, 6000],
  ['88% from gross', 4, 8800],
  ['89% from gross', 7, 8900],
  ['90% from gross', 22, 9000],
  ['33 % from gross', 1, 3300],
]

describe('the driver tariff', () => {
  it('reads all 54 rows of the real export', () => {
    let rows = 0
    for (const [raw, count, bps] of REAL_TARIFFS) {
      const result = parseTariff(raw)
      expect(result, raw).toEqual({ ok: true, bps })
      rows += count
    }
    // The counts are here so this is a statement about the WHOLE file rather
    // than about twelve strings that happen to be in it.
    expect(rows).toBe(54)
  })

  it('tolerates a missing percent sign, a stray space, and any case', () => {
    // The three variations the ruling named, isolated from the real values.
    expect(parseTariff('58 From Gross')).toEqual({ ok: true, bps: 5800 })
    expect(parseTariff('33 % from gross')).toEqual({ ok: true, bps: 3300 })
    expect(parseTariff('  52% FROM GROSS  ')).toEqual({ ok: true, bps: 5200 })
  })

  it('keeps the three genuinely small percentages rather than rescuing them', () => {
    // 3% and 4% are real rows. They look like typos for 30% and 40% and they
    // are NOT corrected — the report names them so a human decides. A parser
    // that "fixed" these would be inventing wages.
    expect(parseTariff('3% from gross')).toEqual({ ok: true, bps: 300 })
    expect(parseTariff('4% from gross')).toEqual({ ok: true, bps: 400 })
  })

  it('refuses rather than defaulting, and says why', () => {
    for (const raw of [
      '',
      '   ',
      'from gross',
      'flat rate',
      '90%',
      'ask Daler',
    ]) {
      const result = parseTariff(raw)
      expect(result.ok, raw).toBe(false)
      if (!result.ok) expect(result.why).not.toBe('')
    }
  })

  it('refuses a percentage outside 0 to 100', () => {
    // Neither is in the export. Both are one keystroke away from one that is.
    expect(parseTariff('0% from gross').ok).toBe(false)
    expect(parseTariff('900% from gross').ok).toBe(false)
  })

  it('refuses the stray keystroke the money parser was written to catch', () => {
    // `3%4` is 34% to a lenient parser — plausible, payable, and wrong. This
    // inherits that refusal by delegating rather than parsing a number itself.
    expect(parseTariff('3%4 from gross').ok).toBe(false)
  })
})

describe('the licence expiry', () => {
  it('reads the stated format the export prints', () => {
    expect(parseLicenceExpiry('Apr 11, 2031')).toEqual({
      ok: true,
      iso: '2031-04-11',
    })
    expect(parseLicenceExpiry('Aug 04, 2028')).toEqual({
      ok: true,
      iso: '2028-08-04',
    })
    expect(parseLicenceExpiry('Jan 01, 2028')).toEqual({
      ok: true,
      iso: '2028-01-01',
    })
  })

  it('gives the same day whatever the machine thinks the time zone is', () => {
    // THE ENTIRE POINT. `new Date('Apr 11, 2031')` is midnight LOCAL, so
    // `.toISOString().slice(0,10)` is the 10th anywhere west of Greenwich.
    // This is text and arithmetic, so there is no zone in it to be wrong.
    const zoneNaive = new Date('Apr 11, 2031').toISOString().slice(0, 10)
    const parsed = parseLicenceExpiry('Apr 11, 2031')
    expect(parsed).toEqual({ ok: true, iso: '2031-04-11' })
    // Documents the trap without asserting the machine is in a given zone:
    // if this ever differs, the naive reading was a day out.
    if (zoneNaive !== '2031-04-11') {
      expect(zoneNaive).not.toBe(parsed.ok ? parsed.iso : '')
    }
  })

  it('refuses a date that does not exist', () => {
    expect(parseLicenceExpiry('Feb 30, 2028').ok).toBe(false)
    expect(parseLicenceExpiry('Apr 31, 2031').ok).toBe(false)
  })

  it('accepts the leap day in a leap year and refuses it otherwise', () => {
    expect(parseLicenceExpiry('Feb 29, 2028')).toEqual({
      ok: true,
      iso: '2028-02-29',
    })
    expect(parseLicenceExpiry('Feb 29, 2027').ok).toBe(false)
  })

  it('refuses any other shape rather than guessing at it', () => {
    for (const raw of [
      '',
      '2031-04-11',
      '04/11/2031',
      'Apr 2031',
      'Xyz 11, 2031',
    ]) {
      expect(parseLicenceExpiry(raw).ok, raw).toBe(false)
    }
  })
})

describe('the state table both exports need', () => {
  it('resolves every spelled-out name the two exports contain', () => {
    const spelled: Readonly<Record<string, string>> = {
      Texas: 'TX',
      Illinois: 'IL',
      ILLINOIS: 'IL',
      Florida: 'FL',
      'New York': 'NY',
      Colorado: 'CO',
      'New Jersey': 'NJ',
      OKLAHOMA: 'OK',
      Ohio: 'OH',
      Alabama: 'AL',
    }
    for (const [name, code] of Object.entries(spelled)) {
      expect(resolveState(name), name).toEqual({
        ok: true,
        code,
        rewritten: true,
      })
    }
  })

  it('passes a two-letter code through and says it did not rewrite it', () => {
    expect(resolveState('wi')).toEqual({
      ok: true,
      code: 'WI',
      rewritten: false,
    })
  })

  it('refuses a name it was not told about instead of truncating it', () => {
    // THE EXAMPLE MOVED FROM `Wisconsin` TO `Ontario` ON 2026-09-09, and the
    // assertion is unchanged. The table used to hold the nine states the fleet
    // ROSTERS mentioned; the load history needed all fifty, so Wisconsin is in
    // it now and stopped being an example of an unknown name.
    //
    // A Canadian province is the better example anyway: it is a real place a
    // truck can be plated in, it will never be in a table of US states, and
    // `stateCode` would happily shorten it to "On".
    expect(resolveState('Ontario')).toEqual({ ok: false, raw: 'Ontario' })
    expect(resolveState('')).toEqual({ ok: false, raw: '' })
  })
})

describe('what a driver IS, derived from what they are paid', () => {
  // THE COLUMN IS A PAYROLL LABEL, NOT THE PAY CLASS. `Driver Type` marks 39
  // rows company_driver and 21 of those are paid 88-90% of gross, which is
  // owner-operator money. The owner confirms the real split — company drivers
  // 28-35%, owner-operators 88-90% — so the percentage is the honest signal
  // and the column is recorded, disagreed with, and left alone.

  it('puts the two real populations on the right side', () => {
    // Every percentage in the export, by band.
    for (const bps of [300, 400, 3000, 3200, 3300, 3800, 5200, 5800, 6000]) {
      expect(employmentFromTariff(bps), String(bps)).toBe('COMPANY_DRIVER')
    }
    for (const bps of [8800, 8900, 9000]) {
      expect(employmentFromTariff(bps), String(bps)).toBe('OWNER_OPERATOR')
    }
  })

  it('draws the line at exactly 85%, inclusive', () => {
    // A STATED THRESHOLD, NOT A CLUSTER FOUND IN THE DATA. 85% sits in the gap
    // between the two populations — nothing in the export is paid 61% to 87% —
    // so the boundary does not move when a new driver arrives at 80% or 92%.
    expect(employmentFromTariff(8499)).toBe('COMPANY_DRIVER')
    expect(employmentFromTariff(8500)).toBe('OWNER_OPERATOR')
    expect(employmentFromTariff(8501)).toBe('OWNER_OPERATOR')
  })

  it('reads the export column onto the same axis, and refuses anything else', () => {
    expect(employmentFromColumn('company_owner')).toBe('OWNER_OPERATOR')
    expect(employmentFromColumn('company_driver')).toBe('COMPANY_DRIVER')
    // null means "the column said something this rule has no opinion about",
    // which the report must treat as no disagreement rather than as a clash.
    for (const raw of ['', '   ', 'contractor', null, undefined]) {
      expect(employmentFromColumn(raw)).toBeNull()
    }
  })

  it('disagrees with the column exactly where the export does', () => {
    // The 24 the seed report names, in miniature: a company_driver paid 90% is
    // an owner-operator, and a company_owner paid 32% is not.
    const rows = [
      { bps: 9000, column: 'company_driver' },
      { bps: 3200, column: 'company_owner' },
      { bps: 3000, column: 'company_driver' },
      { bps: 9000, column: 'company_owner' },
    ]
    const disagreeing = rows.filter(
      (r) => employmentFromColumn(r.column) !== employmentFromTariff(r.bps),
    )
    expect(disagreeing).toEqual([
      { bps: 9000, column: 'company_driver' },
      { bps: 3200, column: 'company_owner' },
    ])
  })

  it('classifies the three dispatch-fee rows as company drivers, not owners', () => {
    // 3%, 3% and 4% are the company's own dispatch or referral fee rather than
    // a person's wage — seeded exactly as printed, per the ruling. They must
    // not fall out on the owner-operator side of a threshold about wages.
    for (const bps of [300, 300, 400]) {
      expect(employmentFromTariff(bps)).toBe('COMPANY_DRIVER')
    }
  })
})

// ---------------------------------------------------------------------------
// DATATRUCK'S OWN TEST DATA, WHICH REACHED PRODUCTION ONCE.
//
// `Sample Driver` (Driver ID 1, AG FREIGHT INC, CDL "1") came in with the
// terminated-driver export and sat on the production driver list until the
// owner spotted it. It has no loads, no settlements and no compliance,
// because it never drove anything.
//
// THE GUARD IS A PAIR, AND BOTH HALVES ARE WATCHED HERE. An id of `1` is
// exactly the sort of value a future export could hand a real person, and a
// name alone would refuse a real driver who happens to be called Sample. Only
// the two together skip a row.
// ---------------------------------------------------------------------------

const driverRow = (
  over: Record<string, string> = {},
): Record<string, string> => ({
  'Driver ID': '77',
  'First name': 'Real',
  'Last name': 'Person',
  'MC number': 'RAM Haulage LLC',
  'Driver tariff': '88% from gross',
  'Contact number': '+19296759693',
  ...over,
})

describe("the export's own test data", () => {
  it('holds Sample Driver by name AND id, with a reason', () => {
    const plan = planDrivers([
      driverRow({
        'Driver ID': '1',
        'First name': 'Sample',
        'Last name': 'Driver',
      }),
    ])
    expect(plan.planned).toEqual([])
    expect(plan.held[0]?.reason).toContain('Datatruck test data')
  })

  it('does NOT hold a real driver who merely carries id 1', () => {
    const plan = planDrivers([driverRow({ 'Driver ID': '1' })])
    expect(plan.planned).toHaveLength(1)
    expect(plan.planned[0]?.firstName).toBe('Real')
  })

  it('does NOT hold a real person who happens to be called Sample', () => {
    const plan = planDrivers([
      driverRow({ 'First name': 'Sample', 'Last name': 'Driver' }),
    ])
    expect(plan.planned).toHaveLength(1)
    expect(plan.planned[0]?.externalId).toBe('77')
  })
})

// ── THE EXPORT'S COLUMN WINS; THE TARIFF DECIDES ONLY WHERE IT IS BLANK ─────
//
// Owner's instruction, 2026-10-06 (migration 70): compared per driver on dev,
// the tariff threshold had inverted the office's own `Driver Type` for 56 of
// 167 rows — a company driver paid 90% is what the office says he is.
describe('the planned driver type', () => {
  it('takes the export column first', () => {
    const plan = planDrivers([
      driverRow({
        'Driver Type': 'company_driver',
        'Driver tariff': '90% from gross',
      }),
    ])
    expect(plan.planned[0]?.driverType).toBe('COMPANY_DRIVER')
    const owner = planDrivers([
      driverRow({
        'Driver Type': 'company_owner',
        'Driver tariff': '30% from gross',
      }),
    ])
    expect(owner.planned[0]?.driverType).toBe('OWNER_OPERATOR')
  })

  it('falls back to the tariff only where the column is blank or unknown', () => {
    const blank = planDrivers([
      driverRow({ 'Driver tariff': '90% from gross' }),
    ])
    expect(blank.planned[0]?.driverType).toBe('OWNER_OPERATOR')
    const odd = planDrivers([
      driverRow({
        'Driver Type': 'contractor',
        'Driver tariff': '30% from gross',
      }),
    ])
    expect(odd.planned[0]?.driverType).toBe('COMPANY_DRIVER')
  })
})
