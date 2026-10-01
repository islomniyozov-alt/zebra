import type { ReactNode } from 'react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { cx } from '@/lib/cx'
import type { ActivityItem } from '@/lib/load-activity'

// ---------------------------------------------------------------------------
// ONE TIMELINE (§7.10, owner's ruling 2026-10-01).
//
// This replaces TWO panels — `StatusTimeline` (status events plus notes) and
// `ActivityPanel` (audit field edits) — which between them answered "what
// happened to this load" only if somebody read both and interleaved them by
// eye. The merge is `mergeActivity` in `load-activity.ts`, on the server, where
// the times are still Dates.
//
// NOTHING HERE FILTERS AND NOTHING HERE SORTS. `activityEntries` decides what a
// role may read — money by omission, rows emptied by that filter dropped whole —
// and `mergeActivity` decides the order. This file decides only how it looks,
// which is the same split the two components it replaces already had.
//
// ── SIX KINDS, AND THEY DO NOT DRESS ALIKE ───────────────────────────────
//
// §7.10: "somebody wrote this down", "the load moved" and "a file arrived" are
// different kinds of fact, and a timeline that dressed them alike would invite
// the misreading it exists to prevent. THE RAIL CARRIES THE DISTINCTION —
// filled for a transition that happened, hollow for one that was refused,
// hollow neutral for a note, and a small square for a document so an upload is
// not mistaken for a state change.
//
// ── THREE DECISIONS INHERITED FROM `ActivityPanel`, EACH MEASURED ─────────
//
// They came out of a query against dev rather than out of imagination, and they
// are repeated here because deleting the component that held them would
// otherwise delete the reasons:
//
//   A CREATE IS ONE SENTENCE, NOT 24 LINES. Creating a load audits every column
//   it sets — 24 fields, 51 times over in dev — so listing diffs buries every
//   later edit under the birth of the load. The values are the load itself,
//   visible on the screen around this panel.
//
//   FOREIGN KEYS NEVER RENDER THEIR VALUE. `truckId`, `driverId`, `customerId`
//   are UUIDs; "Truck: 8f3a… → 41b9…" tells a dispatcher nothing they can act
//   on. The field is named and the change described — set, cleared, changed.
//
//   AND `null` IS AN EM DASH, not "null". It means the field was empty, which
//   is a fact about the load rather than a fact about JSON.
// ---------------------------------------------------------------------------

interface Props {
  entries: readonly ActivityItem[]
  /** True when older audit rows exist beyond the window the page fetched. */
  truncated: boolean
  statusLabels: Record<string, string>
  documentTypeLabels: Record<string, string>
  /** The note box. §7.10: adding a note is its own control, always present. */
  composer?: ReactNode
  locale: string
  timeZone: string
  labels: {
    title: string
    empty: string
    created: string
    deleted: string
    uploaded: string
    via: string
    truncated: string
    manual: string
    automatic: string
    driverPortal: string
    integration: string
    refused: string
    refusedBody: string
    by: string
    /** Values a foreign key changed to, without printing the key. */
    set: string
    cleared: string
    changed: string
    /** `loads.field.<name>` when one exists; otherwise the name is humanised. */
    field: (name: string) => string
  }
}

