import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isDotRecordable,
  isWithinRetention,
  retainedUntil,
  shapeRegister,
  RETENTION_YEARS,
} from '@/lib/accidents'

// ---------------------------------------------------------------------------
// ITEM 14 — THE ACCIDENT REGISTER, AND THE THREE THINGS IT MUST NOT DO.
//
// 49 CFR 390.15(b) is a document a regulator reads. The rules that matter are
// which occurrences belong on it (§390.5), that a mistake is struck through
// rather than removed, and that one authority's register never carries
// another's rows.
// ---------------------------------------------------------------------------

const NOW = new Date(Date.UTC(2026, 8, 22, 12, 0, 0))
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

const facts = (over: Partial<Parameters<typeof isDotRecordable>[0]> = {}) => ({
  fatalities: 0,
  injuries: 0,
  towedAway: false,
  ...over,
})

describe('what §390.5 counts as an accident', () => {
  it('is any one of the three, on its own', () => {
    expect(isDotRecordable(facts({ fatalities: 1 }))).toBe(true)
    expect(isDotRecordable(facts({ injuries: 1 }))).toBe(true)
    expect(isDotRecordable(facts({ towedAway: true }))).toBe(true)
  })

  it('is NOT a hazmat release on its own', () => {
    // THE MISTAKE A CAREFUL READER MAKES. §390.15(b)(2)(vi) requires the
    // register to RECORD whether hazardous materials were released; §390.5
    // does not count a release as making the occurrence an accident. There is
    // no hazmat argument to this function at all, which is the strongest
    // available way of saying so.
    const [row] = shapeRegister(
      [
        {
          id: 'a',
          occurredAt: days(-1),
          city: 'Dayton',
          state: 'OH',
          injuries: 0,
          fatalities: 0,
          hazmatReleased: true,
          towedAway: false,
          voidedAt: null,
          voidReason: null,
          claimId: null,
          driver: null,
          truck: null,
        },
      ],
      NOW,
    )
    expect(row!.hazmatReleased).toBe(true)
    expect(row!.recordable).toBe(false)
  })

  it('is nothing at all when none of the three happened', () => {
    expect(isDotRecordable(facts())).toBe(false)
  })
})

// ── THE GUARD NAMED "recordable typed rather than derived" ─────────────
describe('recordable is never stored', () => {
  it('has no column, anywhere', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).not.toMatch(/isRecordable\s+/)
    expect(schema).not.toMatch(/recordable\s+Boolean/)
    expect(schema).not.toMatch(/dotRecordable\s+/)
  })

  it('is not read off a form either', () => {
    // A column is one way back in; a form field that writes one is the other.
    const actions = readFileSync(
      'src/app/(app)/safety/accidents/actions.ts',
      'utf8',
    )
    // THE THING, NOT A SUPERSET OF IT. The first version grepped for the
    // WORD and failed on the comment that documents the rule — which is
    // AGENTS.md’s “count the thing you are claiming”, caught by its own
    // guard. What must not exist is a form field that writes one.
    expect(actions.includes("get('recordable")).toBe(false)
    expect(actions.includes("get('isRecordable")).toBe(false)
    const page = readFileSync('src/app/(app)/safety/accidents/page.tsx', 'utf8')
    expect(page).not.toMatch(/name: 'recordable'/)
    expect(page).not.toMatch(/name: 'isRecordable'/)
  })

  it('is derived in ONE place, so three screens cannot disagree', () => {
    const lib = readFileSync('src/lib/accidents.ts', 'utf8')
    expect(lib.match(/fatalities > 0/g) ?? []).toHaveLength(1)
  })
})

// ── THE GUARD NAMED "an accident deleted rather than voided" ───────────
describe('an entry is voided, never deleted', () => {
  it('has no deletedAt on the table', () => {
    // Every other soft-deletable table in this schema has one. A register
    // does not: a row that leaves it silently is the shape of falsification,
    // whatever the intent.
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    const model = schema.slice(
      schema.indexOf('model Accident {'),
      schema.indexOf('}', schema.indexOf('model Accident {')),
    )
    expect(model).not.toContain('deletedAt')
    expect(model).toContain('voidedAt')
    expect(model).toContain('voidReason')
  })

  it('offers no delete in the service layer or the actions', () => {
    const lib = readFileSync('src/lib/accidents.ts', 'utf8')
    expect(lib).not.toMatch(/accident\.delete/)
    expect(lib).toContain('voidAccident')
    const actions = readFileSync(
      'src/app/(app)/safety/accidents/actions.ts',
      'utf8',
    )
    expect(actions.includes('accident.delete')).toBe(false)
    expect(actions.includes('deleteAccident')).toBe(false)
  })

  it('keeps a voided entry on the register, struck through', () => {
    const [row] = shapeRegister(
      [
        {
          id: 'a',
          occurredAt: days(-10),
          city: null,
          state: null,
          injuries: 1,
          fatalities: 0,
          hazmatReleased: false,
          towedAway: false,
          voidedAt: days(-1),
          voidReason: 'Filed against the wrong authority',
          claimId: null,
          driver: null,
          truck: null,
        },
      ],
      NOW,
    )
    // STILL A ROW, and still recordable: voiding says the entry was a
    // mistake, not that the occurrence was not an accident.
    expect(row!.voidedAt).toEqual(days(-1))
    expect(row!.voidReason).toBe('Filed against the wrong authority')
    expect(row!.recordable).toBe(true)
  })

  it('refuses a void with no reason, and a second void', () => {
    const lib = readFileSync('src/lib/accidents.ts', 'utf8')
    expect(lib).toContain("field: 'voidReason'")
    expect(lib).toContain('already_voided')
  })
})

