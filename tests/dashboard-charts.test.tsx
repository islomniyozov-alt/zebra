/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { WeekBars } from '@/app/(app)/dashboard/WeekBars'
import { Donut } from '@/app/(app)/dashboard/Donut'
import { DayBars } from '@/app/(app)/dashboard/DayBars'
import { recentSundays, type WeekPoint } from '@/lib/dashboard-kpis'

// ---------------------------------------------------------------------------
// THE THREE CHARTS. §6.1.1's contract, asserted against a DOM.
//
// What a source check cannot see: whether a day with no freight is DRAWN, what
// a `<title>` actually says, and whether the hidden table carries the same
// figures as the shape. All three are claims about rendered output.
//
// ── NOTHING HERE ASSERTS A PIXEL ─────────────────────────────────────────
//
// Heights and offsets are geometry and would pin the design in place. What is
// asserted is PRESENCE, COUNT and TEXT — that thirteen bars exist, that an
// unsettled week is hatched rather than zeroed, that the remainder slice says
// how many it stands for. A restyle should not fail these; a missing week
// should.
// ---------------------------------------------------------------------------

afterEach(cleanup)

const SUNDAY = new Date(Date.UTC(2026, 8, 6))

const week = (over: Partial<WeekPoint> = {}): WeekPoint => ({
  weekStart: SUNDAY,
  grossCents: 100_000,
  driverPayCents: 30_000,
  marginCents: 70_000,
  loads: 4,
  miles: 1_000,
  ...over,
})

const weekLabels = {
  heading: 'Gross by week',
  week: 'Week',
  gross: 'Gross',
  afterDriverPay: 'After driver pay',
  notSettled: 'not settled in Zebra',
}

describe('WeekBars draws every week, including the empty ones', () => {
  it('draws thirteen bars for thirteen weeks with one week of freight', () => {
    const weeks = recentSundays(SUNDAY, 13).map((weekStart) =>
      weekStart.getTime() === SUNDAY.getTime()
        ? week()
        : week({
            weekStart,
            grossCents: 0,
            driverPayCents: 0,
            marginCents: 0,
            loads: 0,
            miles: 0,
          }),
    )
    const { container } = render(
      <WeekBars weeks={weeks} locale="en-US" labels={weekLabels} />,
    )

    // THIRTEEN ROWS IN THE TABLE, which is the readable rendering and the one
    // that must not silently drop a quiet week.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(13)
  })

  // AN UNSETTLED WEEK IS HATCHED, NOT ZEROED. A zero-height pay bar would say
  // that week's freight cost nothing to drive — §6.1.1 calls that the most
  // expensive wrong number on the page.
  it('hatches a week whose driver pay is unknown', () => {
    const { container } = render(
      <WeekBars
        weeks={[week({ driverPayCents: null, marginCents: null })]}
        locale="en-US"
        labels={weekLabels}
      />,
    )
    const hatched = container.querySelectorAll(
      'rect[fill="url(#zebra-unsettled)"]',
    )
    expect(hatched).toHaveLength(1)
  })

  it('and says so in the table rather than printing a figure', () => {
    render(
      <WeekBars
        weeks={[week({ driverPayCents: null, marginCents: null })]}
        locale="en-US"
        labels={weekLabels}
      />,
    )
    expect(screen.getByText('not settled in Zebra')).toBeTruthy()
  })

  it('draws no hatch and a pay bar where the week is settled', () => {
    const { container } = render(
      <WeekBars weeks={[week()]} locale="en-US" labels={weekLabels} />,
    )
    expect(
      container.querySelectorAll('rect[fill="url(#zebra-unsettled)"]'),
    ).toHaveLength(0)
    expect(screen.queryByText('not settled in Zebra')).toBeNull()
  })

  it('survives a quarter with no freight rather than dividing by zero', () => {
    const weeks = recentSundays(SUNDAY, 13).map((weekStart) =>
      week({
        weekStart,
        grossCents: 0,
        driverPayCents: 0,
        marginCents: 0,
        loads: 0,
        miles: 0,
      }),
    )
    const { container } = render(
      <WeekBars weeks={weeks} locale="en-US" labels={weekLabels} />,
    )
    expect(container.querySelectorAll('tbody tr')).toHaveLength(13)
  })
})

const donutLabels = {
  heading: 'Gross by authority',
  other: (count: number) => `Other (${String(count)})`,
  name: 'Authority',
  value: 'Gross',
  share: 'Share',
  empty: 'No freight delivered in this period.',
}

