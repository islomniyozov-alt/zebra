/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BarChart, type Bar } from '@/app/(app)/dashboard/BarChart'
import { Sparkline } from '@/app/(app)/dashboard/Sparkline'
import { Donut } from '@/app/(app)/dashboard/Donut'
import { DayBars } from '@/app/(app)/dashboard/DayBars'

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

const barLabels = {
  heading: 'Gross by week',
  gross: 'Gross',
  driverPay: 'Driver pay',
  unrecorded: 'driver pay not yet recorded in Zebra',
  afterDriverPay: 'After driver pay',
  loads: 'Loads',
  empty: 'No freight delivered in this period.',
  bucket: 'Week',
  partial: 'week still running',
}

const bar = (over: Partial<Bar> = {}): Bar => ({
  key: '2026-09-06',
  label: 'Sep 6',
  detail: 'Sep 6 – Sep 12',
  grossCents: 1_240_000,
  driverPayCents: 300_000,
  marginCents: 940_000,
  loads: 4,
  ...over,
})

describe('BarChart owes the reader four things (owner review 2026-10-02)', () => {
  // 1 — A LEGEND, IN WORDS. "No chart ships without one."
  it('names every series in words, including what the hatch means', () => {
    render(<BarChart bars={[bar()]} locale="en-US" labels={barLabels} />)
    // getAllByText, NOT getByText: each label appears in the legend AND in the
    // hidden table's header, which is correct — both are renderings of the same
    // series — so the assertion is about presence rather than uniqueness.
    expect(screen.getAllByText('Gross').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Driver pay').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('driver pay not yet recorded in Zebra').length,
    ).toBeGreaterThan(0)
  })

  // 2 — THE VALUE ABOVE EACH BAR, abbreviated as the ruling asked ($12.4k).
  it('prints the value above the bar', () => {
    // SCOPED TO THE BAR, not to the document. `$12.4k` also appears as the top
    // y-axis tick, because the scale's peak IS this bar — so a document-wide
    // assertion passed with the bar label deleted, and `watch-guard` refused
    // the break that deleted it. The question is whether the BAR carries its
    // value, so the query asks the bar.
    const { container } = render(
      <BarChart bars={[bar()]} locale="en-US" labels={barLabels} />,
    )
    const columns = container.querySelectorAll('ol li')
    expect(columns.length).toBeGreaterThan(0)
    const onTheBar = [...columns].some((node) =>
      (node.textContent ?? '').includes('$12.4k'),
    )
    expect(onTheBar).toBe(true)
  })

  it('and the period label below it', () => {
    render(<BarChart bars={[bar()]} locale="en-US" labels={barLabels} />)
    expect(screen.getByText('Sep 6')).toBeTruthy()
  })

  // THE GRIDLINES AND THEIR MONEY TICKS.
  it('draws gridlines with money ticks', () => {
    const { container } = render(
      <BarChart bars={[bar()]} locale="en-US" labels={barLabels} />,
    )
    // Five ticks for four intervals, top down.
    const axis = container.querySelectorAll('ul li')
    expect(axis.length).toBeGreaterThanOrEqual(5)
    expect(screen.getByText('$0.00')).toBeTruthy()
  })

  // 3 — A VISIBLE TOOLTIP, not only a <title>. It carries all five figures.
  it('carries a real tooltip element with week, gross, pay, margin and loads', () => {
    const { container } = render(
      <BarChart bars={[bar()]} locale="en-US" labels={barLabels} />,
    )
    const tip = container.querySelector('[role="tooltip"]')
    expect(tip).toBeTruthy()
    const text = tip?.textContent ?? ''
    expect(text).toContain('Sep 6 – Sep 12')
    expect(text).toContain('$12,400.00')
    expect(text).toContain('$3,000.00')
    expect(text).toContain('$9,400.00')
    expect(text).toContain('4')
  })

  it('reveals the tooltip by CSS, with no script', () => {
    const { container } = render(
      <BarChart bars={[bar()]} locale="en-US" labels={barLabels} />,
    )
    const tip = container.querySelector('[role="tooltip"]')
    // HIDDEN BY DEFAULT, SHOWN ON HOVER — and `group-hover` is the mechanism,
    // so a reviewer can see there is no event handler anywhere.
    expect(tip?.className).toContain('hidden')
    expect(tip?.className).toContain('group-hover:block')
  })

  // THE HATCH, AND NO ZERO-HEIGHT PAY BAR.
  it('hatches a bucket whose driver pay was never recorded', () => {
    const { container } = render(
      <BarChart
        bars={[bar({ driverPayCents: null, marginCents: null })]}
        locale="en-US"
        labels={barLabels}
      />,
    )
    const hatched = [...container.querySelectorAll('span')].filter((node) =>
      (node as HTMLElement).style.backgroundImage.includes(
        'repeating-linear-gradient',
      ),
    )
    // The bar itself plus the legend swatch.
    expect(hatched.length).toBeGreaterThanOrEqual(2)
  })

  it('and its tooltip says so rather than printing a zero', () => {
    const { container } = render(
      <BarChart
        bars={[bar({ driverPayCents: null, marginCents: null })]}
        locale="en-US"
        labels={barLabels}
      />,
    )
    const text = container.querySelector('[role="tooltip"]')?.textContent ?? ''
    expect(text).toContain('—')
    expect(text).not.toContain('$0.00')
  })

  // 4 — AN EMPTY PERIOD KEEPS ITS AXIS AND LEGEND. Never a blank panel.
  it('keeps the legend and the ticks when nothing was delivered', () => {
    render(<BarChart bars={[]} locale="en-US" labels={barLabels} />)
    expect(
      screen.getByText('No freight delivered in this period.'),
    ).toBeTruthy()
    // The legend survives.
    expect(screen.getAllByText('Gross').length).toBeGreaterThan(0)
    // And so does the axis: five ticks, all $0.00 at a zero scale.
    expect(screen.getAllByText('$0.00').length).toBeGreaterThanOrEqual(5)
    // NOT "No data available" (§14).
    expect(screen.queryByText(/No data available/i)).toBeNull()
  })

  it('shows one bar per bucket, including the empty ones', () => {
    const bars = [
      bar({ key: 'a', label: 'Sep 6' }),
      bar({ key: 'b', label: 'Sep 13', grossCents: 0, loads: 0 }),
      bar({ key: 'c', label: 'Sep 20' }),
    ]
    const { container } = render(
      <BarChart bars={bars} locale="en-US" labels={barLabels} />,
    )
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(screen.getByText('Sep 13')).toBeTruthy()
  })
})

