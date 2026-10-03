import Link from 'next/link'
import { formatCents } from '@/lib/money'
import { ChartLegend } from '../_charts/ChartLegend'
import { AgingBar } from '../_charts/AgingBar'
import type { DriverGrossRow, PanelFigures } from '@/lib/dashboard-counts'

// ---------------------------------------------------------------------------
// THE FLEET, CASH AND COMPLIANCE PANELS. Dashboard part 3, §6.1.1.
//
// THREE EXPORTS IN ONE FILE, deliberately: they are three siblings of one page
// that share a tile, a bar and a legend between them, and three files would
// have meant three copies of each or a fourth file holding them. Nothing here
// is reusable outside this page.
//
// ── THE PART-2B RULES APPLY TO ALL THREE ─────────────────────────────────
//
// A legend in words, a value on every bar, the same figures as a visually
// hidden table, and an empty state that keeps the axis and the legend. HTML and
// CSS, no client JavaScript, nothing that can animate (§14).
// ---------------------------------------------------------------------------

/** `$12.4k` for a bar label. Exact figures live in the tables (§8). */
function compact(cents: number, locale: string): string {
  const dollars = cents / 100
  if (Math.abs(dollars) >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(1)}m`
  }
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`
  return formatCents(cents, locale)
}

/** One plain number with a label. §14 forbids the gradient hero card. */
function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-border bg-surface-2 p-z3">
      <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
        {label}
      </dt>
      <dd className="mt-z1 font-mono text-lg tabular-nums text-ink">
        {value.toLocaleString()}
      </dd>
    </div>
  )
}

// ── FLEET ──────────────────────────────────────────────────────────────────

