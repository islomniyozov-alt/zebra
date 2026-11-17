import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DELIVERED_STATUSES,
  deliveredBetween,
  deliveryDateOf,
  settleableInPeriod,
  settleableWhere,
} from '@/lib/settlements'
import {
  previewFrom,
  previewLoadsSql,
  type PreviewLoad,
} from '@/lib/batch-preview'
import { Prisma } from '@/generated/prisma/client'

// MONEY-DESIGN §6, owner's ruling 2026-11-17: a trip is placed by its DELIVERY
// DATE — the last drop's actual departure, else when its status reached
// Delivered — and a Delivered trip settles without waiting for its POD.

const d = (iso: string) => new Date(iso)

interface Row {
  operationalStatus: string
  stops: { type: string; departedAt: Date | null }[]
  statusEvents: {
    axis: string
    toStatus: string
    outcome: string
    occurredAt: Date
  }[]
}

describe('deliveryDateOf, the one definition', () => {
  const stops = (...rows: [string, string | null][]) =>
    rows.map(([type, at]) => ({ type, departedAt: at ? d(at) : null }))

  it('takes the last drop’s actual departure over the Delivered time', () => {
    expect(
      deliveryDateOf({
        stops: stops(
          ['PICKUP', '2026-11-09T08:00:00Z'],
          ['DELIVERY', '2026-11-10T10:00:00Z'],
          ['DELIVERY', '2026-11-11T16:00:00Z'],
        ),
        finishedAt: d('2026-11-12T00:00:00Z'),
      })?.toISOString(),
    ).toBe('2026-11-11T16:00:00.000Z')
  })

  it('ignores a pickup departure, and falls back to the Delivered time', () => {
    expect(
      deliveryDateOf({
        stops: stops(['PICKUP', '2026-11-09T08:00:00Z'], ['DELIVERY', null]),
        finishedAt: d('2026-11-12T09:00:00Z'),
      })?.toISOString(),
    ).toBe('2026-11-12T09:00:00.000Z')
  })

  it('is null when neither is recorded', () => {
    expect(
      deliveryDateOf({ stops: stops(['DELIVERY', null]), finishedAt: null }),
    ).toBeNull()
  })
})

// ── THE PRISMA SPELLING, EVALUATED AGAINST ROWS ───────────────────────────
//
// A small evaluator for exactly the operators `deliveredBetween` and
// `settleableInPeriod` use: AND, OR, relation `some`/`none`, and gte, lte, gt,
// lt, `not: null`, `in`. So the test reads what the filter SELECTS.

type Where = Record<string, unknown>

function scalar(value: unknown, wanted: unknown): boolean {
  if (wanted === null || typeof wanted !== 'object' || wanted instanceof Date) {
    return value instanceof Date && wanted instanceof Date
      ? value.getTime() === wanted.getTime()
      : value === wanted
  }
  const op = wanted as {
    gte?: Date
    lte?: Date
    gt?: Date
    lt?: Date
    not?: unknown
    in?: readonly string[]
  }
  if ('not' in op && value === op.not) return false
  if (op.in && !op.in.includes(value as string)) return false
  const t = value instanceof Date ? value.getTime() : null
  if (op.gte && (t === null || t < op.gte.getTime())) return false
  if (op.lte && (t === null || t > op.lte.getTime())) return false
  if (op.gt && (t === null || t <= op.gt.getTime())) return false
  if (op.lt && (t === null || t >= op.lt.getTime())) return false
  return true
}

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    if (key === 'AND') return (wanted as Where[]).every((w) => matches(row, w))
    if (key === 'OR') return (wanted as Where[]).some((w) => matches(row, w))
    const value = row[key]
    if (Array.isArray(value)) {
      const rel = wanted as { some?: Where; none?: Where }
      const items = value as Record<string, unknown>[]
      if (rel.some && !items.some((item) => matches(item, rel.some!)))
        return false
      if (rel.none && items.some((item) => matches(item, rel.none!)))
        return false
      return true
    }
    return scalar(value, wanted)
  })
}

const FROM = d('2026-11-08T00:00:00Z')
const TO = d('2026-11-14T23:59:59.999Z')
const ev = (toStatus: string, at: string, outcome = 'APPLIED') => ({
  axis: 'OPERATIONAL',
  toStatus,
  outcome,
  occurredAt: d(at),
})

