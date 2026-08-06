import type { ComplianceType, Prisma } from '@/generated/prisma/client'
import type { CompanyScopeFilter, TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// COMPLIANCE (Phase 4 §5 step 1).
//
// The owner runs a DOT-compliance business, so this is the part of Zebra he
// will judge hardest. What it has to get right is small and unforgiving: a
// truck whose annual inspection lapses is a truck that must not be dispatched,
// and the only thing standing between that and a roadside out-of-service order
// is whether a date appeared on somebody's screen in time.
//
// THE MODEL IS `ComplianceItem`, NOT A NEW TABLE. §3 step 1 asks for
// "migrations for ComplianceRecord"; the schema has carried exactly that shape
// since the init migration under the older name — nullable truck/trailer/driver
// subject, type, issuedAt/expiresAt, notes, documents, soft delete, and the two
// indexes this file's queries need. Flagged in PHASE-4-BRIEF.md §6 and built on
// rather than duplicated: a second model holding the same facts is the shape
// that produced the authority drift check in Phase 2.
//
// STATUS IS DERIVED AT READ TIME, NEVER STORED (§2.2). A stored status is a
// cache that goes stale at midnight — literally, on the night an item expires —
// and this is the one table where being a day out is the whole problem. There
// is no drift check here because there is nothing to drift: the date is the
// fact and the status is a function of it.
//
// SUPERSESSION IS DERIVED TOO. §2.1 wants a renewal to supersede rather than
// overwrite. For one subject and one type, the record with the latest
// `expiresAt` is current and the others are history. No `supersededById`
// column, for the same reason there is no stored status — see §6 flag 4.
// ---------------------------------------------------------------------------

/** Current, expiring within the lead time, or expired. Never stored. */
export type ComplianceStatus = 'current' | 'expiring' | 'expired'

/** The three things a compliance record can hang off. */
export type ComplianceSubject = 'truck' | 'trailer' | 'driver'

export const COMPLIANCE_SUBJECTS: readonly ComplianceSubject[] = [
  'truck',
  'trailer',
  'driver',
]

/**
 * The types this phase builds screens for (§1).
 *
 * `ComplianceType` carries more — `DRUG_TEST`, `MVR`, `IFTA_LICENSE`, `PERMIT`
 * and the rest — and they stay in the enum untouched. The owner named six, and
 * a filter offering fourteen where six are ever used is a filter nobody reads.
 * Records of another type are NOT hidden from the queue; they simply have no
 * chip of their own.
 */
export const TRACKED_TYPES: readonly ComplianceType[] = [
  'ANNUAL_INSPECTION',
  'DOT_INSPECTION',
  'REGISTRATION',
  'INSURANCE_LIABILITY',
  'INSURANCE_CARGO',
  'CDL',
  'MEDICAL_CARD',
]

/** Whole days from `from` to `to`. Negative once `to` is in the past. */
export function daysUntil(to: Date, from: Date): number {
  // Both floored to UTC midnight first. Without that, an item expiring later
  // today reads as 0 days at 9am and -0.4 days at 6pm, and "expires today"
  // would flip to "expired" over lunch.
  const day = 24 * 60 * 60 * 1000
  const a = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  const b = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  )
  return Math.round((a - b) / day)
}

/**
 * The one derivation. The queue, the dashboard row and the asset panels all
 * call this, so the three cannot disagree — which is exactly what §4's first
 * acceptance box asks for.
 *
 * EXPIRES TODAY IS EXPIRING, NOT EXPIRED. A registration valid through the 31st
 * is valid ON the 31st; calling it expired that morning would ground a truck a
 * day early, and a compliance screen that cries wolf gets ignored.
 */
export function statusFor(
  expiresAt: Date,
  leadDays: number,
  now: Date = new Date(),
): ComplianceStatus {
  const days = daysUntil(expiresAt, now)
  if (days < 0) return 'expired'
  if (days <= leadDays) return 'expiring'
  return 'current'
}

