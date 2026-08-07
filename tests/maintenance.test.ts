import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAINTENANCE_CATEGORIES,
  runningTotals,
  shapeWorkOrders,
  type WorkOrderRow,
} from '@/lib/maintenance'
import { centsToInput } from '@/lib/money'
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

describe('the maintenance money, worked by hand', () => {
  // §3 step 7 asks for a worked example behind any money math, for the reason
  // Phase 3 §0 gives: the likeliest failure in this system is a financial
  // calculation that is PLAUSIBLE. These are the two figures the maintenance
  // panel prints, arithmetic written out so a reader can check them with a
  // calculator and no knowledge of the code.
  //
  // The fixture is the dev demo truck, so the numbers here are the ones in the
  // Phase 4 screenshots: three work orders on truck 104.

  const DEMO: WorkOrderRow[] = [
    // 3 May, PM A at 400,000 miles — $429.50
    row({ id: 'pm', costCents: 42_950, odometer: 400_000 }),
    // 27 June, two steer tires at 406,500 miles — $1,180.00
    row({ id: 'tires', costCents: 118_000, odometer: 406_500 }),
    // 3 August, steer brake job at 412,000 miles — $1,840.00
    row({ id: 'brakes', costCents: 184_000, odometer: 412_000 }),
  ]

  it('totals what a reader gets by adding the column', () => {
    //     429.50
    //   1,180.00
    //   1,840.00
    //   --------
    //   3,449.50   ->  344950 cents
    const totals = runningTotals(DEMO)
    expect(totals.costCents).toBe(344_950)
    expect(centsToInput(totals.costCents)).toBe('3449.50')
  })

  it('and a cost per mile a reader gets by dividing it', () => {
    // The span is the odometer readings the work orders themselves carry:
    //   412,000 - 400,000 = 12,000 miles
    //
    //   344950 cents / 12000 miles = 28.745... cents a mile
    //                              -> 29 cents, rounded half up
    //
    // Rounded to whole cents on purpose. A cost per mile is a comparison
    // figure — this tractor against that one — and a fraction of a cent in it
    // is precision the odometer readings do not support.
    const totals = runningTotals(DEMO)
    expect(totals.fromOdometer).toBe(400_000)
    expect(totals.toOdometer).toBe(412_000)
    expect(totals.perMileCents).toBe(29)

    // The same sum, spelled out, so the assertion above is not the only place
    // the arithmetic exists.
    expect(Math.round(344_950 / 12_000)).toBe(29)
  })

  it('rounds half up rather than truncating, and it matters at a half', () => {
    // 6,000 cents over 400 miles is exactly 15; add 200 cents and it is 15.5,
    // which truncation would report as 15 — a 3% understatement of the figure
    // an owner uses to decide whether to keep a truck.
    const exact = runningTotals([
      row({ id: 'a', costCents: 0, odometer: 100_000 }),
      row({ id: 'b', costCents: 6_000, odometer: 100_400 }),
    ])
    expect(exact.perMileCents).toBe(15)

    const half = runningTotals([
      row({ id: 'a', costCents: 0, odometer: 100_000 }),
      row({ id: 'b', costCents: 6_200, odometer: 100_400 }),
    ])
    expect(half.perMileCents).toBe(16)
  })

  it('and the fleet total is the same addition over more assets', () => {
    // The /maintenance screen totals what is ON SCREEN, so a reader can check
    // it the same way — by adding the cost column. $3,449.50 on the truck plus
    // $615.00 on a trailer.
    const fleet = [...DEMO, row({ id: 'reefer', costCents: 61_500 })]
    expect(runningTotals(fleet).costCents).toBe(406_450)
    expect(centsToInput(406_450)).toBe('4064.50')
  })
})