// Every shape the definition distinguishes, inside, outside and astride.
const CASES: Record<string, Row> = {
  departedIn: {
    operationalStatus: 'POD_RECEIVED',
    stops: [{ type: 'DELIVERY', departedAt: d('2026-11-14T22:00:00Z') }],
    statusEvents: [ev('POD_RECEIVED', '2026-11-16T10:00:00Z')],
  },
  departedAfter: {
    operationalStatus: 'POD_RECEIVED',
    stops: [{ type: 'DELIVERY', departedAt: d('2026-11-15T01:00:00Z') }],
    statusEvents: [ev('DELIVERED', '2026-11-13T10:00:00Z')],
  },
  multiDropLastAfter: {
    operationalStatus: 'DELIVERED',
    stops: [
      { type: 'DELIVERY', departedAt: d('2026-11-13T10:00:00Z') },
      { type: 'DELIVERY', departedAt: d('2026-11-15T09:00:00Z') },
    ],
    statusEvents: [],
  },
  deliveredEventIn: {
    operationalStatus: 'DELIVERED',
    stops: [{ type: 'DELIVERY', departedAt: null }],
    statusEvents: [ev('DELIVERED', '2026-11-10T12:00:00Z')],
  },
  deliveredBeforePodIn: {
    operationalStatus: 'POD_RECEIVED',
    stops: [{ type: 'DELIVERY', departedAt: null }],
    statusEvents: [
      ev('DELIVERED', '2026-11-06T12:00:00Z'),
      ev('POD_RECEIVED', '2026-11-09T12:00:00Z'),
    ],
  },
  podJumpIn: {
    operationalStatus: 'POD_RECEIVED',
    stops: [{ type: 'DELIVERY', departedAt: null }],
    statusEvents: [ev('POD_RECEIVED', '2026-11-12T00:00:00Z')],
  },
  refusedOnly: {
    operationalStatus: 'POD_RECEIVED',
    stops: [{ type: 'DELIVERY', departedAt: null }],
    statusEvents: [ev('POD_RECEIVED', '2026-11-12T00:00:00Z', 'REFUSED_STALE')],
  },
  inTransitEvent: {
    operationalStatus: 'IN_TRANSIT',
    stops: [{ type: 'DELIVERY', departedAt: null }],
    statusEvents: [ev('IN_TRANSIT', '2026-11-10T00:00:00Z')],
  },
  departedButNotDelivered: {
    operationalStatus: 'AT_DELIVERY',
    stops: [{ type: 'DELIVERY', departedAt: d('2026-11-10T00:00:00Z') }],
    statusEvents: [],
  },
}

const pure = (row: Row) => {
  const at = deliveryDateOf({
    stops: row.stops,
    finishedAt:
      row.statusEvents
        .filter(
          (e) =>
            e.axis === 'OPERATIONAL' &&
            e.outcome === 'APPLIED' &&
            (DELIVERED_STATUSES as readonly string[]).includes(e.toStatus),
        )
        .map((e) => e.occurredAt)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
  })
  return at !== null && at >= FROM && at <= TO
}

describe('the Prisma spelling selects what the pure definition decides', () => {
  it('agrees case by case, and selects the cases the ruling names', () => {
    const selected: string[] = []
    for (const [name, row] of Object.entries(CASES)) {
      const prisma = matches(
        row as unknown as Record<string, unknown>,
        deliveredBetween(FROM, TO),
      )
      expect(prisma, name).toBe(pure(row))
      if (prisma) selected.push(name)
    }
    // `departedButNotDelivered` is in the window by date and excluded by the
    // status gate below, not by this predicate.
    expect(selected.sort()).toEqual(
      [
        'deliveredEventIn',
        'departedButNotDelivered',
        'departedIn',
        'podJumpIn',
      ].sort(),
    )
  })

  it('settles a Delivered trip without a POD, and never a moving one', () => {
    const settle = (row: Row) =>
      matches(
        {
          ...row,
          deletedAt: null,
          isCancelled: false,
          billingStatus: 'UNINVOICED',
        } as unknown as Record<string, unknown>,
        settleableInPeriod(FROM, TO) as Where,
      )
    expect(settle(CASES.deliveredEventIn!)).toBe(true)
    expect(settle(CASES.departedIn!)).toBe(true)
    expect(settle(CASES.departedButNotDelivered!)).toBe(false)
    expect(settle(CASES.inTransitEvent!)).toBe(false)
    expect(settle(CASES.deliveredBeforePodIn!)).toBe(false)
  })

  it('keeps the seats’ OR beside the delivery condition, not over it', () => {
    const where = settleableWhere('drv', FROM, TO)
    expect(where.OR).toEqual([{ driverId: 'drv' }, { coDriverId: 'drv' }])
    expect(where.AND).toEqual([deliveredBetween(FROM, TO)])
  })
})