export interface ComplianceRow {
  id: string
  companyId: string
  companyName: string
  type: ComplianceType
  subject: ComplianceSubject
  subjectId: string
  /** Unit number or driver name — what a person calls the thing. */
  subjectLabel: string
  identifier: string | null
  issuer: string | null
  issuedAt: Date | null
  expiresAt: Date
  daysLeft: number
  status: ComplianceStatus
  /** A newer record of the same type covers this subject. History, not alarm. */
  isSuperseded: boolean
  notes: string | null
  documentCount: number
}

const SELECT = {
  id: true,
  companyId: true,
  type: true,
  identifier: true,
  issuer: true,
  issuedAt: true,
  expiresAt: true,
  notes: true,
  company: { select: { name: true } },
  truck: { select: { id: true, unitNumber: true } },
  trailer: { select: { id: true, unitNumber: true } },
  driver: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { documents: true } },
} satisfies Prisma.ComplianceItemSelect

/**
 * Turn stored rows into read rows: derive the status, the days left, and which
 * ones a newer record has taken over from.
 *
 * Exported so the same shaping runs over a whole fleet's queue and over one
 * asset's panel, from one function.
 */
export function shapeRecords(
  rows: readonly {
    id: string
    companyId: string
    type: ComplianceType
    identifier: string | null
    issuer: string | null
    issuedAt: Date | null
    expiresAt: Date
    notes: string | null
    company: { name: string }
    truck: { id: string; unitNumber: string } | null
    trailer: { id: string; unitNumber: string } | null
    driver: { id: string; firstName: string; lastName: string } | null
    _count: { documents: number }
  }[],
  leadDays: number,
  now: Date = new Date(),
): ComplianceRow[] {
  // SUPERSESSION, computed once over the whole set. For each
  // (subject, subjectId, type) the latest `expiresAt` is the live one; every
  // older record of that pair is history. Ties keep both — two records with the
  // same expiry is a data problem, and silently picking one would hide it.
  const latest = new Map<string, number>()
  const keyOf = (row: (typeof rows)[number]) => {
    const subjectId = row.truck?.id ?? row.trailer?.id ?? row.driver?.id ?? ''
    return `${subjectId}:${row.type}`
  }
  for (const row of rows) {
    const key = keyOf(row)
    const at = row.expiresAt.getTime()
    if (!latest.has(key) || at > latest.get(key)!) latest.set(key, at)
  }

  return rows.flatMap((row) => {
    const subject: ComplianceSubject | null = row.truck
      ? 'truck'
      : row.trailer
        ? 'trailer'
        : row.driver
          ? 'driver'
          : null

    // A record attached to nothing is not something to render. The columns are
    // all nullable, so the row can exist; it cannot be shown against an asset
    // because there is no asset. Dropped rather than displayed as "—".
    if (!subject) return []

    const subjectId = (row.truck ?? row.trailer ?? row.driver)!.id
    const subjectLabel = row.driver
      ? `${row.driver.firstName} ${row.driver.lastName}`
      : (row.truck ?? row.trailer)!.unitNumber

    return [
      {
        id: row.id,
        companyId: row.companyId,
        companyName: row.company.name,
        type: row.type,
        subject,
        subjectId,
        subjectLabel,
        identifier: row.identifier,
        issuer: row.issuer,
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
        daysLeft: daysUntil(row.expiresAt, now),
        status: statusFor(row.expiresAt, leadDays, now),
        isSuperseded: row.expiresAt.getTime() < (latest.get(keyOf(row)) ?? 0),
        notes: row.notes,
        documentCount: row._count.documents,
      },
    ]
  })
}

export interface ComplianceQuery {
  subject?: ComplianceSubject
  type?: ComplianceType
  /** Include records a newer one has replaced. Off by default. */
  includeSuperseded?: boolean
}

