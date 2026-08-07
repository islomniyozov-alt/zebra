import Link from 'next/link'
import { StatusBadge } from '@/components/ui/StatusBadge'

// PHASE 4 §5 STEP 4 — the inspection history on one asset or driver.
//
// A SERVER COMPONENT, and no form on it. The compliance and maintenance panels
// are clients because they record; this one only reads, and an inspection is
// recorded from /safety/inspections/new where all three units can be named at
// once. A truck panel that could file an inspection would have to guess the
// driver, and the guess would be wrong exactly when it mattered.
//
// It takes rows rather than a transaction: the query runs inside the page's
// `withCurrentOrg` and the connection is gone by the time this renders. Truck,
// trailer and driver all call `inspectionPanelData`, so all three answer
// identically — the same reason `compliance-view.ts` exists.

export interface InspectionPanelRow {
  id: string
  date: string
  state: string
  levelLabel: string
  outOfService: boolean
  isClean: boolean
  resultLabel: string
  codes: string
  reportNumber: string | null
}

interface Props {
  rows: readonly InspectionPanelRow[]
  labels: {
    title: string
    hint: string
    none: string
  }
}

export function InspectionPanel({ rows, labels }: Props) {
  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      {rows.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-2">{labels.none}</p>
      ) : (
        <ul className="mt-z3 flex flex-col">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline gap-x-z3 gap-y-z1 border-b border-border py-z2 text-sm last:border-b-0"
            >
              <Link
                href={`/safety/inspections/${row.id}`}
                className="font-mono font-medium text-ink hover:text-accent"
              >
                {row.date}
              </Link>
              <span className="font-mono text-xs text-ink-2">{row.state}</span>
              <span className="text-ink-2">{row.levelLabel}</span>
              <StatusBadge
                tone={
                  row.outOfService
                    ? 'danger'
                    : row.isClean
                      ? 'success'
                      : 'warning'
                }
                label={row.resultLabel}
              />
              {/* The codes themselves, because a safety manager reading a
               * truck's history is looking for the same code twice — that is
               * what turns a violation into a pattern. */}
              {row.codes ? (
                <span className="font-mono text-xs text-ink-3">
                  {row.codes}
                </span>
              ) : null}
              {row.reportNumber ? (
                <span className="ms-auto font-mono text-xs text-ink-3">
                  {row.reportNumber}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
