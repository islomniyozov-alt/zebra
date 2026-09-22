import { StatusBadge } from '@/components/ui/StatusBadge'
import type { StatusTone } from '@/lib/status'
import type { DqfStatus } from '@/lib/dqf'

// ITEM 13 — THE DRIVER QUALIFICATION FILE, ON THE DRIVER'S OWN SCREEN.
//
// A SERVER COMPONENT WITH NO FORM. Nothing here records anything: an MVR is
// filed as a compliance record through the panel below this one, and a road
// test certificate is uploaded through the documents panel above it. A third
// place to file the same evidence would be a third place for it to be filed
// slightly differently.
//
// IT TAKES ROWS, not a transaction, like `InspectionPanel` beside it — the
// query runs inside the page's `withCurrentOrg` and the connection is gone by
// the time this renders.
//
// EVERY ROW CARRIES ITS CFR SECTION. This screen is read when an auditor is
// in the building, and "Missing" next to "391.23(a)(2)" is a sentence somebody
// can act on; "Missing" on its own is a puzzle.

const TONE: Record<DqfStatus, StatusTone> = {
  present: 'success',
  // DUE IS NOT A FAILURE. The driver is qualified today and somebody has a
  // month to keep them that way — warning tone, not danger.
  due: 'warning',
  expired: 'danger',
  // MISSING IS ALSO DANGER, and deliberately the same weight as expired. A
  // regulator does not grade "we never obtained it" more kindly than "it
  // lapsed"; muting it here would be this screen having an opinion the
  // audit does not share.
  missing: 'danger',
}

export interface DqfPanelRow {
  key: string
  label: string
  cfr: string
  cadenceLabel: string
  status: DqfStatus
  statusLabel: string
  /** Already formatted, or null when there is no date to show. */
  since: string | null
}

interface Props {
  rows: readonly DqfPanelRow[]
  /** Null when this driver's file does not have to be current. */
  summary: string
  qualifiable: boolean
  labels: {
    title: string
    hint: string
    since: string
    notQualifiable: string
  }
}

export function DqfPanel({ rows, summary, qualifiable, labels }: Props) {
  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      {/* THE VERDICT FIRST. Eight rows is a table somebody has to read; one
       * sentence is what they came for, and the rows say why it says that. */}
      <p className="mt-z3 text-sm text-ink-2">
        {qualifiable ? summary : labels.notQualifiable}
      </p>

      <ul className="mt-z3 flex flex-col">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex flex-wrap items-baseline gap-x-z3 gap-y-z1 border-b border-border py-z2 text-sm last:border-b-0"
          >
            <span className="min-w-[22ch] font-medium text-ink">
              {row.label}
            </span>
            <span className="font-mono text-xs text-ink-3">{row.cfr}</span>
            <span className="text-xs text-ink-3">{row.cadenceLabel}</span>
            <span className="ms-auto flex items-baseline gap-z3">
              {row.since === null ? null : (
                <span className="text-xs text-ink-3">
                  {labels.since} {row.since}
                </span>
              )}
              <StatusBadge tone={TONE[row.status]} label={row.statusLabel} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
