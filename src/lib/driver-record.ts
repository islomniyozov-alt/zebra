import type { DocumentType, Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import {
  activityEntries,
  mergeActivity,
  type ActivityItem,
  type ActivityRow,
} from './load-activity'
import { sundayOf } from './rolling-period'

// ---------------------------------------------------------------------------
// THE DRIVER RECORD TAKES DATATRUCK'S SHAPE (§6.4 part 2, queue item 16).
//
// Eleven tabs over one page, in the brief's order. Each reads what exists
// today; a tab with nothing behind it says so in one sentence. The four readers
// below are what the new tabs need that the long page did not already load —
// the assignment history, the random-testing draws, the thirteen-week counts
// and the driver's own §7.10 timeline — and each is here, not in the page, so
// its order and its shape can be tested.
// ---------------------------------------------------------------------------

export const RECORD_TABS = [
  'main',
  'documents',
  'mobile',
  'recruiting',
  'accounting',
  'safety',
  'assets',
  'statistics',
  'log',
  'tasks',
  'others',
] as const

export type RecordTab = (typeof RECORD_TABS)[number]

/** The tabs with NOTHING behind them today. Each renders one sentence (§6.4). */
export const EMPTY_TABS: readonly RecordTab[] = [
  'mobile',
  'recruiting',
  'tasks',
]

/**
 * The tab in the URL, Main by default; an unrecognised value opens Main
 * (§7.1.6's rule, for the same reason: a stale link should open).
 */
export function recordTabFor(raw: unknown): RecordTab {
  return typeof raw === 'string' &&
    (RECORD_TABS as readonly string[]).includes(raw)
    ? (raw as RecordTab)
    : 'main'
}

/**
 * Which tabs a viewer may see at all. A tab a role may not see is NOT
 * RENDERED — never a tab that goes empty inside. The gates are the ones the
 * panels already carry, decided in `permissions.ts` and applied here.
 */
export function visibleRecordTabs(viewer: {
  maySeePay: boolean
  maySeeCompliance: boolean
  maySeeInspections: boolean
}): RecordTab[] {
  return RECORD_TABS.filter((tab) => {
    if (tab === 'accounting') return viewer.maySeePay
    if (tab === 'documents' || tab === 'safety') return viewer.maySeeCompliance
    return true
  })
}

// ── ASSETS: THE ASSIGNMENT HISTORY ────────────────────────────────────────

export interface AssignmentPeriod {
  id: string
  from: Date
  to: Date | null
  truckUnit: string | null
  trailerUnit: string | null
  companyName: string
  reason: string | null
  byName: string | null
}

/**
 * Every `AssetAssignment` period that names this driver, newest first. The
 * Datatruck import wrote none, so an empty list is the usual case today and
 * the page says so in words rather than drawing an empty table.
 */
export async function assignmentHistoryFor(
  tx: TxClient,
  driverId: string,
): Promise<AssignmentPeriod[]> {
  const rows = await tx.assetAssignment.findMany({
    where: { driverId },
    orderBy: { effectiveFrom: 'desc' },
    take: 100,
    select: {
      id: true,
      effectiveFrom: true,
      effectiveTo: true,
      reason: true,
      truck: { select: { unitNumber: true } },
      trailer: { select: { unitNumber: true } },
      company: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    from: row.effectiveFrom,
    to: row.effectiveTo,
    truckUnit: row.truck?.unitNumber ?? null,
    trailerUnit: row.trailer?.unitNumber ?? null,
    companyName: row.company.name,
    reason: row.reason,
    byName: row.createdBy?.name ?? null,
  }))
}

// ── SAFETY: THE DRAWS THAT SELECTED THIS DRIVER ───────────────────────────

export interface DriverDraw {
  id: string
  year: number
  quarter: number
  drawnAt: Date
  kind: string
  outcome: string
  testedAt: Date | null
  reason: string | null
}

/** Random-testing selections naming this driver, newest draw first. */
export async function drawsForDriver(
  tx: TxClient,
  driverId: string,
): Promise<DriverDraw[]> {
  const rows = await tx.randomSelection.findMany({
    where: { driverId },
    orderBy: { draw: { drawnAt: 'desc' } },
    take: 40,
    select: {
      id: true,
      kind: true,
      outcome: true,
      testedAt: true,
      reason: true,
      draw: { select: { year: true, quarter: true, drawnAt: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    year: row.draw.year,
    quarter: row.draw.quarter,
    drawnAt: row.draw.drawnAt,
    kind: row.kind,
    outcome: row.outcome,
    testedAt: row.testedAt,
    reason: row.reason,
  }))
}

// ── STATISTICS: THIRTEEN SETTLEMENT WEEKS ─────────────────────────────────

export interface ThirteenWeekStats {
  /** The Sunday the window opens on. */
  from: Date
  loads: number
  miles: number
}

/**
 * Loads delivered and miles run in the last thirteen settlement weeks — the
 * window §6.2.9 already draws for pay. Either seat counts: a team load is this
 * driver's load whichever half of the crew they were (`settleableWhere`'s own
 * rule). Miles are the recorded ones where recorded, the dispatched ones
 * otherwise, which is the same fallback the statement line prints.
 */
export async function thirteenWeekStats(
  tx: TxClient,
  driverId: string,
  now: Date,
): Promise<ThirteenWeekStats> {
  const from = sundayOf(now)
  from.setUTCDate(from.getUTCDate() - 7 * 12)
  const rows = await tx.$queryRaw<{ loads: bigint; miles: bigint }[]>`
    SELECT COUNT(*)::bigint AS loads,
           COALESCE(SUM(COALESCE(l."actualMiles", l."dispatchedMiles", 0)), 0)::bigint AS miles
      FROM "Load" l
     WHERE (l."driverId" = ${driverId} OR l."coDriverId" = ${driverId})
       AND l."deletedAt" IS NULL
       AND l."operationalStatus" = 'POD_RECEIVED'
       AND EXISTS (
         SELECT 1 FROM "LoadStatusEvent" e
          WHERE e."loadId" = l."id" AND e."axis" = 'OPERATIONAL'
            AND e."toStatus" = 'POD_RECEIVED' AND e."outcome" = 'APPLIED'
            AND e."occurredAt" >= ${from}
       )
  `
  const row = rows[0]
  return {
    from,
    loads: Number(row?.loads ?? 0),
    miles: Number(row?.miles ?? 0),
  }
}

// ── LOG HISTORY: §7.10'S ONE STREAM, FOR A PERSON ─────────────────────────

const AUDIT_FIELDS = {
  id: true,
  createdAt: true,
  action: true,
  entityType: true,
  entityId: true,
  userAgent: true,
  changes: true,
  user: { select: { name: true } },
} as const

export const DRIVER_ACTIVITY_WINDOW = 200

export interface DriverActivity {
  items: ActivityItem[]
  /** Older audit rows exist beyond the window. */
  truncated: boolean
}

/**
 * The driver's history as ONE stream (§7.10): created, field edits and
 * deletion from `AuditLog` on the driver and on their documents, the documents
 * by their upload, and the notes written against the driver — through the same
 * `activityEntries` the load uses, so money fields are omitted for a viewer who
 * may not see them by the one rule. A status entry is a load's kind of fact and
 * does not apply to a person, so `statuses` is empty by design.
 */
export async function driverActivity(
  tx: TxClient,
  driverId: string,
  viewer: { maySeeMoney: boolean },
  renderNote: (note: string) => string = (note) => note,
): Promise<DriverActivity> {
  const documents = await tx.document.findMany({
    where: { driverId },
    orderBy: { uploadedAt: 'desc' },
    select: {
      id: true,
      uploadedAt: true,
      filename: true,
      type: true,
      deletedAt: true,
      uploadedBy: { select: { name: true } },
    },
  })
  const documentIds = documents.map((document) => document.id)

  const [auditRows, notes] = await Promise.all([
    tx.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'Driver', entityId: driverId },
          ...(documentIds.length
            ? [{ entityType: 'Document', entityId: { in: documentIds } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: DRIVER_ACTIVITY_WINDOW + 1,
      select: AUDIT_FIELDS,
    }),
    tx.communication.findMany({
      where: { driverId, type: 'NOTE' },
      orderBy: { occurredAt: 'desc' },
      take: 50,
      select: {
        id: true,
        occurredAt: true,
        body: true,
        user: { select: { name: true } },
      },
    }),
  ])

  const truncated = auditRows.length > DRIVER_ACTIVITY_WINDOW
  const rows: ActivityRow[] = auditRows
    .slice(0, DRIVER_ACTIVITY_WINDOW)
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      userAgent: row.userAgent,
      user: row.user,
      changes: row.changes as unknown,
    }))

  // WHO REMOVED A DOCUMENT, read off its DELETE row, as the load page does.
  const deletedBy: Record<string, string | null> = {}
  for (const row of auditRows) {
    if (row.entityType !== 'Document' || row.action !== 'DELETE') continue
    if (row.entityId in deletedBy) continue
    deletedBy[row.entityId] = row.user?.name ?? null
  }

  const items = mergeActivity({
    entries: activityEntries(rows, { maySeeMoney: viewer.maySeeMoney }),
    statuses: [],
    documents: documents.map((document) => ({
      id: document.id,
      uploadedAt: document.uploadedAt,
      filename: document.filename,
      type: document.type as DocumentType,
      uploadedBy: document.uploadedBy,
      deletedAt: document.deletedAt,
    })),
    notes: notes.map((note) => ({
      id: note.id,
      occurredAt: note.occurredAt,
      body: note.body,
      user: note.user,
    })),
    deletedBy,
    renderNote,
  })

  return { items, truncated }
}

/** The where-clause the Others tab's facts come from; exported for the page's select. */
export const OTHERS_SELECT = {
  tags: true,
  notes: true,
  kind: true,
} satisfies Prisma.DriverSelect
