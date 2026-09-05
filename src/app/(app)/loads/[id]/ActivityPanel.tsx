import type { ActivityEntry } from '@/lib/load-activity'

// ---------------------------------------------------------------------------
// THE AUDIT LOG, RENDERED (item 8).
//
// `AuditLog.changes` has held `{ field: { from, to } }` since Phase 1 and
// nothing has ever shown it. `activityEntries` decides WHAT may be read — the
// money filter, the dropped-empty rule, the refusal to claim a human acted —
// and this file decides only how it looks. Nothing here filters.
//
// ── THREE DECISIONS TAKEN FROM THE ROWS, NOT FROM IMAGINATION ──────────────
//
// The dev database was queried for what these rows actually contain before any
// of this was written, and all three of these came back from that query rather
// than from a guess about it.
//
//   A CREATE ROW IS ONE SENTENCE, NOT TWENTY-FOUR LINES. Creating a load
//   audits every column it set — 24 fields, 51 times over in dev — so listing
//   diffs would bury every later edit under the birth of the load. "Created"
//   is the whole fact; the values are the load itself, visible on the screen
//   around it.
//
//   FOREIGN KEYS NEVER RENDER THEIR VALUE. `truckId`, `driverId`,
//   `customerId`, `factoringCompanyId` are UUIDs. "Truck: 8f3a… → 41b9…" tells
//   a dispatcher nothing they can act on, so the field is named and the change
//   is described — set, cleared, changed — and the UUID stays off the screen.
//
//   AND `null` IS AN EM DASH, not "null". It means the field was empty, which
//   is a fact about the load rather than a fact about JSON.
// ---------------------------------------------------------------------------

interface Props {
  entries: readonly ActivityEntry[]
  /** True when older rows exist beyond the window this panel fetched. */
  truncated: boolean
  locale: string
  timeZone: string
  labels: {
    title: string
    empty: string
    created: string
    deleted: string
    via: string
    truncated: string
    /** Values a foreign key changed to, without printing the key. */
    set: string
    cleared: string
    changed: string
    /** `loads.field.<name>` when one exists; otherwise the name is humanised. */
    field: (name: string) => string
  }
}

export function ActivityPanel({
  entries,
  truncated,
  locale,
  timeZone,
  labels,
}: Props) {
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  })

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>

      {entries.length === 0 ? (
        <p className="mt-z2 text-sm text-ink-2">{labels.empty}</p>
      ) : (
        <ol className="mt-z3 flex flex-col gap-z3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="border-b border-border pb-z2 last:border-b-0"
            >
              <div className="flex flex-wrap items-baseline gap-z2">
                <span className="font-mono tabular-nums text-xs text-ink-3">
                  {when.format(entry.at)}
                </span>
                {/* THE ACTOR, AND NOTHING ABOUT HOW THEY DID IT unless the
                 * writer stamped itself. `via` is null for an unknown origin
                 * and the screen stays silent rather than saying "manually". */}
                {entry.actor ? (
                  <span className="text-sm text-ink">{entry.actor}</span>
                ) : null}
                {entry.via === 'integration' ? (
                  <span className="text-xs uppercase tracking-[0.04em] text-ink-3">
                    {labels.via}
                  </span>
                ) : null}
              </div>

              {entry.action === 'CREATE' || entry.action === 'DELETE' ? (
                <p className="mt-z1 text-sm text-ink-2">
                  {entry.action === 'CREATE' ? labels.created : labels.deleted}
                </p>
              ) : (
                <dl className="mt-z1 flex flex-col gap-z1">
                  {entry.diffs.map((diff) => (
                    <div
                      key={diff.field}
                      className="flex flex-wrap items-baseline gap-z2 text-sm"
                    >
                      <dt className="text-ink-2">{labels.field(diff.field)}</dt>
                      <dd className="text-ink">
                        {isReference(diff.field)
                          ? referenceChange(diff, labels)
                          : `${show(diff.from)} → ${show(diff.to)}`}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* A WINDOW THAT SAYS IT IS A WINDOW. Silence here would render "the
       * oldest thing that happened" and "the oldest thing we fetched" as the
       * same sentence, which is the mistake the stop-attribution query was
       * split to avoid. */}
      {truncated ? (
        <p className="mt-z3 text-xs text-ink-3">{labels.truncated}</p>
      ) : null}
    </section>
  )
}

/** A foreign key, whose value is a UUID nobody can read. */
function isReference(field: string): boolean {
  return field.endsWith('Id')
}

/**
 * A column name as a sentence, for the fields nobody has translated.
 *
 * THE FALLBACK, NOT THE MECHANISM. `loads.field.<name>` is checked first and
 * wins wherever it exists; this exists so that a field added to the schema next
 * month renders as "Detention minutes" rather than as nothing, and so that the
 * Activity panel does not have to be updated in lockstep with every migration.
 *
 * The suffixes go because they are storage detail: `Cents` because money is an
 * integer of cents everywhere and the panel is not the place to relitigate it,
 * `Id` because the value is suppressed anyway, `Bps` for the same reason as
 * cents. A name that is ENTIRELY suffix keeps its original spelling rather
 * than becoming empty.
 */
export function humaniseField(name: string): string {
  const trimmed = name.replace(/(Cents|Bps|Id)$/, '') || name
  const spaced = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
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
