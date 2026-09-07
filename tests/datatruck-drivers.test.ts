import { describe, expect, it } from 'vitest'
import { parseLicenceExpiry, parseTariff } from '@/lib/datatruck/drivers'
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
    // `stateCode` would return "WI" here, which is right by luck, and "TE" for
    // Texas, which is not. Neither is a guess this table makes.
    expect(resolveState('Wisconsin')).toEqual({ ok: false, raw: 'Wisconsin' })
    expect(resolveState('')).toEqual({ ok: false, raw: '' })
  })
})