export function ActivityTimeline({
  entries,
  truncated,
  statusLabels,
  documentTypeLabels,
  composer,
  locale,
  timeZone,
  labels,
}: Props) {
  // TO THE MINUTE, in the company's zone. `timeStyle: 'short'` is minutes
  // without seconds, which is the precision a dispatcher argues in — and
  // seconds on an audit row invite a precision the clock does not have.
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  })

  const sourceLabel = (source: string) =>
    source === 'MANUAL'
      ? labels.manual
      : source === 'AUTOMATIC'
        ? labels.automatic
        : source === 'DRIVER_PORTAL'
          ? labels.driverPortal
          : labels.integration

  /** The time and the actor, which EVERY kind carries (§7.10). */
  const stamp = (at: Date, actor: string | null, extra?: ReactNode) => (
    <div className="flex flex-wrap items-baseline gap-z2">
      <span className="font-mono tabular-nums text-xs text-ink-3">
        {when.format(at)}
      </span>
      {actor ? <span className="text-sm text-ink">{actor}</span> : null}
      {extra}
    </div>
  )

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>

      {entries.length === 0 ? (
        <p className="mt-z2 text-sm text-ink-2">{labels.empty}</p>
      ) : (
        <ol className="mt-z3 flex flex-col gap-z3">
          {entries.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`} className="flex gap-z3">
              <Rail entry={entry} />
              <div className="flex-1 pb-z2">
                {entry.kind === 'status' ? (
                  <StatusRow
                    entry={entry}
                    statusLabels={statusLabels}
                    sourceLabel={sourceLabel}
                    stamp={stamp}
                    labels={labels}
                  />
                ) : entry.kind === 'note' ? (
                  <>
                    {/* VERBATIM. §12: a person's sentence is evidence. */}
                    <p className="text-base text-ink">{entry.body}</p>
                    {stamp(entry.at, entry.actor)}
                  </>
                ) : entry.kind === 'document' ? (
                  <>
                    <div className="flex flex-wrap items-center gap-z2">
                      <StatusBadge
                        tone="neutral"
                        variant="outlined"
                        label={
                          documentTypeLabels[entry.documentType] ??
                          entry.documentType
                        }
                      />
                      <span className="text-sm text-ink">
                        {labels.uploaded}
                      </span>
                      {/* A FILENAME IS AN IDENTIFIER, so it stays LTR even in
                       * an RTL layout (§12) — `invoice-0012.pdf` reversed is a
                       * different string. */}
                      <span
                        className="z-identifier font-mono text-xs text-ink-2"
                        dir="ltr"
                      >
                        {entry.filename}
                      </span>
                    </div>
                    {stamp(entry.at, entry.actor)}
                  </>
                ) : entry.kind === 'field' ? (
                  <>
                    {stamp(
                      entry.at,
                      entry.actor,
                      entry.via === 'integration' ? (
                        <span className="text-xs uppercase tracking-[0.04em] text-ink-3">
                          {labels.via}
                        </span>
                      ) : null,
                    )}
                    <dl className="mt-z1 flex flex-col gap-z1">
                      {entry.diffs.map((diff) => (
                        <div
                          key={diff.field}
                          className="flex flex-wrap items-baseline gap-z2 text-sm"
                        >
                          <dt className="text-ink-2">
                            {labels.field(diff.field)}
                          </dt>
                          <dd className="text-ink">
                            {isReference(diff.field)
                              ? referenceChange(diff, labels)
                              : `${show(diff.from)} → ${show(diff.to)}`}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  // created / deleted — one sentence. See the header.
                  <>
                    {stamp(
                      entry.at,
                      entry.actor,
                      entry.via === 'integration' ? (
                        <span className="text-xs uppercase tracking-[0.04em] text-ink-3">
                          {labels.via}
                        </span>
                      ) : null,
                    )}
                    <p className="mt-z1 text-sm text-ink-2">
                      {entry.kind === 'created'
                        ? labels.created
                        : labels.deleted}
                    </p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* A WINDOW THAT SAYS IT IS A WINDOW. Silence would render "the oldest
       * thing that happened" and "the oldest thing we fetched" as the same
       * sentence — the mistake the stop-attribution query was split to avoid. */}
      {truncated ? (
        <p className="mt-z3 text-xs text-ink-3">{labels.truncated}</p>
      ) : null}

      {/* AFTER THE ENTRIES. It sat under the title once, which pushed the
       * history down and read as though the input were the panel's subject.
       * Writing a note is what you do having read them. */}
      {composer ? <div className="mt-z4">{composer}</div> : null}
    </section>
  )
}

/**
 * The rail, which is where the kinds are told apart (§7.10).
 *
 * FILLED means it happened and moved the load. HOLLOW DANGER is a transition
 * that was attempted and refused — recorded because what somebody tried is
 * exactly what a dispute turns on, and hollow so the eye can skip it when
 * reading what actually happened. HOLLOW NEUTRAL is a note. A SQUARE is a
 * document, because an upload is not a state change and a round dot in a
 * column of round dots would say it was.
 */
function Rail({ entry }: { entry: ActivityItem }) {
  const shape =
    entry.kind === 'document'
      ? 'h-z2 w-z2 rounded-[2px] border border-border-strong bg-surface-2'
      : entry.kind === 'status'
        ? entry.outcome === 'REFUSED_STALE'
          ? 'h-z2 w-z2 rounded-full border border-danger bg-surface'
          : 'h-z2 w-z2 rounded-full border border-progress bg-progress'
        : entry.kind === 'note'
          ? 'h-z2 w-z2 rounded-full border border-border bg-surface'
          : 'h-z2 w-z2 rounded-full border border-border-strong bg-surface-2'

  return (
    <div className="flex flex-col items-center pt-[5px]">
      <span aria-hidden className={shape} />
      <span aria-hidden className="mt-z1 w-px flex-1 bg-border" />
    </div>
  )
}

function StatusRow({
  entry,
  statusLabels,
  sourceLabel,
  stamp,
  labels,
}: {
  entry: Extract<ActivityItem, { kind: 'status' }>
  statusLabels: Record<string, string>
  sourceLabel: (source: string) => string
  stamp: (at: Date, actor: string | null, extra?: ReactNode) => ReactNode
  labels: {
    refused: string
    refusedBody: string
    by: string
  }
}) {
  const refused = entry.outcome === 'REFUSED_STALE'
  return (
    <>
      <div className="flex flex-wrap items-center gap-z2">
        <StatusBadge
          tone={refused ? 'danger' : 'progress'}
          variant={refused ? 'outlined' : 'filled'}
          label={statusLabels[entry.toStatus] ?? entry.toStatus}
        />
        <span className={cx('text-xs', refused ? 'text-danger' : 'text-ink-3')}>
          {refused ? labels.refused : sourceLabel(entry.source)}
        </span>
      </div>
      {stamp(
        entry.at,
        entry.actor === null ? null : `${labels.by} ${entry.actor}`,
      )}

      {refused ? (
        <p className="mt-z1 text-sm text-ink-2">
          {labels.refusedBody
            .replace(
              '{attempted}',
              statusLabels[entry.toStatus] ?? entry.toStatus,
            )
            .replace(
              '{stayed}',
              entry.fromStatus
                ? (statusLabels[entry.fromStatus] ?? entry.fromStatus)
                : '—',
            )}
        </p>
      ) : null}

      {entry.note ? (
        <p className="mt-z1 text-sm text-ink-2">{entry.note}</p>
      ) : null}
    </>
  )
}

/** A foreign key, whose value is a UUID nobody can read. */
function isReference(field: string): boolean {
  return field.endsWith('Id')
}

function referenceChange(
  diff: { from: unknown; to: unknown },
  labels: { set: string; cleared: string; changed: string },
): string {
  const had = diff.from !== null && diff.from !== undefined
  const has = diff.to !== null && diff.to !== undefined
  if (!had && has) return labels.set
  if (had && !has) return labels.cleared
  return labels.changed
}

/** A stored value as a dispatcher should read it. */
function show(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (typeof value === 'string' && value === '') return '—'
  return String(value)
}
