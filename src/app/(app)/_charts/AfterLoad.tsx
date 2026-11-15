'use client'

import { useSyncExternalStore, type ComponentProps } from 'react'
import { BarChart } from './BarChart'
import { DayBars } from './DayBars'
import { Donut } from './Donut'

// ---------------------------------------------------------------------------
// THE DASHBOARD'S CHARTS ARE DRAWN IN THE BROWSER, FROM THEIR FIGURES
// (§6.1.1 v11.05; owner's instruction 2026-11-15, GAPS 42).
//
// Measured on dev, one ray: /dashboard's HTML was 221 KB, and the Worker spent
// ~400 ms of CPU rendering it — more than the page's four statements took. A
// server-rendered chart is paid TWICE in that document: once as markup and
// once as the RSC payload that repeats the server tree as JSON. The weekly
// bars alone were 22 KB of markup (thirteen hover tooltips), the daily strip
// 17 KB, the donuts 6 KB.
//
// So each chart here is a client component that the server renders as a slot
// of the chart's height, heading included, and the browser draws once
// hydrated. What crosses the wire is the chart's FIGURES — its props — not its
// tree. The charts themselves are unchanged and still render on the server
// wherever a page imports them directly (`/accounting/reports`, the tests).
//
// NOTHING ANIMATES (§14): the chart appears whole, in the space the slot held.
// ---------------------------------------------------------------------------

const subscribe = () => () => {}

/** False on the server and during hydration, true once the browser has it. */
function useInBrowser(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}

/** The chart's heading over the height the chart will take. */
function Slot({ heading, height }: { heading: string; height: number }) {
  return (
    <div aria-busy="true">
      <h3 className="text-sm font-medium text-ink">{heading}</h3>
      <div style={{ blockSize: `${String(height)}px` }} />
    </div>
  )
}

export function BarChartAfterLoad(props: ComponentProps<typeof BarChart>) {
  return useInBrowser() ? (
    <BarChart {...props} />
  ) : (
    // The plot (180), the axis labels and the legend under them.
    <Slot heading={props.labels.heading} height={234} />
  )
}

export function DayBarsAfterLoad(props: ComponentProps<typeof DayBars>) {
  return useInBrowser() ? (
    <DayBars {...props} />
  ) : (
    // The legend, the strip (96) and the two end dates.
    <Slot heading={props.labels.heading} height={148} />
  )
}

type DonutProps = ComponentProps<typeof Donut>

/**
 * `labels.other` is a WORD here, not a function: a function cannot cross from
 * a server component to a client one. The remainder slice reads
 * "<word> (<count>)", which is what the page's function said.
 */
export function DonutAfterLoad({
  labels,
  ...props
}: Omit<DonutProps, 'labels'> & {
  labels: Omit<DonutProps['labels'], 'other'> & { other: string }
}) {
  return useInBrowser() ? (
    <Donut
      {...props}
      labels={{
        ...labels,
        other: (count) => `${labels.other} (${String(count)})`,
      }}
    />
  ) : (
    // The 120-pixel ring beside its legend.
    <Slot heading={labels.heading} height={128} />
  )
}
