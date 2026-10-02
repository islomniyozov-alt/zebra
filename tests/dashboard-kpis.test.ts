import { describe, expect, it } from 'vitest'
import {
  assembleDashboard,
  bucketsIn,
  grainFor,
  recentSundays,
  sundayOf,
  type WeekCompanyRow,
} from '@/lib/dashboard-kpis'

// ---------------------------------------------------------------------------
// THE DASHBOARD'S DERIVATIONS, WITHOUT A DATABASE.
//
// The SQL is covered in `tests/integration/dashboard-kpis.test.ts`, where it is
// run against real Postgres and required to agree with `by-company.ts` to the
// cent. What is covered HERE is the arithmetic on top of it, because that is
// where an off-by-one hides and a server component has a screen rather than a
// guard (flag 85).
//
// THE THING THAT SILENTLY GOES WRONG is the series: a week that earned nothing
// returns NO ROW, so a row-driven chart draws eleven points across thirteen
// weeks, labels none of them, and looks like a business with a quiet fortnight.
// ---------------------------------------------------------------------------

const SUNDAY = new Date(Date.UTC(2026, 8, 6)) // 2026-09-06 is a Sunday
const WEEK = 7 * 86_400_000

const row = (over: Partial<WeekCompanyRow> = {}): WeekCompanyRow => ({
  weekStart: SUNDAY,
  companyId: 'co-1',
  companyName: 'RAM Haulage',
  grossCents: 100_000,
  driverPayCents: 30_000,
  loads: 4,
  miles: 1_000,
  ...over,
})

const assemble = (
  rows: readonly WeekCompanyRow[],
  over: { weeks?: Date[]; payKnownFrom?: Date | null } = {},
) =>
  assembleDashboard({
    rows,
    customers: [],
    days: [],
    weeks: over.weeks ?? [SUNDAY],
    payKnownFrom:
      over.payKnownFrom === undefined ? new Date(0) : over.payKnownFrom,
    grain: 'week',
  })

describe('the settlement week boundary', () => {
  it('is Sunday, and a Sunday is its own week', () => {
    expect(sundayOf(SUNDAY).toISOString()).toBe(SUNDAY.toISOString())
  })

  it('takes a mid-week day back to the Sunday before it', () => {
    // Wednesday 2026-09-09.
    expect(sundayOf(new Date(Date.UTC(2026, 8, 9))).toISOString()).toBe(
      SUNDAY.toISOString(),
    )
  })

  it('takes a Saturday back to the same Sunday, not forward', () => {
    // THE OFF-BY-ONE THAT MATTERS. A Saturday belongs to the week that opened
    // six days ago; rounding it forward would move a load into a week that has
    // not started and make the latest point on the chart a week ahead.
    expect(sundayOf(new Date(Date.UTC(2026, 8, 12))).toISOString()).toBe(
      SUNDAY.toISOString(),
    )
  })

  it('gives thirteen consecutive weeks ending with the one asked for', () => {
    const weeks = recentSundays(new Date(Date.UTC(2026, 8, 9)), 13)
    expect(weeks).toHaveLength(13)
    expect(weeks[12]?.toISOString()).toBe(SUNDAY.toISOString())
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i]!.getTime() - weeks[i - 1]!.getTime()).toBe(WEEK)
    }
  })
})

