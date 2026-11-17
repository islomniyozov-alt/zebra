import type { ReactNode } from 'react'
import { cx } from '@/lib/cx'

// ---------------------------------------------------------------------------
// §7.13 — THE PIECES OF THE AMAZON LOAD DETAIL, IN DATATRUCK'S SHAPE.
//
// Server components that lay out what the page has already decided. Every
// value arrives translated and formatted; none of these reads a status, a
// permission or a figure. The step comes from `trackerStep`, the legs from
// `tripsFromStops`, the profit from `profitBox` — all in `src/lib/`, where they
// are tested — and a money prop is simply absent for a role that may not see
// it, so nothing here can render a figure that should not have been sent.
// ---------------------------------------------------------------------------

/** One card with a title, the same frame as every other panel on the page. */
export function DetailCard({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cx(
        'rounded-card border border-border bg-surface p-z4',
        className,
      )}
    >
      <h2 className="text-md font-medium text-ink">{title}</h2>
      <div className="mt-z3">{children}</div>
    </section>
  )
}

/** Label over value, in a grid — the three cards' and the second row's form. */
export function FactGrid({
  facts,
  columns = 2,
}: {
  facts: readonly { label: string; value: ReactNode }[]
  columns?: 1 | 2 | 3
}) {
  return (
    <dl
      className={cx(
        'grid gap-x-z4 gap-y-z3',
        columns === 3
          ? 'grid-cols-3'
          : columns === 1
            ? 'grid-cols-1'
            : 'grid-cols-2',
      )}
    >
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-xs text-ink-3">{fact.label}</dt>
          <dd className="mt-z1 truncate text-sm font-medium text-ink">
            {fact.value ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Eight numbered steps. `step` is 1 to 8, from `trackerStep`.
 *
 * REACHED, NOT "COMPLETED" — the five-stage strip's rule: the current step is
 * reached and not finished, so the line fills up to and including it. The
 * current step's ring is the non-colour cue for "you are here".
 */
export function TrackerSteps({
  step,
  cancelled,
  labels,
}: {
  step: number
  cancelled: boolean
  labels: { title: string; cancelled: string; steps: readonly string[] }
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <div className="flex items-baseline justify-between gap-z3">
        <h2 className="sr-only">{labels.title}</h2>
        {cancelled ? (
          <span className="text-xs uppercase tracking-[0.04em] text-muted">
            {labels.cancelled}
          </span>
        ) : null}
      </div>
      <ol data-tracker className="flex items-start">
        {labels.steps.map((word, index) => {
          const number = index + 1
          const reached = !cancelled && number <= step
          const current = !cancelled && number === step
          return (
            <li
              key={word}
              className="relative flex flex-1 flex-col items-center gap-z2 text-center"
              {...(current ? { 'aria-current': 'step' as const } : {})}
            >
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={cx(
                    'absolute top-[15px] h-[3px] w-full -translate-x-1/2',
                    'start-0',
                    reached ? 'bg-progress' : 'bg-surface-3',
                  )}
                />
              ) : null}
              {/* ABOVE THE BARS, z-10 (owner's report 2026-11-17: "digits 1–6
               * render mirrored / upside down"). There was no transform: each
               * step's bar is absolute and comes LATER in the DOM than the
               * circle to its start, so it painted a 3 px line in the same
               * blue straight through that digit. scripts/tracker-render.mjs
               * holds every digit as the topmost element at its own centre. */}
              <span
                data-tracker-step
                className={cx(
                  'relative z-10 flex size-[32px] items-center justify-center rounded-full text-sm font-medium tabular-nums',
                  reached
                    ? 'bg-progress text-surface'
                    : 'bg-surface-3 text-ink-2',
                  current ? 'ring-2 ring-progress ring-offset-2' : null,
                )}
              >
                {number}
              </span>
              <span
                className={cx(
                  'text-xs',
                  current
                    ? 'font-medium text-ink'
                    : reached
                      ? 'text-ink-2'
                      : 'text-ink-3',
                )}
              >
                {word}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export interface AmazonStopRow {
  id: string
  position: string
  facility: string
  place: string | null
  zip: string | null
  window: string
  /** The actuals beside the plan — the portal's taps and the office write them. */
  arrived: string
  departed: string
  address: ReactNode
}

/**
 * Stops as a table: position, facility code, city/state, zip, the appointment
 * window, and Arrived / Departed beside it — scheduled against actual, read
 * across one row.
 */
export function AmazonStops({
  stops,
  labels,
}: {
  stops: readonly AmazonStopRow[]
  labels: {
    title: string
    position: string
    facility: string
    place: string
    zip: string
    window: string
    arrived: string
    departed: string
    address: string
    empty: string
  }
}) {
  const headings = [
    labels.position,
    labels.facility,
    labels.place,
    labels.zip,
    labels.window,
    labels.arrived,
    labels.departed,
    labels.address,
  ]
  return (
    <DetailCard title={labels.title}>
      {stops.length === 0 ? (
        <p className="text-sm text-ink-2">{labels.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                {headings.map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="whitespace-nowrap px-z2 pb-z2 text-start text-xs font-medium uppercase tracking-[0.04em] text-ink-3"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stops.map((stop) => (
                <tr
                  key={stop.id}
                  className="border-b border-border align-top last:border-b-0"
                >
                  <td className="whitespace-nowrap px-z2 py-z2 text-xs uppercase tracking-[0.04em] text-ink-2">
                    {stop.position}
                  </td>
                  <td className="whitespace-nowrap px-z2 py-z2 font-mono text-ink">
                    {stop.facility}
                  </td>
                  <td className="px-z2 py-z2 text-ink">{stop.place ?? '—'}</td>
                  <td className="whitespace-nowrap px-z2 py-z2 font-mono tabular-nums text-ink">
                    {stop.zip ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-z2 py-z2 font-mono tabular-nums text-ink">
                    {stop.window}
                  </td>
                  <td className="whitespace-nowrap px-z2 py-z2 font-mono tabular-nums text-ink">
                    {stop.arrived}
                  </td>
                  <td className="whitespace-nowrap px-z2 py-z2 font-mono tabular-nums text-ink">
                    {stop.departed}
                  </td>
                  <td className="px-z2 py-z2">{stop.address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DetailCard>
  )
}

export interface TripRow {
  key: string
  tripId: ReactNode
  status: ReactNode
  pickup: string
  delivery: string
  driver: string | null
  truck: string | null
  trailer: string | null
  /** Absent for a role without `load.financials`; '—' before a statement. */
  driverGross?: string
}

/** The Relay legs: Trip ID, status, pickup, delivery, crew, driver gross. */
export function TripsTable({
  trips,
  showDriverGross,
  labels,
}: {
  trips: readonly TripRow[]
  showDriverGross: boolean
  labels: {
    title: string
    tripId: string
    status: string
    pickup: string
    delivery: string
    driver: string
    truck: string
    trailer: string
    driverGross: string
  }
}) {
  const headings = [
    labels.tripId,
    labels.status,
    labels.pickup,
    labels.delivery,
    labels.driver,
    labels.truck,
    labels.trailer,
    ...(showDriverGross ? [labels.driverGross] : []),
  ]
  return (
    <DetailCard title={labels.title}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              {headings.map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="whitespace-nowrap px-z2 pb-z2 text-start text-xs font-medium uppercase tracking-[0.04em] text-ink-3"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trips.map((trip) => (
              <tr
                key={trip.key}
                className="border-b border-border align-top last:border-b-0"
              >
                <td className="whitespace-nowrap px-z2 py-z2 font-mono text-ink">
                  {trip.tripId}
                </td>
                <td className="whitespace-nowrap px-z2 py-z2">{trip.status}</td>
                <td className="px-z2 py-z2 text-ink">{trip.pickup}</td>
                <td className="px-z2 py-z2 text-ink">{trip.delivery}</td>
                <td className="px-z2 py-z2 text-ink">{trip.driver ?? '—'}</td>
                <td className="whitespace-nowrap px-z2 py-z2 font-mono text-ink">
                  {trip.truck ?? '—'}
                </td>
                <td className="whitespace-nowrap px-z2 py-z2 font-mono text-ink">
                  {trip.trailer ?? '—'}
                </td>
                {showDriverGross ? (
                  <td className="whitespace-nowrap px-z2 py-z2 text-end font-mono tabular-nums text-ink">
                    {trip.driverGross ?? '—'}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DetailCard>
  )
}

/**
 * Revenue, accessorials, driver pay, gross profit, margin — every figure
 * formatted by the page from `profitBox`. Rendered only for a role with
 * `load.financials`; the page does not build it otherwise.
 */
export function ProfitBoxCard({
  rows,
  title,
}: {
  rows: readonly { label: string; value: string; strong?: boolean }[]
  title: string
}) {
  return (
    <DetailCard title={title}>
      <dl className="flex flex-col gap-z2">
        {rows.map((row) => (
          <div
            key={row.label}
            className={cx(
              'flex items-baseline justify-between gap-z3',
              row.strong ? 'border-t border-border pt-z2' : null,
            )}
          >
            <dt
              className={cx(
                'text-sm',
                row.strong ? 'font-medium text-ink' : 'text-ink-2',
              )}
            >
              {row.label}
            </dt>
            <dd
              className={cx(
                'font-mono text-sm tabular-nums',
                row.strong ? 'font-medium text-ink' : 'text-ink',
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </DetailCard>
  )
}
