import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAINTENANCE_CATEGORIES,
  runningTotals,
  shapeWorkOrders,
  type WorkOrderRow,
} from '@/lib/maintenance'
import type { MaintenanceCategory } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// The two things in maintenance that are decisions rather than queries: what
// leaves the server for a role that cannot see money, and what a running total
// is allowed to claim.
//
// The gating test is written as a PAIR — the same rows shaped both ways —
// because "the dispatcher does not see it" only means something next to "and
// the owner does".
// ---------------------------------------------------------------------------

const stored = (
  over: Partial<Parameters<typeof shapeWorkOrders>[0][number]> = {},
) => ({
  id: 'm1',
  companyId: 'c1',
  servicedAt: new Date('2026-08-03T00:00:00Z'),
  odometer: 412_000,
  category: 'BRAKES' as MaintenanceCategory,
  description: 'Steer axle brake job',
  vendorName: 'Gary Truck Service',
  costCents: 184_000,
  nextServiceDate: null,
  nextServiceOdometer: null,
  company: { name: 'RAM Haulage' },
  truck: { id: 't1', unitNumber: '104' },
  trailer: null,
  _count: { documents: 1 },
  ...over,
})

const row = (over: Partial<WorkOrderRow> = {}): WorkOrderRow => ({
  id: 'm1',
  companyId: 'c1',
  companyName: 'RAM Haulage',
  subject: 'truck',
  subjectId: 't1',
  subjectLabel: '104',
  servicedAt: new Date('2026-08-03T00:00:00Z'),
  category: 'BRAKES',
  description: null,
  vendorName: null,
  odometer: null,
  documentCount: 0,
  nextServiceAt: null,
  nextServiceOdometer: null,
  ...over,
})

describe('what a role that cannot see money receives', () => {
  it('has no cost KEY at all, not a null and not a zero', () => {
    const [shaped] = shapeWorkOrders([stored()], false)

    // `'costCents' in shaped` rather than a value check: a null would still
    // serialize into the payload and tell a dispatcher a number exists. The
    // rule is that the field is left OUT, and this is the only assertion that
    // can tell the difference.
    expect(shaped && 'costCents' in shaped).toBe(false)
    expect(JSON.stringify(shaped)).not.toContain('cost')
  })

  it('and still receives everything a dispatch decision needs', () => {
    // The pair's other half at the field level: gating the cost must not
    // quietly gate the work order. A truck in the shop on the 3rd is a fact a
    // dispatcher acts on.
    const [shaped] = shapeWorkOrders([stored()], false)
    expect(shaped?.category).toBe('BRAKES')
    expect(shaped?.subjectLabel).toBe('104')
    expect(shaped?.servicedAt.toISOString()).toBe('2026-08-03T00:00:00.000Z')
    expect(shaped?.documentCount).toBe(1)
  })

  it('while a role that can see money gets the cents', () => {
    const [shaped] = shapeWorkOrders([stored()], true)
    expect(shaped?.costCents).toBe(184_000)
  })
})

describe('a work order that hangs off nothing', () => {
  it('is dropped rather than rendered against a dash', () => {
    // Both subject columns are nullable, so the row is possible. It cannot be
    // shown against an asset, and a row whose asset column is empty is a link
    // to nowhere on the fleet screen.
    const orphan = stored({ truck: null, trailer: null })
    expect(shapeWorkOrders([orphan], true)).toEqual([])
  })

  it('and a trailer work order reports itself as a trailer', () => {
    const onTrailer = stored({
      truck: null,
      trailer: { id: 'tr1', unitNumber: 'R-22' },
    })
    const [shaped] = shapeWorkOrders([onTrailer], true)
    expect(shaped?.subject).toBe('trailer')
    expect(shaped?.subjectId).toBe('tr1')
    expect(shaped?.subjectLabel).toBe('R-22')
  })
})

