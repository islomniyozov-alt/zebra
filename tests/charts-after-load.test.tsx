/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { cleanup, render, screen } from '@testing-library/react'
import {
  BarChartAfterLoad,
  DayBarsAfterLoad,
  DonutAfterLoad,
} from '@/app/(app)/_charts/AfterLoad'

// ---------------------------------------------------------------------------
// THE DASHBOARD'S CHARTS, DRAWN IN THE BROWSER (§6.1.1 v11.05).
//
// Two claims, each about output: the SERVER renders a slot — the heading and
// nothing of the chart's tree, no bars, no tooltips, no hidden table — and
// the BROWSER draws the whole chart once mounted, with the same figures. And
// the dashboard imports the charts through these wrappers, not directly.
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
const bars = [
  {
    key: 'w1',
    label: 'Sep 6',
    detail: 'Sep 6 – Sep 12',
    grossCents: 1_234_567,
    driverPayCents: 400_000,
    marginCents: 834_567,
    loads: 7,
  },
]
const donutLabels = {
  heading: 'Gross by customer',
  other: 'Other',
  name: 'Customer',
  value: 'Gross',
  share: 'Share',
  empty: 'No revenue',
}
const slices = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((name, index) => ({
  key: name,
  label: `Customer ${name}`,
  cents: (10 - index) * 10_000,
}))
const dayLabels = {
  heading: 'Loads delivered per day',
  day: 'Day',
  loads: 'Loads',
  empty: 'None',
}
const period = {
  from: new Date(Date.UTC(2026, 8, 1)),
  to: new Date(Date.UTC(2026, 8, 4)),
}
const days = [{ day: new Date(Date.UTC(2026, 8, 2)), loads: 3 }]

describe('on the server, a slot under the heading and nothing of the chart', () => {
  it('weekly bars', () => {
    const html = renderToString(
      <BarChartAfterLoad bars={bars} locale="en-US" labels={barLabels} />,
    )
    expect(html).toContain('Gross by week')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('role="tooltip"')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('12,345.67')
  })

  it('donut and daily strip', () => {
    const html = renderToString(
      <>
        <DonutAfterLoad slices={slices} locale="en-US" labels={donutLabels} />
        <DayBarsAfterLoad days={days} period={period} labels={dayLabels} />
      </>,
    )
    expect(html).toContain('Gross by customer')
    expect(html).toContain('Loads delivered per day')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('Customer A')
  })
})

describe('in the browser, the whole chart', () => {
  it('weekly bars, with the tooltip and the hidden table', () => {
    const { container } = render(
      <BarChartAfterLoad bars={bars} locale="en-US" labels={barLabels} />,
    )
    expect(container.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(screen.getAllByText('$12,345.67').length).toBeGreaterThan(0)
  })

  it('donut, whose remainder still says how many it stands for', () => {
    render(
      <DonutAfterLoad slices={slices} locale="en-US" labels={donutLabels} />,
    )
    expect(screen.getAllByText('Customer A').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^Other \(\d+\)$/).length).toBeGreaterThan(0)
  })

  it('daily strip, a column per day', () => {
    const { container } = render(
      <DayBarsAfterLoad days={days} period={period} labels={dayLabels} />,
    )
    expect(container.querySelectorAll('rect')).toHaveLength(3)
  })
})

describe('the dashboard draws its charts through the wrappers', () => {
  it('imports none of the three charts directly', () => {
    const page = readFileSync('src/app/(app)/dashboard/page.tsx', 'utf8')
    expect(page).toContain("from '../_charts/AfterLoad'")
    expect(page).not.toMatch(/from '\.\.\/_charts\/(BarChart|Donut|DayBars)'/)
    expect(page).toMatch(/<BarChartAfterLoad/)
    expect(page.match(/<DonutAfterLoad/g) ?? []).toHaveLength(2)
    expect(page).toMatch(/<DayBarsAfterLoad/)
  })
})