describe('three years, from the occurrence', () => {
  it('counts from the date of the accident', () => {
    const at = new Date(Date.UTC(2026, 0, 31, 12, 0, 0))
    // 2029, WRITTEN OUT. The first version said `2026 + RETENTION_YEARS`,
    // which asks the constant under test what the answer should be — change
    // the constant and both sides move together. `watch-guard.mjs` reported
    // THE BREAK DID NOT FIRE, which is AGENTS.md's "never supply the baseline
    // you are testing" caught by the mechanism written for it.
    expect(retainedUntil(at).getUTCFullYear()).toBe(2029)
    // And the constant itself is the regulation's number, stated once.
    expect(RETENTION_YEARS).toBe(3)
    expect(retainedUntil(at).getUTCMonth()).toBe(0)
    expect(retainedUntil(at).getUTCDate()).toBe(31)
  })

  it('is not stored', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).not.toMatch(/retainedUntil\s+DateTime/)
  })

  it('marks an old entry as past retention without removing it', () => {
    const old = new Date(Date.UTC(2020, 0, 1))
    expect(isWithinRetention(old, NOW)).toBe(false)
    expect(isWithinRetention(days(-30), NOW)).toBe(true)
  })
})

describe('who may open the register', () => {
  it('is its own resource, not compliance', () => {
    // Owner's ruling, 2026-09-22, following this file's own reasoning at
    // `inspection`: who may file an accident is not who may renew a
    // registration. A screen that fell back to `compliance` would answer
    // the second question by accident.
    const permissions = readFileSync('src/lib/permissions.ts', 'utf8')
    expect(permissions).toContain("'accident',")

    const page = readFileSync('src/app/(app)/safety/accidents/page.tsx', 'utf8')
    expect(page).toContain("'accident'")
    expect(page).not.toContain("'compliance'")

    const actions = readFileSync(
      'src/app/(app)/safety/accidents/actions.ts',
      'utf8',
    )
    expect(actions).not.toContain("'compliance'")
  })
})

describe('the register reads as an auditor expects', () => {
  it('joins the city and the state, and leaves a gap visible', () => {
    const rows = shapeRegister(
      [
        {
          id: 'a',
          occurredAt: days(-2),
          city: 'Dayton',
          state: 'OH',
          injuries: 0,
          fatalities: 0,
          hazmatReleased: false,
          towedAway: true,
          voidedAt: null,
          voidReason: null,
          claimId: 'c1',
          driver: { firstName: 'Aziz', lastName: 'Karimov' },
          truck: { unitNumber: '1024' },
        },
        {
          id: 'b',
          occurredAt: days(-3),
          city: null,
          state: null,
          injuries: 0,
          fatalities: 0,
          hazmatReleased: false,
          towedAway: false,
          voidedAt: null,
          voidReason: null,
          claimId: null,
          driver: null,
          truck: null,
        },
      ],
      NOW,
    )
    expect(rows[0]!.place).toBe('Dayton, OH')
    expect(rows[0]!.driverName).toBe('Karimov, Aziz')
    expect(rows[0]!.truckLabel).toBe('1024')
    expect(rows[0]!.claimId).toBe('c1')
    // A BLANK IS A GAP AN AUDITOR CAN SEE. Nothing is invented for a row
    // nobody finished filling in.
    expect(rows[1]!.place).toBe('')
    expect(rows[1]!.driverName).toBe('')
    expect(rows[1]!.truckLabel).toBeNull()
  })

  it('links a claim without needing one', () => {
    // Not every accident produces a claim and not every claim comes from an
    // accident. The register is complete without it.
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    const model = schema.slice(
      schema.indexOf('model Accident {'),
      schema.indexOf('}', schema.indexOf('model Accident {')),
    )
    expect(model).toMatch(/claimId\s+String\?/)
  })
})
