import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  annualRate,
  assertResolvable,
  drawOrder,
  poolFromDrivers,
  selectFromPool,
  selectionsForQuarter,
  selectionsForYear,
  yearSummary,
  DRAW_ALGORITHM,
  TEST_KINDS,
  type AnnualRate,
} from '@/lib/random-testing'
import { ReferenceError } from '@/lib/reference'

/**
 * A source file with its comments removed.
 *
 * A GUARD THAT GREPS PROSE IS GUARDING PROSE. Both of the "is it written
 * into the source" checks in this repository failed first on the comment
 * explaining why the thing must not be written into the source — item 14's
 * did it too. Stripping comments first is the difference between counting
 * the thing and counting a superset of it (AGENTS.md).
 *
 * Crude on purpose: it does not understand strings that contain `//`, and
 * it does not need to. It is used on two files, both of which are read
 * before this test is trusted.
 */
const codeOf = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

// ---------------------------------------------------------------------------
// ITEM 15 — THE RANDOM TESTING PROGRAMME, 49 CFR 382.305.
//
// The rules that matter: the rate is data, the draw is recomputable, and the
// pool contains only people subject to testing. Each is a guard the ruling
// named.
// ---------------------------------------------------------------------------

const RATE_2026: AnnualRate = {
  year: 2026,
  drugRateBps: 5000,
  alcoholRateBps: 1000,
  citation: '89 FR 1234',
}

const driver = (
  over: Partial<Parameters<typeof poolFromDrivers>[0][number]>,
) => ({
  id: 'd1',
  firstName: 'Aziz',
  lastName: 'Karimov',
  status: 'AVAILABLE',
  deletedAt: null,
  hasCdl: true,
  ...over,
})

// ── THE GUARD NAMED "a rate hardcoded" ─────────────────────────────────
describe('the rate is data', () => {
  it('comes from a row, with the notice it was read from', () => {
    const rate = annualRate([RATE_2026], 2026)
    expect(rate.drugRateBps).toBe(5000)
    expect(rate.citation).toBe('89 FR 1234')
  })

  it('REFUSES a year nobody entered rather than defaulting', () => {
    // §382.305(b)'s rate is adjusted by notice in the Federal Register. A
    // fallback would be a wrong number nobody questions; "we do not know this
    // year's rate" is a sentence somebody can act on.
    let caught: unknown
    try {
      annualRate([RATE_2026], 2027)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ReferenceError)
    expect((caught as ReferenceError).code).toBe('rate_not_recorded')
  })

  it('does not carry last year forward', () => {
    // The nearest-year fallback is the tempting one and it is the worst: it
    // produces a plausible number for every year for ever.
    expect(() => annualRate([RATE_2026], 2025)).toThrow()
  })

  it('has no percentage written into the source', () => {
    // THE GUARD ITSELF. A `const DRUG_RATE = 0.5` would be correct until the
    // morning it silently was not.
    const lib = codeOf('src/lib/random-testing.ts')
    expect(lib).not.toMatch(/=\s*0\.5\b/)
    expect(lib).not.toMatch(/DRUG_RATE|ALCOHOL_RATE|DEFAULT_RATE/)
    expect(lib).not.toMatch(/=\s*5000\b/)
    expect(lib).not.toMatch(/=\s*1000\b/)

    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    // The columns carry no default either — a default IS a hardcoded rate
    // wearing a migration.
    expect(schema).not.toMatch(/drugRateBps\s+Int\s+@default/)
    expect(schema).not.toMatch(/alcoholRateBps\s+Int\s+@default/)
  })
})

describe('how many to draw', () => {
  it('rounds UP, because the rate is a minimum', () => {
    // 21 drivers at 50% is 10.5, which is eleven selections. Rounding to ten
    // is under-testing by rule rather than by accident.
    expect(selectionsForYear(21, 5000)).toBe(11)
    expect(selectionsForYear(10, 1000)).toBe(1)
    expect(selectionsForYear(0, 5000)).toBe(0)
  })

  it('puts the catch-up in the quarters that are left', () => {
    // Twelve for the year, nothing drawn, Q1: three.
    expect(selectionsForQuarter(12, 1, 0)).toBe(3)
    // Nothing drawn all year and it is Q4: all twelve, now.
    expect(selectionsForQuarter(12, 4, 0)).toBe(12)
    // Already ahead: nothing more.
    expect(selectionsForQuarter(12, 4, 12)).toBe(0)
  })
})

