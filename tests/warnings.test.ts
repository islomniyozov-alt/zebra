import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  driverWarnings,
  loadWarnings,
  truckWarnings,
  EXPIRING_WITHIN_DAYS,
  PICKUP_SOON_HOURS,
  type LoadFacts,
  type WarningName,
} from '@/lib/warnings'

// ---------------------------------------------------------------------------
// EVERY WARNING HAS A FACT UNDER IT, AND NO WARNING IS STORED.
//
// Item 9. Datatruck exports a computed `Warnings` column on drivers, trucks
// and loads; Zebra derives the same thing on demand. These are the rules —
// the queries that feed them are graded in the integration suite, where the
// fan-out can be counted.
//
// ── THE TWO GUARDS THAT ARE NOT ABOUT A PARTICULAR WARNING ───────────────
//
// "A warning with no producing fact" and "a stored warning" are properties of
// the whole design rather than of any one rule, so they are checked at the
// bottom against the source itself.
// ---------------------------------------------------------------------------

const NOW = new Date(Date.UTC(2026, 8, 20, 12, 0, 0))
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000)

const names = (warnings: { name: WarningName }[]) => warnings.map((w) => w.name)

const load = (over: Partial<LoadFacts> = {}): LoadFacts => ({
  pickupAt: days(30),
  hasDriver: true,
  hasTruck: true,
  isCancelled: false,
  closedHistory: false,
  directSettled: false,
  rateCents: 100_000,
  remittedCents: 0,
  hasRemittance: false,
  confirmedCents: null,
  ...over,
})

describe('compliance', () => {
  it('names a document that has expired', () => {
    const out = driverWarnings(
      {
        compliance: [
          { type: 'CDL', expiresAt: days(400) },
          { type: 'MEDICAL_CARD', expiresAt: days(-1) },
        ],
        negativeNetCount: 0,
      },
      NOW,
    )
    expect(names(out)).toContain('compliance_expired')
    expect(out.find((w) => w.name === 'compliance_expired')?.detail).toBe(
      'MEDICAL_CARD',
    )
  })

  it('names one expiring inside the window, and not one outside it', () => {
    const inside = driverWarnings(
      {
        compliance: [
          { type: 'CDL', expiresAt: days(EXPIRING_WITHIN_DAYS - 1) },
          { type: 'MEDICAL_CARD', expiresAt: days(400) },
        ],
        negativeNetCount: 0,
      },
      NOW,
    )
    expect(names(inside)).toEqual(['compliance_expiring'])

    const outside = driverWarnings(
      {
        compliance: [
          { type: 'CDL', expiresAt: days(EXPIRING_WITHIN_DAYS + 5) },
          { type: 'MEDICAL_CARD', expiresAt: days(400) },
        ],
        negativeNetCount: 0,
      },
      NOW,
    )
    expect(outside).toEqual([])
  })

  it('treats a MISSING document as its own thing, not as expired', () => {
    // A lapsed card has something to renew. An absent one does not, and
    // somebody has to go and get it — different job, different warning.
    const out = driverWarnings(
      {
        compliance: [{ type: 'CDL', expiresAt: days(400) }],
        negativeNetCount: 0,
      },
      NOW,
    )
    expect(names(out)).toEqual(['document_missing'])
    expect(out[0]!.detail).toBe('MEDICAL_CARD')
  })

  it('asks a truck for its own documents, not a driver’s', () => {
    const out = truckWarnings({ compliance: [] }, NOW)
    expect(out.map((w) => w.detail).sort()).toEqual([
      'ANNUAL_INSPECTION',
      'INSURANCE_LIABILITY',
      'REGISTRATION',
    ])
  })

  it('says nothing about a document with no expiry at all', () => {
    // A permit with no date is not expiring. Treating null as "expired" would
    // light up every row that has ever been filed without one.
    const out = truckWarnings(
      {
        compliance: [
          { type: 'REGISTRATION', expiresAt: null },
          { type: 'ANNUAL_INSPECTION', expiresAt: days(400) },
          { type: 'INSURANCE_LIABILITY', expiresAt: days(400) },
        ],
      },
      NOW,
    )
    expect(out).toEqual([])
  })
})

describe('a driver whose settlement went below zero', () => {
  it('is warned about, once, however many times it happened', () => {
    const out = driverWarnings(
      {
        compliance: [
          { type: 'CDL', expiresAt: days(400) },
          { type: 'MEDICAL_CARD', expiresAt: days(400) },
        ],
        negativeNetCount: 3,
      },
      NOW,
    )
    expect(names(out)).toEqual(['settlement_net_negative'])
    expect(out[0]!.detail).toBe('3')
  })
})