export function FleetPanel({
  fleet,
  drivers,
  locale,
  labels,
}: {
  fleet: PanelFigures['fleet']
  /**
   * NULL FOR A ROLE WITHOUT `load.financials`, and the bars are then absent
   * rather than empty.
   *
   * §6.1.1 makes CASH money-roles-only and says nothing of the sort about
   * Fleet — a dispatcher reads trucks and drivers (`FLEET_READ`) and idle
   * equipment is their job. But "top drivers by gross" is money inside the
   * fleet panel, so the panel splits rather than the page: the five tiles for
   * everybody, the money half for the roles that may see money, and the figures
   * never computed for the others. §0: left out of the payload, not hidden.
   */
  drivers: {
    top: DriverGrossRow[]
    restCount: number
    restCents: number
  } | null
  locale: string
  labels: {
    heading: string
    trucksPaired: string
    trucksIdle: string
    driversPaired: string
    driversIdle: string
    movingNow: string
    topDrivers: string
    driver: string
    gross: string
    loads: string
    other: (count: number) => string
    empty: string
    teamNote: string
  }
}) {
  const peak = (drivers?.top ?? []).reduce(
    (high, row) => Math.max(high, row.grossCents),
    0,
  )
  const width = (cents: number) =>
    peak <= 0 ? 0 : Math.max(1, (cents / peak) * 100)

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>

      {/* BY ASSIGNMENT STATE. "Nine trucks" is inventory; "seven paired, two
       * idle" is a decision somebody can act on before the board closes. */}
      <dl className="mt-z3 grid grid-cols-2 gap-z3 md:grid-cols-5">
        <Tile label={labels.trucksPaired} value={fleet.trucksPaired} />
        <Tile label={labels.trucksIdle} value={fleet.trucksIdle} />
        <Tile label={labels.driversPaired} value={fleet.driversPaired} />
        <Tile label={labels.driversIdle} value={fleet.driversIdle} />
        <Tile label={labels.movingNow} value={fleet.movingNow} />
      </dl>

      {/* THE MONEY HALF, AND IT IS ABSENT RATHER THAN EMPTY for a role that
       * may not see money. Not an empty state: there is nothing to say about a
       * chart somebody is not entitled to, and §14's objection to a blank panel
       * is about missing DATA, not withheld figures. The tiles above stay. */}
      {drivers === null ? null : (
        <div className="mt-z5">
          <h3 className="text-sm font-medium text-ink">{labels.topDrivers}</h3>
          <ChartLegend
            moneyOnly={false}
            labels={{ gross: labels.gross, driverPay: '', unrecorded: '' }}
          />
          {/* BOTH CREW SEATS ARE CREDITED on a team load, so these per-driver
           * load counts sum to MORE than the window's load count. Said on the
           * screen, because a reader comparing the two and calling the
           * difference a bug is the predictable misreading. */}
          <p className="mt-z1 text-xs text-ink-3">{labels.teamNote}</p>

          {drivers.top.length === 0 ? (
            <p className="mt-z3 text-sm text-ink-3">{labels.empty}</p>
          ) : (
            <ol className="mt-z3 flex flex-col gap-z2">
              {drivers.top.map((row) => (
                <li key={row.driverId} className="flex flex-col gap-[2px]">
                  <div className="flex items-baseline justify-between gap-z2 text-xs">
                    <Link
                      href={`/drivers/${row.driverId}`}
                      className="truncate text-ink hover:underline"
                    >
                      {row.driverName}
                    </Link>
                    <span className="shrink-0 font-mono tabular-nums text-ink-2">
                      {compact(row.grossCents, locale)} · {String(row.loads)}
                    </span>
                  </div>
                  <span
                    aria-hidden
                    className="h-z2 rounded-[2px] bg-accent"
                    style={{ width: `${String(width(row.grossCents))}%` }}
                  />
                </li>
              ))}
              {/* THE REMAINDER, NAMED AND SUMMED. A list of ten out of
               * thirty-one that does not say so reads as the whole fleet. */}
              {drivers.restCount > 0 ? (
                <li className="flex items-baseline justify-between gap-z2 border-t border-border pt-z2 text-xs text-ink-2">
                  <span>{labels.other(drivers.restCount)}</span>
                  <span className="font-mono tabular-nums">
                    {compact(drivers.restCents, locale)}
                  </span>
                </li>
              ) : null}
            </ol>
          )}

          <table className="sr-only">
            <caption>{labels.topDrivers}</caption>
            <thead>
              <tr>
                <th scope="col">{labels.driver}</th>
                <th scope="col">{labels.gross}</th>
                <th scope="col">{labels.loads}</th>
              </tr>
            </thead>
            <tbody>
              {drivers.top.map((row) => (
                <tr key={row.driverId}>
                  <th scope="row">{row.driverName}</th>
                  <td>{formatCents(row.grossCents, locale)}</td>
                  <td>{String(row.loads)}</td>
                </tr>
              ))}
              {drivers.restCount > 0 ? (
                <tr>
                  <th scope="row">{labels.other(drivers.restCount)}</th>
                  <td>{formatCents(drivers.restCents, locale)}</td>
                  <td />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── CASH ───────────────────────────────────────────────────────────────────

export function CashPanel({
  aging,
  pipeline,
  unapplied,
  locale,
  labels,
}: {
  // NON-NULL ON PURPOSE. `panelFigures` returns null for both when the role
  // cannot see money, and the page does not render this panel in that case — so
  // the component takes the figures as present rather than carrying a branch
  // that would let a nullable value reach it and render an em dash where a
  // permission decision belongs.
  aging: NonNullable<PanelFigures['aging']>
  pipeline: NonNullable<PanelFigures['pipeline']>
  /** From the Needs-you statement, which already counts and sums these. */
  unapplied: { cents: number; count: number }
  locale: string
  labels: {
    heading: string
    aging: string
    agingNote: string
    d0_30: string
    d31_60: string
    d61_90: string
    d90plus: string
    bucket: string
    amount: string
    unapplied: string
    pipeline: string
    draft: string
    final: string
    paid: string
    empty: string
  }
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>

      {/* THE AGING BAR IS THE SHARED COMPONENT (§6.2.7). It was eighty lines
       * of markup here until /accounting/reports needed the same chart; two
       * copies drawn from one reader is how 0-30 ends up a different boundary
       * on two screens quoting the same number. */}
      <div className="mt-z3">
        <AgingBar
          aging={aging}
          locale={locale}
          labels={{
            heading: labels.aging,
            note: labels.agingNote,
            d0_30: labels.d0_30,
            d31_60: labels.d31_60,
            d61_90: labels.d61_90,
            d90plus: labels.d90plus,
            bucket: labels.bucket,
            amount: labels.amount,
            empty: labels.empty,
          }}
        />
      </div>

      <dl className="mt-z5 grid grid-cols-2 gap-z3 md:grid-cols-4">
        <div className="rounded-card border border-border bg-surface-2 p-z3">
          <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
            {labels.unapplied}
          </dt>
          <dd className="mt-z1 font-mono text-lg tabular-nums text-ink">
            {formatCents(unapplied.cents, locale)}
            {/* THE COUNT BESIDE THE MONEY. "$14,200 unapplied" is the fact;
             * "across 3 payments" is what tells somebody how long it takes. */}
            <span className="ms-z2 text-xs text-ink-3">
              ({String(unapplied.count)})
            </span>
          </dd>
        </div>
        {(
          [
            ['draft', labels.draft, pipeline.draftCents],
            ['final', labels.final, pipeline.finalCents],
            ['paid', labels.paid, pipeline.paidCents],
          ] as const
        ).map(([key, label, cents]) => (
          <div
            key={key}
            className="rounded-card border border-border bg-surface-2 p-z3"
          >
            <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
              {label}
            </dt>
            <dd className="mt-z1 font-mono text-lg tabular-nums text-ink">
              {formatCents(cents, locale)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// ── COMPLIANCE ─────────────────────────────────────────────────────────────

export function CompliancePanel({
  expiring,
  dqf,
  labels,
}: {
  expiring: PanelFigures['expiring']
  dqf: { complete: number; incomplete: number }
  labels: {
    heading: string
    expiring: string
    expiringNote: string
    d30: string
    d60: string
    d90: string
    dqf: string
    complete: string
    incomplete: string
    horizon: string
    count: string
  }
}) {
  const total = dqf.complete + dqf.incomplete
  const completeShare = total <= 0 ? 0 : (dqf.complete / total) * 100

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>

      {/* CUMULATIVE, AND IT SAYS SO. "Within 60 days" includes the ones within
       * 30 — three disjoint bands would make the 90-day figure read as a
       * comfortable quarter away when it is the one somebody glances at. */}
      <p className="mt-z2 text-xs text-ink-3">{labels.expiringNote}</p>

      <ul className="mt-z2 grid grid-cols-3 gap-z3">
        {(
          [
            ['d30', labels.d30, expiring.d30],
            ['d60', labels.d60, expiring.d60],
            ['d90', labels.d90, expiring.d90],
          ] as const
        ).map(([key, label, count]) => (
          <li key={key}>
            {/* EVERY COUNT IS A LINK to the screen that can act on it (§10:
             * an interface says what is possible). */}
            <Link
              href="/safety"
              className="block rounded-card border border-border bg-surface-2 p-z3 hover:bg-surface-3"
            >
              <span className="block text-xs uppercase tracking-[0.04em] text-ink-3">
                {label}
              </span>
              <span className="mt-z1 block font-mono text-lg tabular-nums text-ink">
                {count.toLocaleString()}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-z5">
        <h3 className="text-sm font-medium text-ink">{labels.dqf}</h3>
        <div className="mt-z2 flex items-center gap-z4">
          {/* A RING IN SVG, because a ring has no HTML equivalent (§6.1.1).
           * Two slices, so the arithmetic is one dash offset. */}
          <svg
            viewBox="0 0 42 42"
            className="h-[96px] w-[96px] shrink-0"
            role="img"
            aria-label={labels.dqf}
          >
            <circle
              cx={21}
              cy={21}
              r={15.915}
              fill="none"
              stroke="var(--color-surface-3)"
              strokeWidth={6}
            />
            {total > 0 ? (
              <circle
                cx={21}
                cy={21}
                r={15.915}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={6}
                strokeDasharray={`${String(completeShare)} ${String(100 - completeShare)}`}
              >
                <title>{`${labels.complete}: ${String(dqf.complete)} / ${String(total)}`}</title>
              </circle>
            ) : null}
          </svg>
          <ul className="flex flex-col gap-z1 text-xs">
            <li className="flex items-center gap-z2">
              <span aria-hidden className="h-z2 w-z3 rounded-[2px] bg-accent" />
              {labels.complete}
              <span className="font-mono tabular-nums text-ink">
                {String(dqf.complete)}
              </span>
            </li>
            <li className="flex items-center gap-z2">
              <span
                aria-hidden
                className="h-z2 w-z3 rounded-[2px]"
                style={{ backgroundColor: 'var(--color-surface-3)' }}
              />
              {labels.incomplete}
              <span className="font-mono tabular-nums text-ink">
                {String(dqf.incomplete)}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <table className="sr-only">
        <caption>{labels.heading}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.horizon}</th>
            <th scope="col">{labels.count}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{labels.d30}</th>
            <td>{String(expiring.d30)}</td>
          </tr>
          <tr>
            <th scope="row">{labels.d60}</th>
            <td>{String(expiring.d60)}</td>
          </tr>
          <tr>
            <th scope="row">{labels.d90}</th>
            <td>{String(expiring.d90)}</td>
          </tr>
          <tr>
            <th scope="row">{labels.complete}</th>
            <td>{String(dqf.complete)}</td>
          </tr>
          <tr>
            <th scope="row">{labels.incomplete}</th>
            <td>{String(dqf.incomplete)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}