describe('the preview classifies by delivery date', () => {
  const load = (over: Partial<PreviewLoad>): PreviewLoad => ({
    id: over.id ?? 'L',
    loadNumber: over.loadNumber ?? 'L',
    referenceNumber: null,
    operationalStatus: 'POD_RECEIVED',
    companyId: 'c',
    driverId: 'drv',
    linehaulCents: 100_000,
    fuelSurchargeCents: 0,
    accessorialsCents: 0,
    totalRevenueCents: 100_000,
    actualMiles: 500,
    dispatchedMiles: 500,
    company: { name: 'C' },
    driver: {
      firstName: 'A',
      lastName: 'B',
      payToName: null,
      driverType: 'COMPANY_DRIVER',
      payRules: [
        {
          id: 'r',
          type: 'PERCENT_LINEHAUL',
          percentBps: 3000,
          perMileCents: null,
          flatCents: null,
          effectiveFrom: d('2026-01-01T00:00:00Z'),
          effectiveTo: null,
        } as never,
      ],
    },
    stops: [],
    statusEvents: [],
    settlementLoadLines: [],
    ...over,
  })
  const deliveryStop = (departedAt: Date | null) => ({
    type: 'DELIVERY',
    scheduledAt: d('2026-11-10T00:00:00Z'),
    departedAt,
    city: 'X',
    state: 'Y',
    name: null,
  })

  it('places each trip by its delivery date, the last day whole', () => {
    const preview = previewFrom(
      [
        load({
          id: 'lastDayAfternoon',
          stops: [deliveryStop(d('2026-11-14T14:00:00Z'))],
          // The POD in the next week no longer moves it.
          statusEvents: [{ occurredAt: d('2026-11-16T09:00:00Z') }],
        }),
        load({
          id: 'deliveredNoPod',
          operationalStatus: 'DELIVERED',
          stops: [deliveryStop(null)],
          statusEvents: [{ occurredAt: d('2026-11-09T09:00:00Z') }],
        }),
        load({
          id: 'nextWeek',
          stops: [deliveryStop(d('2026-11-15T01:00:00Z'))],
        }),
        load({
          id: 'noDate',
          operationalStatus: 'DELIVERED',
          stops: [deliveryStop(null)],
        }),
        load({
          id: 'moving',
          operationalStatus: 'IN_TRANSIT',
          stops: [deliveryStop(null)],
        }),
      ],
      new Set(),
      { from: d('2026-11-08T00:00:00Z'), to: d('2026-11-14T00:00:00Z') },
    )
    expect(preview.available.map((t) => t.loadId).sort()).toEqual([
      'deliveredNoPod',
      'lastDayAfternoon',
    ])
    expect(preview.unavailable.outsideRange.map((t) => t.loadId)).toEqual([
      'nextWeek',
    ])
    expect(preview.unavailable.noDeliveryDate.map((t) => t.loadId)).toEqual([
      'noDate',
    ])
    expect(preview.unavailable.inTransit.map((t) => t.loadId)).toEqual([
      'moving',
    ])
  })

  it('the SQL twin reads the same two sources', () => {
    const sql = previewLoadsSql({
      from: Prisma.sql`NULL`,
      to: Prisma.sql`NULL`,
      companyId: Prisma.sql`NULL`,
    }).strings.join('?')
    expect(sql).toContain(`'departedAt', st."departedAt"`)
    expect(sql).toContain(`e."toStatus" IN ('DELIVERED', 'POD_RECEIVED')`)
    expect(sql).not.toContain(`e."toStatus" = 'POD_RECEIVED'`)
  })

  it('and the range is labelled Delivery date', () => {
    expect(
      readFileSync('src/app/(app)/payroll/batches/new/page.tsx', 'utf8'),
    ).toContain("label: t('preview.deliveryDate')")
  })
})