/**
 * The lead time, per authority, from the settings that have existed since
 * Phase 1 with nothing reading them (§2.3).
 *
 * One number for the whole read rather than one per row: the queue spans
 * authorities and the horizon is a business policy, so the SHORTEST lead time
 * in scope wins. A carrier that wants thirty days' warning and one that wants
 * sixty should both be warned at sixty — warning early is free, warning late
 * is a truck at a scale house.
 */
export async function leadDaysFor(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
): Promise<number> {
  const settings = await tx.companySettings.findMany({
    where: scope,
    select: { complianceWarnDays: true },
  })
  if (settings.length === 0) return 30
  return Math.max(...settings.map((row) => row.complianceWarnDays))
}

/**
 * Everything expiring or already expired, worst first.
 *
 * Current records are excluded — this is a QUEUE, and a queue that lists the
 * things needing nothing is a list nobody works from. The asset panels (step 2)
 * show the full history.
 */
export async function complianceQueue(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
  query: ComplianceQuery = {},
  now: Date = new Date(),
): Promise<{ rows: ComplianceRow[]; leadDays: number }> {
  const leadDays = await leadDaysFor(tx, scope)

  // The horizon in SQL, so the queue does not read the whole table to throw
  // most of it away. The boundary is generous by a day at each end and the
  // exact call is made by `statusFor` afterwards — one derivation, per §4.
  const horizon = new Date(now.getTime())
  horizon.setUTCDate(horizon.getUTCDate() + leadDays + 1)

  const rows = await tx.complianceItem.findMany({
    where: {
      ...scope,
      deletedAt: null,
      expiresAt: { lte: horizon },
      ...(query.type ? { type: query.type } : {}),
      ...subjectWhere(query.subject),
    },
    orderBy: { expiresAt: 'asc' },
    take: 500,
    select: SELECT,
  })

  const shaped = shapeRecords(rows, leadDays, now).filter(
    (row) => row.status !== 'current',
  )

  return {
    rows: query.includeSuperseded
      ? shaped
      : // A lapsed registration that has already been renewed is history, not
        // work. Showing it would put a red row on the screen for a truck that
        // is entirely legal, and the queue would train people to ignore red.
        shaped.filter((row) => !row.isSuperseded),
    leadDays,
  }
}

/** `{ truckId: { not: null } }` and friends — the subject filter. */
function subjectWhere(
  subject: ComplianceSubject | undefined,
): Prisma.ComplianceItemWhereInput {
  if (subject === 'truck') return { truckId: { not: null } }
  if (subject === 'trailer') return { trailerId: { not: null } }
  if (subject === 'driver') return { driverId: { not: null } }
  return {}
}

/** How many need attention, for the dashboard row. Same predicate, counted. */
export async function complianceCount(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
  now: Date = new Date(),
): Promise<{ count: number; expired: number }> {
  const { rows } = await complianceQueue(tx, scope, {}, now)
  return {
    count: rows.length,
    expired: rows.filter((row) => row.status === 'expired').length,
  }
}

/**
 * Every record for one asset, newest expiry first, history included.
 *
 * The panel counterpart to the queue (step 2 renders it). Superseded records
 * are kept and marked, because §2.1's whole point is that the old registration
 * stays visible.
 */
export async function recordsForSubject(
  tx: TxClient,
  subject: ComplianceSubject,
  subjectId: string,
  now: Date = new Date(),
): Promise<ComplianceRow[]> {
  const rows = await tx.complianceItem.findMany({
    where: {
      deletedAt: null,
      ...(subject === 'truck' ? { truckId: subjectId } : {}),
      ...(subject === 'trailer' ? { trailerId: subjectId } : {}),
      ...(subject === 'driver' ? { driverId: subjectId } : {}),
    },
    orderBy: { expiresAt: 'desc' },
    select: SELECT,
  })

  const leadDays = await leadDaysFor(
    tx,
    rows[0] ? { companyId: { in: [rows[0].companyId] } } : {},
  )
  return shapeRecords(rows, leadDays, now)
}
