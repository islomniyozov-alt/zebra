import { INTEGRATION_USER_AGENT, type ActivityRow } from './load-activity'

// ---------------------------------------------------------------------------
// WHO PUT THIS CHECK-IN ON THIS STOP.
//
// `LoadStop` records `arrivedAt` and `departedAt` and NOT WHO WROTE THEM. There
// is no actor column and adding one would be a migration for a question the
// audit log already answers: every audited write carries a user and a
// `{ field: { from, to } }` map, so "who last set this stop's arrival" is a
// lookup rather than a schema change.
//
// THE SAME ROWS THE ACTIVITY PANEL READS. One query on the load detail, two
// derivations — the timeline and this. Two queries would be two answers to
// "what happened to this load", and they would drift the first time one grew a
// filter the other did not.
//
// IT NEVER CLAIMS A HUMAN DID THE WORK. `AuditLog` has no source column;
// MANUAL / AUTOMATIC / INTEGRATION lives on `LoadStatusEvent` and covers status
// changes, not stop clocks. So `via` is `'integration'` only when the writer
// stamped its own user agent, and null means UNKNOWN — which the screen renders
// as silence, never as "manually". The loads imported before the stamp existed
// would otherwise read as a dispatcher having checked in stops that a file
// wrote.
//
// LAST WRITE WINS, and that is the honest answer to the question being asked.
// "Who checked this stop in" means whoever put the value there that is there
// now; an earlier correction is history and belongs in the timeline beside it.
// ---------------------------------------------------------------------------

export interface Attribution {
  /** The name on the audit row, or null when it was written without one. */
  actor: string | null
  /** Only when the writer said so. Null means we do not know, not "by hand". */
  via: 'integration' | null
}

export interface StopAttribution {
  arrival: Attribution | null
  departure: Attribution | null
}

const CLOCKS = { arrivedAt: 'arrival', departedAt: 'departure' } as const

/**
 * Per stop id, who last wrote each clock.
 *
 * Rows may arrive in any order; this keeps the NEWEST write per field rather
 * than trusting a caller's `orderBy`, for the same reason `activityEntries`
 * sorts rather than trusts.
 */
export function stopAttribution(
  rows: readonly ActivityRow[],
): Map<string, StopAttribution> {
  const found = new Map<string, StopAttribution>()
  const when = new Map<string, number>()

  for (const row of rows) {
    if (row.entityType !== 'LoadStop') continue
    if (row.changes === null || typeof row.changes !== 'object') continue

    const changes = row.changes as Record<string, unknown>
    for (const [field, key] of Object.entries(CLOCKS)) {
      if (!(field in changes)) continue

      const stamp = `${row.entityId}:${key}`
      const at = row.createdAt.getTime()
      // Strictly newer, so the first row wins a tie and the result does not
      // depend on the order two writes in one millisecond happen to arrive in.
      if (when.has(stamp) && (when.get(stamp) ?? 0) >= at) continue
      when.set(stamp, at)

      const existing = found.get(row.entityId) ?? {
        arrival: null,
        departure: null,
      }
      found.set(row.entityId, {
        ...existing,
        [key]: {
          actor: row.user?.name ?? null,
          via: row.userAgent === INTEGRATION_USER_AGENT ? 'integration' : null,
        },
      })
    }
  }

  return found
}

/**
 * "Aziz", "Aziz via Integration", or nothing at all.
 *
 * NOTHING AT ALL IS A REAL ANSWER. A stop whose clock predates the audit log,
 * or was written by a path that recorded no user, has no attribution — and an
 * em dash is the truthful rendering. Inventing "system" or "manually" there is
 * the claim this whole file exists to avoid.
 */
export function attributionLabel(
  attribution: Attribution | null | undefined,
  labels: { via: string; unknown: string },
): string {
  if (!attribution) return labels.unknown
  if (attribution.actor === null) {
    return attribution.via === 'integration' ? labels.via : labels.unknown
  }
  return attribution.via === 'integration'
    ? `${attribution.actor} ${labels.via}`
    : attribution.actor
}