describe('Sparkline', () => {
  it('draws one column per bucket', () => {
    const { container } = render(
      <Sparkline points={[1, 2, 3, 4]} label="Gross" />,
    )
    expect(container.querySelectorAll('span')).toHaveLength(4)
  })

  // A NULL IS A GAP. A bucket whose pay was never recorded must not draw a bar
  // at the floor — that is a cliff that never happened.
  it('leaves a gap for a bucket that was never recorded', () => {
    const { container } = render(
      <Sparkline points={[100, null, 100]} label="Driver pay" />,
    )
    const columns = [...container.querySelectorAll('span')]
    expect(columns).toHaveLength(3)
    expect((columns[1] as HTMLElement).style.height).toBe('0px')
    expect((columns[1] as HTMLElement).style.opacity).toBe('0')
  })

  it('still renders a baseline with no points at all', () => {
    const { container } = render(<Sparkline points={[]} label="Gross" />)
    expect(container.querySelectorAll('span')).toHaveLength(1)
  })

  it('names what the shape is of, for a reader who cannot see it', () => {
    render(<Sparkline points={[1, 2]} label="Miles" />)
    expect(screen.getByRole('img', { name: 'Miles' })).toBeTruthy()
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

// ── THE PARTIAL CURRENT BUCKET (owner ruling 2026-10-02) ───────────────────
//
// Every window ends with the current settlement week, drawn as far as today. So
// the last bar is short because the week is unfinished — and a reader comparing
// it to the twelve beside it sees a decline that did not happen.
//
// IT IS DRAWN AND MARKED, not hidden: the freight is real and belongs in the
// total. Same family of lie as a zero-height driver-pay bar, same treatment.
describe('the partial current bucket is marked, not hidden', () => {
  it('still draws its bar, because the freight is real', () => {
    const { container } = render(
      <BarChart
        bars={[bar({ partial: true })]}
        locale="en-US"
        labels={barLabels}
      />,
    )
    const filled = [...container.querySelectorAll('ol li span')].filter(
      (node) => (node as HTMLElement).style.height.endsWith('%'),
    )
    expect(filled.length).toBeGreaterThan(0)
  })

  it('marks it so it is not read as a decline', () => {
    const { container } = render(
      <BarChart
        bars={[bar({ partial: true })]}
        locale="en-US"
        labels={barLabels}
      />,
    )
    const dashed = container.querySelector('.border-dashed')
    expect(dashed).toBeTruthy()
  })

  it('and says why on hover', () => {
    const { container } = render(
      <BarChart
        bars={[bar({ partial: true })]}
        locale="en-US"
        labels={barLabels}
      />,
    )
    const tip = container.querySelector('[role="tooltip"]')?.textContent ?? ''
    expect(tip).toContain('week still running')
  })

  it('and marks nothing when the bucket is complete', () => {
    const { container } = render(
      <BarChart bars={[bar()]} locale="en-US" labels={barLabels} />,
    )
    expect(container.querySelector('.border-dashed')).toBeNull()
    const tip = container.querySelector('[role="tooltip"]')?.textContent ?? ''
    expect(tip).not.toContain('week still running')
  })
})