describe('Donut', () => {
  const slices = [
    { key: 'a', label: 'RAM Haulage', cents: 600_000 },
    { key: 'b', label: 'Dolphins', cents: 300_000 },
    { key: 'c', label: 'Midwest', cents: 100_000 },
  ]

  it('puts the figure and the share in each slice title', () => {
    const { container } = render(
      <Donut slices={slices} locale="en-US" labels={donutLabels} />,
    )
    const titles = [...container.querySelectorAll('title')].map(
      (node) => node.textContent ?? '',
    )
    expect(titles.some((text) => text.includes('RAM Haulage'))).toBe(true)
    expect(titles.some((text) => text.includes('$6,000.00'))).toBe(true)
    // 600,000 of 1,000,000.
    expect(titles.some((text) => text.includes('60.0%'))).toBe(true)
  })

  // THE TAIL IS SUMMED AND SAYS HOW MANY IT STANDS FOR. A chart that silently
  // dropped it would not add up to the KPI above it.
  it('folds everything past the top N into one named remainder', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      key: `k${String(index)}`,
      label: `Customer ${String(index)}`,
      cents: 100_000 - index * 1_000,
    }))
    render(<Donut slices={many} locale="en-US" labels={donutLabels} top={6} />)
    // Ten slices, six named, four folded.
    expect(screen.getAllByText('Other (4)').length).toBeGreaterThan(0)
  })

  // NEVER THE STATUS HUES (§3.3, §6.1.1). A red slice would say an authority is
  // in trouble when the only difference is how much it hauled.
  it('colours slices from the accent ramp, not the status palette', () => {
    const { container } = render(
      <Donut slices={slices} locale="en-US" labels={donutLabels} />,
    )
    const strokes = [...container.querySelectorAll('circle')].map((node) =>
      node.getAttribute('stroke'),
    )
    for (const stroke of strokes) {
      expect(stroke).not.toMatch(/danger|success|warning|progress/)
    }
    expect(strokes.some((stroke) => stroke === 'var(--color-accent)')).toBe(
      true,
    )

    // THE LEGEND SWATCHES TOO, and this was a gap `watch-guard` found: the
    // break that swapped the accent for danger landed on the legend's
    // `backgroundColor` and the suite stayed green, because this case read
    // circle strokes only. The palette rule is about what a reader SEES, and
    // the swatch is half of that.
    const swatches = [...container.querySelectorAll('li span[aria-hidden]')]
    expect(swatches.length).toBeGreaterThan(0)
    for (const swatch of swatches) {
      expect((swatch as HTMLElement).style.backgroundColor).not.toMatch(
        /danger|success|warning|progress/,
      )
    }
  })

  it('says what the panel is for when there is no revenue', () => {
    render(<Donut slices={[]} locale="en-US" labels={donutLabels} />)
    expect(
      screen.getByText('No freight delivered in this period.'),
    ).toBeTruthy()
    // NOT "No data available" (§14).
    expect(screen.queryByText(/No data available/i)).toBeNull()
  })

  it('drops a zero slice rather than drawing an invisible one', () => {
    const { container } = render(
      <Donut
        slices={[...slices, { key: 'z', label: 'Zero Co', cents: 0 }]}
        locale="en-US"
        labels={donutLabels}
      />,
    )
    expect(container.textContent).not.toContain('Zero Co')
  })
})

const dayLabels = {
  heading: 'Loads per day',
  day: 'Day',
  loads: 'Loads',
  empty: 'No freight delivered in this period.',
}

describe('DayBars draws the calendar, not the busy days', () => {
  // `dayRows` returns a row only for a day that had a delivery, so plotting the
  // rows alone would put Tuesday's bar where Thursday belongs.
  it('draws every day in the period, including the silent ones', () => {
    const { container } = render(
      <DayBars
        days={[{ day: new Date(Date.UTC(2026, 8, 8)), loads: 5 }]}
        period={{
          from: new Date(Date.UTC(2026, 8, 6)),
          to: new Date(Date.UTC(2026, 8, 13)),
        }}
        labels={dayLabels}
      />,
    )
    // Seven days, one with freight.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(7)
    expect(container.querySelectorAll('svg rect')).toHaveLength(7)
  })

  it('titles a silent day with a zero rather than leaving it unexplained', () => {
    const { container } = render(
      <DayBars
        days={[]}
        period={{
          from: new Date(Date.UTC(2026, 8, 6)),
          to: new Date(Date.UTC(2026, 8, 8)),
        }}
        labels={dayLabels}
      />,
    )
    const titles = [...container.querySelectorAll('title')].map(
      (node) => node.textContent ?? '',
    )
    expect(titles).toContain('2026-09-06 — 0')
  })

  it('marks the Sunday that opens each settlement week', () => {
    const { container } = render(
      <DayBars
        days={[]}
        period={{
          from: new Date(Date.UTC(2026, 8, 6)),
          to: new Date(Date.UTC(2026, 8, 20)),
        }}
        labels={dayLabels}
      />,
    )
    // 6th and 13th are Sundays; the 20th is excluded by the half-open window.
    expect(container.querySelectorAll('svg line')).toHaveLength(3)
  })

  it('caps an absurd window rather than drawing ten thousand bars', () => {
    const { container } = render(
      <DayBars
        days={[]}
        period={{
          from: new Date(Date.UTC(2020, 0, 1)),
          to: new Date(Date.UTC(2026, 0, 1)),
        }}
        labels={dayLabels}
      />,
    )
    expect(container.querySelectorAll('tbody tr').length).toBeLessThanOrEqual(
      120,
    )
  })
})
