import type { DocumentType } from '@/generated/prisma/client'
import { newestFirst, type Timed } from './load-timeline'

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
  /** The row this write touched. Needed to attribute a stop's clocks. */
  entityId: string
  diffs: FieldDiff[]
}

export interface ActivityRow {
  id: string
  createdAt: Date
  action: string
  entityType: string
  /** The row this write touched. Needed to attribute a stop's clocks. */
  entityId: string
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
      entityId: row.entityId,
      diffs,
    })
  }

  // Newest first, as asked. Sorted here rather than trusted from the query so
  // the order is a property of this function and not of a caller's `orderBy`.
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime())
}

// ---------------------------------------------------------------------------
// ONE STREAM, OUT OF FOUR SOURCES (§7.10, owner's ruling 2026-10-01).
//
// The page had TWO histories — a status timeline and this panel — and the
// question "what happened to this load" was answered by reading both and
// interleaving them by eye. §7.10 makes it one list.
//
// ── IT LIVES HERE, NOT IN THE PAGE ───────────────────────────────────────
//
// Flag 85's reason, and `load-timeline.ts` says it about the two-source
// version: a server component has a screen, not a guard. What can silently go
// wrong is the ORDER, and a wrong order looks exactly like a right one — every
// entry present, every entry real, reading in a sequence nobody checked.
//
// SO THE SORT KEY IS A `Date`, NEVER A RENDERED STRING. By the time an entry
// reaches a component its time is "Sep 2, 8:04 PM"; sorting those is
// alphabetical order wearing a chronology's clothes. `newestFirst` is given
// `Timed` values and the rendering happens afterwards.
//
// ── A DOCUMENT'S UPLOAD COMES FROM THE DOCUMENT ROW ──────────────────────
//
// Not from its audit row. `Document` carries `uploadedAt` and `uploadedBy`
// already, so the row IS the record of the upload rather than a claim about it
// — and it still answers for the documents uploaded before that write was
// audited. It is also the one source the old Activity panel could not see at
// all: its query is scoped to `entityType: 'Load' | 'LoadStop'`.
// ---------------------------------------------------------------------------

/** A status transition, as `LoadStatusEvent` stores it. */
export interface ActivityStatusSource {
  id: string
  occurredAt: Date
  fromStatus: string | null
  toStatus: string
  outcome: 'APPLIED' | 'REFUSED_STALE'
  source: string
  note: string | null
  changedBy: { name: string | null } | null
}

/** An upload, read off the `Document` row itself. */
export interface ActivityDocumentSource {
  id: string
  uploadedAt: Date
  filename: string
  /** THE ENUM, not a string: the label map is exhaustive over it. */
  type: DocumentType
  uploadedBy: { name: string | null } | null
  /**
   * When it was removed, or null while it is current.
   *
   * ── A DELETED DOCUMENT YIELDS TWO ROWS, NOT ZERO AND NOT ONE ───────────
   *
   * Owner's ruling, 2026-10-01. The upload HAPPENED, at `uploadedAt`, and the
   * deletion happened at `deletedAt` — they are two events about one row and a
   * log that collapsed them would be answering "what happened to this load"
   * with the one event most likely to be asked about.
   *
   * THERE IS NO `deletedBy` COLUMN, so the actor comes from the `AuditLog` row
   * for the delete. That is passed in as `deletedBy` rather than looked up
   * here, because this function does no I/O — and because the caller already
   * holds those rows for the field-edit stream.
   */
  deletedAt: Date | null
}

/** A note — a `Communication` row of type NOTE. */
export interface ActivityNoteSource {
  id: string
  occurredAt: Date
  body: string
  user: { name: string | null } | null
}

/**
 * One entry on the timeline. SIX KINDS THAT DO NOT DRESS ALIKE (§7.10).
 *
 * `created` and `deleted` are split out from `field` here rather than left as
 * an `action` string for the component to branch on, because the component then
 * cannot forget: a `kind` it does not handle is a type error, where an
 * unhandled `action` value renders an empty row.
 */
export type ActivityItem =
  | {
      kind: 'created'
      id: string
      at: Date
      actor: string | null
      via: 'integration' | null
    }
  | {
      kind: 'deleted'
      id: string
      at: Date
      actor: string | null
      via: 'integration' | null
    }
  | {
      kind: 'field'
      id: string
      at: Date
      actor: string | null
      via: 'integration' | null
      entityType: string
      diffs: FieldDiff[]
    }
  | {
      kind: 'status'
      id: string
      at: Date
      actor: string | null
      fromStatus: string | null
      toStatus: string
      outcome: 'APPLIED' | 'REFUSED_STALE'
      source: string
      note: string | null
    }
  | {
      kind: 'document'
      id: string
      at: Date
      actor: string | null
      filename: string
      documentType: DocumentType
    }
  | {
      /**
       * A document that was removed. ITS OWN KIND, not a flag on `document`:
       * the two rows sit at different times with different actors, and a
       * boolean on one entry could only render at one of them.
       */
      kind: 'documentDeleted'
      id: string
      at: Date
      actor: string | null
      filename: string
      documentType: DocumentType
    }
  | { kind: 'note'; id: string; at: Date; actor: string | null; body: string }