// ── THE GUARD NAMED "a draw not recorded" ──────────────────────────────
describe('the draw is recomputable', () => {
  it('is a pure function of the seed and the pool', async () => {
    const keys = ['a', 'b', 'c', 'd', 'e']
    const once = await drawOrder('seed-1', keys)
    const again = await drawOrder('seed-1', keys)
    expect(again).toEqual(once)
  })

  it('does not depend on the order the pool is read in', async () => {
    // THE REASON IT RANKS RATHER THAN SHUFFLES. An auditor reading the
    // snapshot rows in a different order must recompute the same names, or
    // they conclude the draw was faked.
    const forwards = await drawOrder('seed-1', ['a', 'b', 'c', 'd', 'e'])
    const backwards = await drawOrder('seed-1', ['e', 'd', 'c', 'b', 'a'])
    expect(backwards).toEqual(forwards)
  })

  it('gives a different answer for a different seed', async () => {
    const one = await drawOrder('seed-1', ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    const two = await drawOrder('seed-2', ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(two).not.toEqual(one)
  })

  it('names and versions its method, so an old draw stays verifiable', () => {
    expect(DRAW_ALGORITHM).toBe('sha256-rank-v1')
    const lib = readFileSync('src/lib/random-testing.ts', 'utf8')
    expect(lib).toContain('verifyDraw')
    // The draw stores all three things a recomputation needs.
    expect(lib).toContain('poolSnapshot')
    expect(lib).toContain('seed: input.seed')
    expect(lib).toContain('algorithm: DRAW_ALGORITHM')
  })

  it('cannot store a draw without a seed or a snapshot', () => {
    // The CHECK, not the service layer: the database refuses a draw that
    // nobody could recompute.
    const migration = readFileSync(
      'prisma/migrations/20260922180000_random_testing_programme/migration.sql',
      'utf8',
    )
    expect(migration).toContain('RandomDraw_is_recomputable')
    expect(migration).toContain('length("seed") > 0')
    expect(migration).toContain(
      'jsonb_array_length("poolSnapshot") = "poolSize"',
    )
  })
})

// ── THE GUARD NAMED "selection outside the pool" ───────────────────────
describe('a selection comes from the pool', () => {
  it('never returns a key that was not in it', async () => {
    const keys = ['a', 'b', 'c']
    const picked = await selectFromPool('seed', keys, { DRUG: 2, ALCOHOL: 1 })
    for (const kind of TEST_KINDS) {
      for (const key of picked[kind]) expect(keys).toContain(key)
    }
  })

  it('cannot draw more people than the pool holds', async () => {
    // Asking for ten out of three is a programme that has more selections
    // than drivers; it returns three, not three plus seven inventions.
    const picked = await selectFromPool('seed', ['a', 'b', 'c'], {
      DRUG: 10,
      ALCOHOL: 10,
    })
    expect(picked.DRUG).toHaveLength(3)
    expect(picked.ALCOHOL).toHaveLength(3)
  })

  it('draws nobody from an empty pool', async () => {
    const picked = await selectFromPool('seed', [], { DRUG: 4, ALCOHOL: 1 })
    expect(picked.DRUG).toEqual([])
  })

  it('draws each person at most once per kind, and independently across', async () => {
    // §382.305 runs two programmes over one pool. Being drawn for drugs must
    // not exclude somebody from the alcohol draw, or the two rates stop being
    // independent — but nobody is drawn twice within one kind.
    const keys = ['a', 'b', 'c', 'd', 'e', 'f']
    const picked = await selectFromPool('seed', keys, { DRUG: 3, ALCOHOL: 3 })
    expect(new Set(picked.DRUG).size).toBe(3)
    expect(new Set(picked.ALCOHOL).size).toBe(3)
    // Different seeds per kind, so the two lists are not the same people.
    expect(picked.ALCOHOL).not.toEqual(picked.DRUG)
  })
})

// ── THE GUARD NAMED "a terminated driver drawn" ────────────────────────
describe('who is in the pool', () => {
  it('is somebody employed, with a CDL on file', () => {
    expect(poolFromDrivers([driver({})])).toHaveLength(1)
  })

  it('is NOT somebody who has left', () => {
    // §382.305(i): selections come from the pool of drivers SUBJECT TO
    // testing. Somebody who left in March is not subject to testing in June,
    // and drawing them produces a selection that can never be resolved and a
    // rate that looks met and is not.
    expect(poolFromDrivers([driver({ status: 'INACTIVE' })])).toEqual([])
    expect(poolFromDrivers([driver({ deletedAt: new Date() })])).toEqual([])
  })

  it('is NOT somebody with no CDL on file', () => {
    expect(poolFromDrivers([driver({ hasCdl: false })])).toEqual([])
  })

  it('includes somebody on holiday, who comes back', () => {
    expect(poolFromDrivers([driver({ status: 'VACATION' })])).toHaveLength(1)
  })
})

describe('the year-end summary', () => {
  const selections = (tested: number, notTested: number, pending: number) => [
    ...Array.from({ length: tested }, () => ({
      kind: 'DRUG' as const,
      outcome: 'TESTED' as const,
    })),
    ...Array.from({ length: notTested }, () => ({
      kind: 'DRUG' as const,
      outcome: 'NOT_TESTED' as const,
    })),
    ...Array.from({ length: pending }, () => ({
      kind: 'DRUG' as const,
      outcome: 'PENDING' as const,
    })),
  ]

  it('counts TESTS CONDUCTED, not names drawn', () => {
    // A carrier that drew twenty names and tested eleven has tested eleven.
    // Counting selections would let a programme meet its rate on paper by
    // drawing names nobody chased.
    const summary = yearSummary(RATE_2026, 20, selections(10, 9, 1))
    expect(summary.kinds.DRUG.required).toBe(10)
    expect(summary.kinds.DRUG.selected).toBe(20)
    expect(summary.kinds.DRUG.tested).toBe(10)
    expect(summary.kinds.DRUG.met).toBe(true)

    const short = yearSummary(RATE_2026, 20, selections(9, 10, 1))
    expect(short.kinds.DRUG.tested).toBe(9)
    expect(short.kinds.DRUG.met).toBe(false)
  })

  it('carries the citation onto the summary', () => {
    expect(yearSummary(RATE_2026, 10, []).citation).toBe('89 FR 1234')
  })
})

describe('a random test writes no compliance record', () => {
  it('creates nothing in ComplianceItem, for either kind', () => {
    // THE GUARD FOR THE RULING. The first version wrote a DRUG_TEST row
    // whose only honest expiry was the test date, which then forced an
    // exclusion in `warnings.ts` so it would not read as lapsed — two
    // compensations for one thing being in the wrong place.
    const lib = codeOf('src/lib/random-testing.ts')
    expect(lib).not.toContain('complianceItem.create')
    expect(lib).not.toContain("type: 'DRUG_TEST'")
  })

  it('and warnings.ts excludes no compliance type at all', () => {
    // An exclusion list would be a second vocabulary of compliance types,
    // divided into ones that mean something and ones that do not.
    const warnings = codeOf('src/lib/warnings.ts')
    expect(warnings).not.toContain('EVENT_TYPES')
  })
})

describe('resolving a selection', () => {
  it('refuses NOT_TESTED with no reason', () => {
    // §382.305(j)(3) allows a selected driver to be excused, but the carrier
    // has to say why for each one.
    expect(() => assertResolvable('NOT_TESTED', null)).toThrow()
    expect(() => assertResolvable('NOT_TESTED', '   ')).toThrow()
    expect(() => assertResolvable('NOT_TESTED', 'On leave')).not.toThrow()
  })

  it('needs no reason for a test that happened', () => {
    expect(() => assertResolvable('TESTED', null)).not.toThrow()
  })

  it('has a CHECK behind it, not only the service layer', () => {
    const migration = readFileSync(
      'prisma/migrations/20260922180000_random_testing_programme/migration.sql',
      'utf8',
    )
    expect(migration).toContain('RandomSelection_not_tested_needs_reason')
  })
})
