import type { Prisma } from '@/generated/prisma/client'
import { humaniseField } from './load-activity'

/** Plain transaction client, as the other reporting modules declare it. */
type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// RECENT AUDIT ACTIVITY, FOR THE ORGANIZATION ASKING. §6.1 admin group.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
//
// Not a second audit system. `AuditLog` is written by the Prisma extension
// inside the caller's transaction behind a SAVEPOINT (`src/lib/audit.ts`) and
// that path is untouched — this only READS it. The sink in `audit-sink.ts`
// remains the fleet-wide health signal for failures and gaps; this is the
// durable record of what actually changed.
//
// Not a filtered, searchable, exportable log either. The most recent N rows,
// newest first, and nothing else: the question it answers is "who did what",
// asked by an owner who until now needed a production connection string.
//
// ── THE TENANT FENCE IS ROW-LEVEL SECURITY, AS EVERYWHERE ELSE ───────────
//
// `tx` arrives from `withCurrentOrg`, which has already set
// `app.current_org_id`, and `AuditLog` has `FORCE ROW LEVEL SECURITY` with the
// `org_isolation` policy on it. So there is no `organizationId` in the `where`
// below, for the reason `tenancy.ts` gives: a filter here would be a second and
// weaker expression of the boundary, and the one that drifts is always the
// copy. What proves it instead is a test that seeds TWO organizations and reads
// as one — `tests/integration/audit-trail.test.ts`.
// ---------------------------------------------------------------------------

/** How many rows the page shows. Newest first, no paging in this version. */
export const AUDIT_TRAIL_LIMIT = 50

export interface AuditTrailRow {
  id: string
  at: Date
  action: string
  entityType: string
  entityId: string
  /** The acting user's name or email, or null for an unattributed write. */
  actor: string | null
  /**
   * The FIELD NAMES that changed, humanised, in ALPHABETICAL order.
   *
   * NOT "the order recorded", which is what this said until the integration test
   * disagreed with the unit test: `changes` is `jsonb`, and jsonb does not keep
   * key order — it stores them by length and then alphabetically, so a row
   * written as `{ rateCents, status }` comes back `status, rateCents`. A JS
   * object literal in a node test DOES keep insertion order, so the two tests
   * saw different truths and only the one talking to Postgres was right.
   *
   * Sorted here, so the column is stable for a reader and the claim is true.
   *
   * NAMES AND NOT VALUES, deliberately. A diff carries rates, pay, addresses
   * and phone numbers; a summary line on an admin page is not where those
   * belong, and §0's rule about never shipping what the reader cannot use
   * applies to a convenience as much as to a payload. The row id is on screen,
   * so anybody who needs the detail can open the record.
   */
  fields: string[]
}

export async function recentAuditRows(
  tx: TxClient,
  limit: number = AUDIT_TRAIL_LIMIT,
): Promise<AuditTrailRow[]> {
  const rows = await tx.auditLog.findMany({
    // NEWEST FIRST, over the `[organizationId, createdAt]` index the schema
    // already carries — this needed no migration.
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      action: true,
      entityType: true,
      entityId: true,
      changes: true,
      user: { select: { name: true, email: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    // THE NAME, FALLING BACK TO THE EMAIL. A user row can carry an empty name
    // from an invite that was never completed, and "" on screen reads as a bug.
    actor: row.user?.name?.trim() || row.user?.email || null,
    fields: fieldsOf(row.changes),
  }))
}

/**
 * The field names out of `{ field: { from, to } }`.
 *
 * DEFENSIVE ABOUT THE SHAPE, because `changes` is `Json?` and nothing in the
 * database enforces it: rows written before the current shape, or by a future
 * writer, must not take the page down. An unreadable diff summarises as nothing
 * rather than throwing — the row itself is still evidence that the write
 * happened, which is the point of the trail.
 */
export function fieldsOf(changes: unknown): string[] {
  if (changes === null || typeof changes !== 'object') return []
  if (Array.isArray(changes)) return []
  return (
    Object.keys(changes as Record<string, unknown>)
      .map(humaniseField)
      // SORTED, because jsonb's key order is its own business. See the note on
      // `AuditTrailRow.fields`.
      .sort((a, b) => a.localeCompare(b))
  )
}