/**
 * Every source merged, newest first.
 *
 * `entries` is the output of `activityEntries`, so the money filter has ALREADY
 * been applied and is not reapplied here — one place decides permission, and a
 * second filter would be a second definition of what a role may read.
 *
 * TIES KEEP SOURCE ORDER, which `newestFirst` guarantees and which is not
 * hypothetical: a status event and the note explaining it are written in one
 * transaction and can share a millisecond. Audit rows come first in the
 * argument list so a field edit reads above the status change it caused.
 */
export function mergeActivity(input: {
  entries: readonly ActivityEntry[]
  statuses: readonly ActivityStatusSource[]
  documents: readonly ActivityDocumentSource[]
  notes: readonly ActivityNoteSource[]
  /**
   * Who deleted each document, by document id.
   *
   * `Document` has no `deletedBy`, so this comes from the `AuditLog` DELETE row
   * and the caller supplies it — this function does no I/O. A document id that
   * is absent means we have no audit row for the delete, and the entry then
   * names nobody. See `fromDeletions`.
   */
  deletedBy?: Readonly<Record<string, string | null>>
  /** Translates a status event's own note when it is one of our message keys. */
  renderNote?: (note: string) => string
}): ActivityItem[] {
  const fromAudit: Timed<ActivityItem>[] = input.entries.map((entry) => ({
    at: entry.at,
    value:
      entry.action === 'CREATE'
        ? {
            kind: 'created' as const,
            id: entry.id,
            at: entry.at,
            actor: entry.actor,
            via: entry.via,
          }
        : entry.action === 'DELETE'
          ? {
              kind: 'deleted' as const,
              id: entry.id,
              at: entry.at,
              actor: entry.actor,
              via: entry.via,
            }
          : {
              kind: 'field' as const,
              id: entry.id,
              at: entry.at,
              actor: entry.actor,
              via: entry.via,
              entityType: entry.entityType,
              diffs: entry.diffs,
            },
  }))

  const fromStatuses: Timed<ActivityItem>[] = input.statuses.map((event) => ({
    at: event.occurredAt,
    value: {
      kind: 'status',
      id: event.id,
      at: event.occurredAt,
      actor: event.changedBy?.name ?? null,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      outcome: event.outcome,
      source: event.source,
      // OURS TRANSLATED, A HUMAN'S VERBATIM. §12: the system's own words are
      // chrome and belong in the reader's language; a dispatcher's sentence is
      // evidence and is shown exactly as typed.
      note:
        event.note === null
          ? null
          : (input.renderNote?.(event.note) ?? event.note),
    },
  }))

  const fromDocuments: Timed<ActivityItem>[] = input.documents.map((doc) => ({
    at: doc.uploadedAt,
    value: {
      kind: 'document',
      id: doc.id,
      at: doc.uploadedAt,
      actor: doc.uploadedBy?.name ?? null,
      filename: doc.filename,
      documentType: doc.type,
    },
  }))

  // ── AND A SECOND ROW FOR EACH ONE THAT WAS REMOVED ───────────────────
  //
  // `flatMap` over the same list rather than a second input, so the two rows
  // cannot disagree about the filename or the type — they are one row read
  // twice, which is what they are.
  //
  // THE ACTOR COMES FROM THE AUDIT ROW because `Document` has no `deletedBy`.
  // `deletedBy` below is keyed by document id, built by the caller from the
  // audit rows it already holds; absent means we did not record who, and the
  // entry says nothing rather than naming the uploader by accident — which is
  // the one wrong answer available here, since the uploader is right there on
  // the row.
  const fromDeletions: Timed<ActivityItem>[] = input.documents.flatMap((doc) =>
    doc.deletedAt === null
      ? []
      : [
          {
            at: doc.deletedAt,
            value: {
              kind: 'documentDeleted' as const,
              id: doc.id,
              at: doc.deletedAt,
              actor: input.deletedBy?.[doc.id] ?? null,
              filename: doc.filename,
              documentType: doc.type,
            },
          },
        ],
  )

  const fromNotes: Timed<ActivityItem>[] = input.notes.map((note) => ({
    at: note.occurredAt,
    value: {
      kind: 'note',
      id: note.id,
      at: note.occurredAt,
      actor: note.user?.name ?? null,
      body: note.body,
    },
  }))

  return newestFirst(
    fromAudit,
    fromStatuses,
    fromDocuments,
    fromDeletions,
    fromNotes,
  )
}

/**
 * A column name as a sentence, for the fields nobody has translated.
 *
 * THE FALLBACK, NOT THE MECHANISM. `loads.field.<name>` is checked first and
 * wins wherever it exists; this exists so that a field added to the schema next
 * month renders as "Detention minutes" rather than as nothing, and so the
 * timeline does not have to be updated in lockstep with every migration.
 *
 * The suffixes go because they are storage detail: `Cents` because money is an
 * integer of cents everywhere and the timeline is not the place to relitigate
 * it, `Id` because the value is suppressed anyway, `Bps` for the same reason as
 * cents. A name that is ENTIRELY suffix keeps its original spelling rather than
 * becoming empty.
 *
 * IT LIVES HERE, not in the component, because it is a pure string function
 * with three cases worth testing and a component is not where a guard goes.
 * It was in `ActivityPanel.tsx` until §7.10 merged the two panels and that file
 * went away.
 */
export function humaniseField(name: string): string {
  const trimmed = name.replace(/(Cents|Bps|Id)$/, '') || name
  const spaced = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