describe('a load close to its pickup', () => {
  it('is warned about when nobody is on it', () => {
    const out = loadWarnings(
      load({ pickupAt: hours(PICKUP_SOON_HOURS - 1), hasDriver: false }),
      NOW,
    )
    expect(names(out)).toEqual(['pickup_soon_unassigned'])
    expect(out[0]!.detail).toBe('driver')
  })

  it('is NOT warned about when it is fully crewed', () => {
    expect(loadWarnings(load({ pickupAt: hours(1) }), NOW)).toEqual([])
  })

  it('is not warned about while the pickup is still far off', () => {
    expect(
      loadWarnings(
        load({ pickupAt: hours(PICKUP_SOON_HOURS + 2), hasDriver: false }),
        NOW,
      ),
    ).toEqual([])
  })

  it('is still warned about when the pickup is already PAST', () => {
    // More urgent, not less. A window that only looked forwards would go
    // quiet at exactly the moment the load became a problem.
    const out = loadWarnings(
      load({ pickupAt: hours(-6), hasTruck: false }),
      NOW,
    )
    expect(names(out)).toEqual(['pickup_soon_unassigned'])
    expect(out[0]!.detail).toBe('truck')
  })
})

describe('a cancelled load', () => {
  it('is warned about while it still holds a driver or a truck', () => {
    const out = loadWarnings(load({ isCancelled: true }), NOW)
    expect(names(out)).toEqual(['cancelled_but_assigned'])
    expect(out[0]!.detail).toBe('driver+truck')
  })

  it('is silent once the equipment is released', () => {
    expect(
      loadWarnings(
        load({ isCancelled: true, hasDriver: false, hasTruck: false }),
        NOW,
      ),
    ).toEqual([])
  })

  it('is never warned about its pickup or its settlement', () => {
    // It has no pickup to be late for and will never be settled.
    const out = loadWarnings(
      load({
        isCancelled: true,
        hasDriver: false,
        hasTruck: false,
        pickupAt: hours(1),
        directSettled: true,
      }),
      NOW,
    )
    expect(out).toEqual([])
  })
})

describe('a direct-settled load the engine would refuse', () => {
  it('is held when the remittance is short of the rate', () => {
    const out = loadWarnings(
      load({ directSettled: true, hasRemittance: true, remittedCents: 90_000 }),
      NOW,
    )
    expect(names(out)).toEqual(['settlement_line_held'])
    expect(out[0]!.detail).toBe('short')
  })

  it('is held when nothing has been remitted at all', () => {
    const out = loadWarnings(load({ directSettled: true }), NOW)
    expect(out[0]!.detail).toBe('none')
  })

  it('is NOT held once the remittance matches exactly', () => {
    expect(
      loadWarnings(
        load({
          directSettled: true,
          hasRemittance: true,
          remittedCents: 100_000,
        }),
        NOW,
      ),
    ).toEqual([])
  })

  it('is NOT held once a person has confirmed the gross', () => {
    // The whole point of the confirmation: a short remittance somebody has
    // looked at and accepted stops being a question.
    expect(
      loadWarnings(
        load({
          directSettled: true,
          hasRemittance: true,
          remittedCents: 90_000,
          confirmedCents: 90_000,
        }),
        NOW,
      ),
    ).toEqual([])
  })
})

describe('closed history', () => {
  it('produces no warnings at all, whatever is wrong with it', () => {
    // THE GUARD NAMED "closed history producing warnings". Datatruck settled
    // this freight; asking somebody to fix it, on 14,464 rows, is noise that
    // would bury every warning that does matter.
    const out = loadWarnings(
      load({
        closedHistory: true,
        isCancelled: true,
        hasDriver: true,
        pickupAt: hours(-100),
        directSettled: true,
      }),
      NOW,
    )
    expect(out).toEqual([])
  })
})

// ── THE DESIGN GUARDS ──────────────────────────────────────────────────
describe('the shape of the feature', () => {
  const source = readFileSync('src/lib/warnings.ts', 'utf8')
  const schema = readFileSync('prisma/schema.prisma', 'utf8')

  it('stores no warning anywhere', () => {
    // THE GUARD NAMED "a stored warning". A column would be a copy of a fact,
    // and a copy goes stale without telling anybody.
    expect(schema).not.toMatch(/warnings?\s+String/i)
    expect(schema).not.toMatch(/model\s+Warning\b/)
  })

  it('reaches the database only through the batched loaders', () => {
    // THE GUARD NAMED "per-row query fan-out", in its cheapest form: the pure
    // rules take facts and never a client. The costed form is in the
    // integration suite, which counts statements against a growing list.
    const rules = source.slice(0, source.indexOf('// ── the facts'))

    // No rule touches the database: the facts reach them as plain objects.
    expect(rules).not.toContain('$queryRaw')

    // AND THE LOADERS ARE THREE STATEMENTS, ONE PER ENTITY — the number that
    // must not grow with the length of a list. The first version of this
    // assertion matched the word `prisma` in an import line and would have
    // passed whatever the loaders actually did.
    expect(source.match(/\$queryRaw/g) ?? []).toHaveLength(3)
  })

  it('every warning name is produced by some rule', () => {
    // THE GUARD NAMED "a warning with no producing fact". A name in the union
    // that nothing emits is a promise the UI will translate, filter on and
    // never show.
    const declared = [
      ...source
        .slice(
          source.indexOf('export type WarningName'),
          source.indexOf('export interface Warning'),
        )
        .matchAll(/'([a-z_]+)'/g),
    ].map((hit) => hit[1])

    expect(declared.length).toBeGreaterThan(0)
    for (const name of declared) {
      expect(
        source.includes(`name: '${name}'`),
        `${name} is declared but nothing produces it`,
      ).toBe(true)
    }
  })
})