describe('running totals', () => {
  it('adds the cents and nothing else', () => {
    const totals = runningTotals([
      row({ costCents: 184_000 }),
      row({ id: 'm2', costCents: 42_950 }),
    ])
    expect(totals.costCents).toBe(226_950)
  })

  it('refuses a cost per mile when the orders never recorded an odometer', () => {
    // Not zero, and not the total pretending to be a rate: null, because there
    // is no span to divide by and inventing one produces a figure nobody can
    // reproduce (rule 9-money).
    const totals = runningTotals([row({ costCents: 100_000 })])
    expect(totals.perMileCents).toBeNull()
    expect(totals.fromOdometer).toBeNull()
  })

  it('and refuses it again when every order shares one reading', () => {
    // Two work orders at the same odometer is a zero span. Dividing by it is
    // Infinity, which would render as a cost per mile of nothing at all.
    const totals = runningTotals([
      row({ costCents: 50_000, odometer: 400_000 }),
      row({ id: 'm2', costCents: 50_000, odometer: 400_000 }),
    ])
    expect(totals.perMileCents).toBeNull()
  })

  it('divides the spend by the span the orders themselves cover', () => {
    // $1,840 + $429.50 = $2,269.50 over 400,000 -> 412,000 miles.
    // 226,950 cents / 12,000 miles = 18.9 -> 19 cents a mile.
    const totals = runningTotals([
      row({ costCents: 184_000, odometer: 412_000 }),
      row({ id: 'm2', costCents: 42_950, odometer: 400_000 }),
    ])
    expect(totals.fromOdometer).toBe(400_000)
    expect(totals.toOdometer).toBe(412_000)
    expect(totals.perMileCents).toBe(19)
  })

  it('ignores rows with no reading when it picks the span', () => {
    // A work order somebody forgot to put an odometer on must not collapse the
    // span to nothing — it still contributes its cost.
    const totals = runningTotals([
      row({ costCents: 10_000, odometer: 400_000 }),
      row({ id: 'm2', costCents: 10_000, odometer: null }),
      row({ id: 'm3', costCents: 10_000, odometer: 410_000 }),
    ])
    expect(totals.costCents).toBe(30_000)
    expect(totals.fromOdometer).toBe(400_000)
    expect(totals.toOdometer).toBe(410_000)
  })

  it('totals nothing to zero rather than to a crash', () => {
    expect(runningTotals([])).toEqual({
      costCents: 0,
      perMileCents: null,
      fromOdometer: null,
      toOdometer: null,
    })
  })

  it('counts no cost where the role could not see one', () => {
    // Totalling rows that were shaped for a dispatcher gives zero, not a
    // partial figure — which is why the panel omits the whole totals block
    // rather than rendering this.
    const shaped = shapeWorkOrders([stored()], false)
    expect(runningTotals(shaped).costCents).toBe(0)
  })
})

describe('the category list', () => {
  // Read from the SCHEMA, not from a copy kept here — a copy kept here is the
  // same promise the list already makes. Same guard shape as
  // `document-targets.test.ts`, for the same reason: the failure it catches is
  // somebody adding an enum member and no screen offering it.
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  )
  const members = [
    ...(/^enum\s+MaintenanceCategory\s*\{([\s\S]*?)^\}/m
      .exec(schema)?.[1]
      ?.matchAll(/^\s{2}(\w+)\s*$/gm) ?? []),
  ].map((match) => match[1]!)

  it('found the enum at all', () => {
    // Without this the two set comparisons below pass vacuously if the regex
    // ever stops matching.
    expect(members.length).toBeGreaterThan(5)
  })

  it('offers every category the schema has, and none it does not', () => {
    // Unlike compliance's seven-of-fourteen: this enum was written for exactly
    // this screen, so a category missing from the list is a work order nobody
    // can file, and one that is not in the schema is a form that 500s on save.
    expect([...MAINTENANCE_CATEGORIES].sort()).toEqual([...members].sort())
  })

  it('lists them in shop order with the catch-all last', () => {
    expect(MAINTENANCE_CATEGORIES[0]).toBe('PREVENTIVE')
    expect(MAINTENANCE_CATEGORIES.at(-1)).toBe('OTHER')
    expect(new Set(MAINTENANCE_CATEGORIES).size).toBe(
      MAINTENANCE_CATEGORIES.length,
    )
  })
})
