// ---------------------------------------------------------------------------
// THE AUDIT LOG, SHOWN TO A DISPATCHER FOR THE FIRST TIME.
//
// `AuditLog.changes` has recorded `{ field: { from, to } }` on every audited
// write since Phase 1 and nothing has ever displayed it. The Activity panel
// does — which means rows written under one set of eyes are about to be read
// under another.
//
// SO PERMISSION IS ENFORCED HERE, FIELD BY FIELD, AND BY OMISSION. The standing
// rule is that a field the role cannot see never reaches the client: not
// blanked, not masked, not hidden in CSS — absent. A rate change must not
// surface in a timeline on a screen whose Rate panel that role cannot open,
// and "3 fields changed" with two of them elided is still telling a dispatcher
// that money moved.
//
// A ROW THAT LOSES EVERY FIELD IS DROPPED WHOLE. Otherwise the panel shows
// "Owner updated this load" with nothing under it, which is the same leak
// wearing a vaguer sentence — it says when the money changed and who changed
// it, and only withholds the amount.
//
// AND IT NEVER CLAIMS A HUMAN DID THE WORK. An audit row carries an actor and
// no source; `LoadStatusEvent` is where MANUAL / AUTOMATIC / INTEGRATION lives,
// and stop times are not status events. So a row whose origin is unknown names
// the actor and says nothing about how — no "manually", no implied claim. The
// ~13 loads imported before the trips importer started stamping its user agent
// would otherwise read as a dispatcher having checked in stops that a file
// wrote. Same shape as a refusal that looks like a save.
// ---------------------------------------------------------------------------

/** Fields only a reader with `load.financials` may see. */
const MONEY_FIELDS = new Set([
  'linehaulCents',
  'fuelSurchargeCents',
  'accessorialsCents',
  'totalRevenueCents',
  'driverPayCents',
  'driverPayPercentBps',
  'estimatedFuelCents',
  'estimatedProfitCents',
  'factoringFeeCents',
  'isFactored',
  'factoringCompanyId',
  'amountCents',
  'rateCents',
  'perMileCents',
])

/**
 * Fields nobody needs to read as history.
 *
 * `updatedAt` changes on every write and means nothing on its own; ids are
 * plumbing. Dropping them is presentation, not permission — they are removed
 * for everyone, which is why they are a separate list from the money.
 */
const NOISE_FIELDS = new Set(['updatedAt', 'createdAt', 'id', 'organizationId'])

export interface FieldDiff {
  field: string
  from: unknown
  to: unknown
}

export interface ActivityEntry {
  id: string
  at: Date
  /** The person on the audit row, or null when it was written without one. */
  actor: string | null
  /**
   * How the write reached us, when we can tell.
   *
   * `'integration'` only when the writer said so — the trips importer stamps
   * its user agent. Null means UNKNOWN, and the screen must render that as
   * silence rather than as "manually". We did not record it; we do not know.
   */
  via: 'integration' | null
  action: string
  entityType: string
  diffs: FieldDiff[]
}

export interface ActivityRow {
  id: string
  createdAt: Date
  action: string
  entityType: string
  userAgent: string | null
  user: { name: string | null } | null
  changes: unknown
}

/** What the trips importer stamps so its own writes are recognisable later. */
export const INTEGRATION_USER_AGENT = 'zebra-relay-trips-import'

/**
 * Audit rows as a dispatcher may read them.
 *
 * `maySeeMoney` is the caller's answer from `permissions.ts` — this function
 * does not decide permission, it applies one. Rule: permission is decided in
 * one place and nowhere else.
 */
export function activityEntries(
  rows: readonly ActivityRow[],
  viewer: { maySeeMoney: boolean },
): ActivityEntry[] {
  const entries: ActivityEntry[] = []

  for (const row of rows) {
    const diffs: FieldDiff[] = []
    const changes = row.changes

    if (changes !== null && typeof changes === 'object') {
      for (const [field, value] of Object.entries(
        changes as Record<string, unknown>,
      )) {
        if (NOISE_FIELDS.has(field)) continue
        // OMITTED, NOT MASKED. The field name itself is the leak: "linehaul
        // changed" tells a dispatcher what they may not know.
        if (!viewer.maySeeMoney && MONEY_FIELDS.has(field)) continue
        if (value === null || typeof value !== 'object') continue

        const pair = value as { from?: unknown; to?: unknown }
        diffs.push({ field, from: pair.from ?? null, to: pair.to ?? null })
      }
    }

    // A row emptied by the filter is dropped whole. "Owner updated this load"
    // with nothing under it still says money moved and when.
    if (diffs.length === 0) continue

    entries.push({
      id: row.id,
      at: row.createdAt,
      actor: row.user?.name ?? null,
      via: row.userAgent === INTEGRATION_USER_AGENT ? 'integration' : null,
      action: row.action,
      entityType: row.entityType,
      diffs,
    })
  }

  // Newest first, as asked. Sorted here rather than trusted from the query so
  // the order is a property of this function and not of a caller's `orderBy`.
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime())
}