describe('the series shows the weeks that earned nothing', () => {
  it('plots every requested week, not every week with a row', () => {
    const weeks = recentSundays(SUNDAY, 13)
    const board = assemble([row()], { weeks })

    expect(board.weeks).toHaveLength(13)
    // Twelve empty, one with freight — and the empty ones are zero rather than
    // absent, so the chart has thirteen points to draw.
    expect(board.weeks.filter((w) => w.loads === 0)).toHaveLength(12)
    expect(board.weeks.at(-1)?.loads).toBe(4)
  })

  it('keeps them in order, oldest first', () => {
    const weeks = recentSundays(SUNDAY, 5)
    const board = assemble([], { weeks })
    const times = board.weeks.map((w) => w.weekStart.getTime())
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})

describe('a row outside the plotted weeks still counts in the totals', () => {
  // THE WINDOW IS THE WINDOW. Dropping freight from the KPI strip because it
  // fell either side of a generated Sunday would make the strip disagree with
  // the chart beneath it, and the strip is the number somebody quotes.
  it('is in the KPIs and not in the series', () => {
    const outside = row({ weekStart: new Date(SUNDAY.getTime() - 20 * WEEK) })
    const board = assemble([row(), outside], { weeks: [SUNDAY] })

    expect(board.kpis.grossCents).toBe(200_000)
    expect(board.kpis.loads).toBe(8)
    expect(board.weeks).toHaveLength(1)
    expect(board.weeks[0]?.loads).toBe(4)
  })
})

describe('driver pay before Zebra settled anything is UNKNOWN, not zero', () => {
  // `by-company.ts` says it hardest: "a zero would read as 'this freight cost
  // nothing to drive', which is the most expensive wrong number this page
  // could print." Measured on dev: gross $2,755,782.16 against $184,774.65 of
  // recorded pay, because 13,517 loads were paid in Datatruck.
  it('nulls the KPI when the period opens before the first FINAL batch', () => {
    const board = assemble([row()], {
      payKnownFrom: new Date(SUNDAY.getTime() + WEEK),
    })
    expect(board.kpis.grossCents).toBe(100_000)
    expect(board.kpis.driverPayCents).toBeNull()
    expect(board.kpis.marginCents).toBeNull()
  })

  it('and reports it where the whole period is settled', () => {
    const board = assemble([row()], { payKnownFrom: SUNDAY })
    expect(board.kpis.driverPayCents).toBe(30_000)
    expect(board.kpis.marginCents).toBe(70_000)
  })

  it('nulls it when there has never been a FINAL batch at all', () => {
    const board = assemble([row()], { payKnownFrom: null })
    expect(board.kpis.driverPayCents).toBeNull()
    expect(board.kpis.marginCents).toBeNull()
  })

  // PER WEEK, so a thirteen-week chart spanning the boundary shows real
  // figures after it and dashes before — rather than one verdict over
  // everything.
  it('decides week by week, not once for the chart', () => {
    const weeks = [SUNDAY, new Date(SUNDAY.getTime() + WEEK)]
    const board = assemble([row(), row({ weekStart: weeks[1]! })], {
      weeks,
      payKnownFrom: weeks[1]!,
    })
    expect(board.weeks[0]?.driverPayCents).toBeNull()
    expect(board.weeks[0]?.marginCents).toBeNull()
    expect(board.weeks[1]?.driverPayCents).toBe(30_000)
    expect(board.weeks[1]?.marginCents).toBe(70_000)
  })

  // AND THE GROSS IS NEVER NULLED. Item 7's rule: closed history counts, the
  // carrier earned it. Only the pay is unknown.
  it('still reports gross for an unsettled week', () => {
    const board = assemble([row()], { payKnownFrom: null })
    expect(board.kpis.grossCents).toBe(100_000)
    expect(board.weeks[0]?.grossCents).toBe(100_000)
  })
})

describe('cents per mile', () => {
  it('is gross over miles, rounded', () => {
    const board = assemble([row({ grossCents: 100_000, miles: 300 })])
    expect(board.kpis.centsPerMile).toBe(333)
  })

  it('is NULL with no miles, never zero', () => {
    // Zero reads as "this freight earned nothing per mile", a claim about the
    // rate. No miles recorded is a claim about the data (§8).
    const board = assemble([row({ miles: 0 })])
    expect(board.kpis.centsPerMile).toBeNull()
  })

  it('is null for an empty period rather than a division by zero', () => {
    expect(assemble([]).kpis.centsPerMile).toBeNull()
  })
})

describe('by company', () => {
  it('sums a company across weeks and sorts by gross', () => {
    const board = assemble(
      [
        row({ companyId: 'co-1', companyName: 'RAM', grossCents: 10_000 }),
        row({
          companyId: 'co-1',
          companyName: 'RAM',
          grossCents: 10_000,
          weekStart: new Date(SUNDAY.getTime() - WEEK),
        }),
        row({ companyId: 'co-2', companyName: 'Dolphins', grossCents: 50_000 }),
      ],
      { weeks: recentSundays(SUNDAY, 13) },
    )

    expect(board.byCompany.map((c) => c.companyName)).toEqual([
      'Dolphins',
      'RAM',
    ])
    expect(board.byCompany[1]?.grossCents).toBe(20_000)
    expect(board.byCompany[1]?.loads).toBe(8)
  })
})

// ── THE PICKER DRIVES THE GRANULARITY (owner ruling 2026-10-02) ────────────
//
// v10.14 let the bars show thirteen weeks whatever the picker said. On the
// screen that meant a quarter of bars beside a month of donuts — one dashboard
// saying two things — and the permission was revoked.
describe('the grain follows the window, not the preset name', () => {
  const win = (from: Date, to: Date) => ({ from, to })

  it('a week of days', () => {
    expect(
      grainFor(
        win(new Date(Date.UTC(2026, 8, 6)), new Date(Date.UTC(2026, 8, 13))),
      ),
    ).toBe('day')
  })

  it('a month of days', () => {
    expect(
      grainFor(
        win(new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 9, 1))),
      ),
    ).toBe('day')
  })

  it('a quarter of weeks', () => {
    expect(
      grainFor(
        win(new Date(Date.UTC(2026, 6, 1)), new Date(Date.UTC(2026, 9, 1))),
      ),
    ).toBe('week')
  })

  it('a year to date of weeks', () => {
    expect(
      grainFor(
        win(new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 9, 2))),
      ),
    ).toBe('week')
  })

  // THE SPAN, NOT THE LABEL. "This quarter" on its second day is two days long,
  // and two days deserve daily bars — one lonely weekly bar on the 2nd of
  // October is the shape that started this review.
  it('gives a two-day-old quarter daily bars, despite its name', () => {
    expect(
      grainFor(
        win(new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 3))),
      ),
    ).toBe('day')
  })
})

describe('bucketsIn generates the axis, including the empty buckets', () => {
  it('gives one bucket per day', () => {
    const buckets = bucketsIn(
      {
        from: new Date(Date.UTC(2026, 9, 1)),
        to: new Date(Date.UTC(2026, 9, 8)),
      },
      'day',
    )
    expect(buckets).toHaveLength(7)
  })

  // A WEEKLY AXIS STARTS ON THE SUNDAY THAT CONTAINS THE PERIOD'S OPEN DAY,
  // because that is the bucket SQL grouped the freight into. Starting on the
  // period's own Wednesday would leave that week's row with nowhere to land.
  it('snaps a weekly axis back to the Sunday the period opens inside', () => {
    // 2026-10-01 is a Thursday; the week opened Sunday 2026-09-27.
    const buckets = bucketsIn(
      {
        from: new Date(Date.UTC(2026, 9, 1)),
        to: new Date(Date.UTC(2026, 9, 20)),
      },
      'week',
    )
    expect(buckets[0]?.toISOString().slice(0, 10)).toBe('2026-09-27')
  })

  it('caps an absurd window rather than generating thousands', () => {
    const buckets = bucketsIn(
      {
        from: new Date(Date.UTC(1990, 0, 1)),
        to: new Date(Date.UTC(2026, 0, 1)),
      },
      'day',
    )
    expect(buckets.length).toBeLessThanOrEqual(400)
  })
})
