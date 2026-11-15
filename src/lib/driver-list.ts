import {
  Prisma,
  type DriverStatus,
  type DriverType,
} from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { asDate, asNumber } from './sql-json'

// ---------------------------------------------------------------------------
// THE DRIVERS LIST TAKES DATATRUCK'S SHAPE (§6.4 part 1, queue item 16).
//
// Two things the page cannot own, because a page cannot be unit-tested and
// both are rules: which rows each TAB selects, and when a driver is READY TO
// GO. Both are pure where they can be and asked of the database in one place
// where they cannot.
// ---------------------------------------------------------------------------

/**
 * Five tabs over one grid (§7.1.6), each a different QUESTION:
 *
 *   active      the roster at work — not removed, not INACTIVE, not VACATION
 *   unassigned  active, with no truck — the dispatcher's own question
 *   all         every roster row; a REMOVED row is a mistake, not a person,
 *               and stays behind the existing toggle rather than in a tab
 *   terminated  INACTIVE, with the termination date as a column
 *   vacation    VACATION, or an off-duty return date still ahead
 */
export const DRIVER_TABS = [
  'active',
  'unassigned',
  'all',
  'terminated',
  'vacation',
] as const

export type DriverTab = (typeof DRIVER_TABS)[number]

export function isDriverTab(value: string): value is DriverTab {
  return (DRIVER_TABS as readonly string[]).includes(value)
}

/** The roster "at work": everything that is not on holiday and not gone. */
export const WORKING_STATUSES: readonly DriverStatus[] = [
  'AVAILABLE',
  'DISPATCHED',
  'ON_ROUTE',
  'OFF_DUTY',
]

/**
 * THE ACTIVE DRIVERS, as ONE predicate (§6.6, queue item 20 (6)).
 *
 * The Active tab's population — live rows on a working roster value — and
 * PEOPLE: a referral payee is a commission and cannot be in a truck, which is
 * why §6.5 part 0b's data-health base already left it out. The accident
 * register's picker read "not removed" and listed terminated drivers and
 * payees beside the people who could have been at the wheel. Both readers go
 * through this now, so "active" means one thing on every screen that says it.
 */
export function activeDriversWhere(): Prisma.DriverWhereInput {
  return {
    deletedAt: null,
    status: { in: [...WORKING_STATUSES] },
    kind: { not: 'PAYEE' },
  }
}

/**
 * The rows a tab selects. `includeRemoved` is the page's existing toggle and
 * widens the tab to the rows somebody soft-deleted — it is a question about
 * mistakes, orthogonal to every tab, which is why it is a flag and not a sixth.
 */
export function driverTabWhere(
  tab: DriverTab,
  now: Date,
  includeRemoved = false,
): Prisma.DriverWhereInput {
  const kept: Prisma.DriverWhereInput = includeRemoved
    ? {}
    : { deletedAt: null }
  switch (tab) {
    case 'active':
      return { ...kept, status: { in: [...WORKING_STATUSES] } }
    case 'unassigned':
      return {
        ...kept,
        status: { in: [...WORKING_STATUSES] },
        assignedTruckId: null,
      }
    case 'all':
      return kept
    case 'terminated':
      return { ...kept, status: 'INACTIVE' }
    case 'vacation':
      return {
        ...kept,
        OR: [{ status: 'VACATION' }, { offDutyUntil: { gt: now } }],
      }
  }
}

/**
 * What every tab of the list is narrowed by before its own question: the
 * session's authority scope (empty is unrestricted, as `companyScopeFilter`),
 * the authority chip and the tag chip.
 */
export interface DriverListBase {
  companyScopes: readonly string[]
  companyId?: string | null
  tag?: string | null
}

/** The base as the list's `driver.findMany` spreads it. */
export function driverListBaseWhere(
  base: DriverListBase,
): Prisma.DriverWhereInput {
  return {
    ...(base.companyScopes.length > 0
      ? { companyId: { in: [...base.companyScopes] } }
      : {}),
    ...(base.companyId ? { companyId: base.companyId } : {}),
    ...(base.tag ? { tags: { has: base.tag } } : {}),
  }
}

/**
 * THE SAME BASE AND THE SAME TAB QUESTIONS, AS SQL OVER `"Driver" d` (§6.4
 * part 1 v11.02). The five counts are one `COUNT(*) FILTER` each, so the head
 * of `/drivers` is one statement and not five; `driverTabWhere` above stays
 * the list's own predicate. TWO SPELLINGS OF ONE RULE, so the enforcer is
 * named: `tests/integration/drivers-page.test.ts` holds every tab's count
 * here equal to `driver.count` through `driverTabWhere`, with and without
 * removed rows, scoped, chipped and tagged.
 */
function driverBaseSql(base: DriverListBase): Prisma.Sql {
  const scopes = [...base.companyScopes]
  return Prisma.sql`(${scopes.length === 0} OR d."companyId" = ANY(${scopes}::text[]))
       AND (${base.companyId ?? null}::text IS NULL OR d."companyId" = ${base.companyId ?? null})
       AND (${base.tag ?? null}::text IS NULL OR ${base.tag ?? null} = ANY(d."tags"))`
}

export function driverTabSql(
  tab: DriverTab,
  now: Date,
  includeRemoved = false,
): Prisma.Sql {
  const kept = includeRemoved
    ? Prisma.sql`TRUE`
    : Prisma.sql`d."deletedAt" IS NULL`
  const working = Prisma.sql`d."status"::text = ANY(${[...WORKING_STATUSES]}::text[])`
  switch (tab) {
    case 'active':
      return Prisma.sql`${kept} AND ${working}`
    case 'unassigned':
      return Prisma.sql`${kept} AND ${working} AND d."assignedTruckId" IS NULL`
    case 'all':
      return kept
    case 'terminated':
      return Prisma.sql`${kept} AND d."status"::text = 'INACTIVE'`
    case 'vacation':
      return Prisma.sql`${kept} AND (d."status"::text = 'VACATION' OR d."offDutyUntil" > ${now})`
  }
}

/** The five counts as one SELECT returning one row, a column per tab. */
export function driverTabCountsSql(
  base: DriverListBase,
  now: Date,
  includeRemoved = false,
): Prisma.Sql {
  return Prisma.sql`SELECT ${Prisma.join(
    DRIVER_TABS.map(
      (tab) =>
        Prisma.sql`COUNT(*) FILTER (WHERE ${driverTabSql(tab, now, includeRemoved)})::int AS ${Prisma.raw(`"${tab}"`)}`,
    ),
    ', ',
  )}
      FROM "Driver" d
     WHERE ${driverBaseSql(base)}`
}

/** `driverTabCountsSql`'s row, from either transport, as the page's record. */
export function driverTabCountsFrom(
  row: Partial<Record<DriverTab, unknown>> | null | undefined,
): Record<DriverTab, number> {
  return Object.fromEntries(
    DRIVER_TABS.map((tab) => [tab, asNumber(row?.[tab])]),
  ) as Record<DriverTab, number>
}

// ── THE LIST AS SQL (§6.4 part 1 v11.04) ─────────────────────────────────
//
// The page's `driver.findMany`, spelled as SQL so it can ride in the head's
// one `zebra_tenant_read` call. A THIRD SPELLING OF THE TAB RULE, so its
// enforcer is named: `tests/integration/drivers-page.test.ts` holds these rows
// equal to `driver.findMany` through `driverTabWhere` and `driverHealthWhere`
// — ids in order and every column — for every tab, removed or not, scoped,
// chipped, tagged and under each health filter.

/** One listed driver: the columns the page shows and nothing else (no pay). */
export interface DriverListRow {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  cdlNumber: string | null
  cdlState: string | null
  status: DriverStatus
  driverType: DriverType
  deletedAt: Date | null
  terminationDate: Date | null
  offDutyUntil: Date | null
  tags: string[]
  company: { name: string }
  assignedTruck: { id: string; unitNumber: string } | null
}

/**
 * The listed drivers, at most `cap`, ordered by authority name, last name and
 * then id — the id so two runs of the same question list the same order.
 * The order is also a column, `ord`, so a caller that wraps this text (the
 * head's `json_agg`) can keep it without restating it.
 * `filter` is a further predicate over `d` (the health filter), or null.
 */
export function driverListSql(input: {
  base: DriverListBase
  tab: DriverTab
  now: Date
  includeRemoved: boolean
  filter: Prisma.Sql | null
  cap: number
}): Prisma.Sql {
  return Prisma.sql`
    SELECT d.id, d."firstName", d."lastName", d.phone, d.email,
           d."cdlNumber", d."cdlState", d.status::text AS status,
           d."driverType"::text AS "driverType", d."deletedAt",
           d."terminationDate", d."offDutyUntil", d.tags,
           c.name AS "companyName", t.id AS "truckId",
           t."unitNumber" AS "truckUnitNumber",
           row_number() OVER (ORDER BY c.name ASC, d."lastName" ASC, d.id ASC) AS ord
      FROM "Driver" d
      JOIN "Company" c ON c.id = d."companyId"
      LEFT JOIN "Truck" t ON t.id = d."assignedTruckId"
     WHERE ${driverBaseSql(input.base)}
       AND ${driverTabSql(input.tab, input.now, input.includeRemoved)}
       AND ${input.filter ?? Prisma.sql`TRUE`}
     ORDER BY ord
     LIMIT ${input.cap}`
}

/** `driverListSql`'s row as JSON, from either transport. */
export interface DriverListSqlRow {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  cdlNumber: string | null
  cdlState: string | null
  status: string
  driverType: string
  deletedAt: unknown
  terminationDate: unknown
  offDutyUntil: unknown
  tags: string[] | null
  companyName: string
  truckId: string | null
  truckUnitNumber: string | null
}

export function driverListFrom(
  rows: readonly DriverListSqlRow[],
): DriverListRow[] {
  return rows.map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    email: row.email,
    cdlNumber: row.cdlNumber,
    cdlState: row.cdlState,
    status: row.status as DriverStatus,
    driverType: row.driverType as DriverType,
    deletedAt: asDate(row.deletedAt),
    terminationDate: asDate(row.terminationDate),
    offDutyUntil: asDate(row.offDutyUntil),
    tags: row.tags ?? [],
    company: { name: row.companyName },
    assignedTruck:
      row.truckId !== null && row.truckUnitNumber !== null
        ? { id: row.truckId, unitNumber: row.truckUnitNumber }
        : null,
  }))
}

/**
 * Every tab's count, by a COUNT(*) of its own question (§6.2.8) — never by the
 * length of a capped list. ONE statement for the whole page (v11.02).
 */
export async function countDriverTabs(
  tx: TxClient,
  base: DriverListBase,
  now: Date,
  includeRemoved = false,
): Promise<Record<DriverTab, number>> {
  const rows = await tx.$queryRaw<Partial<Record<DriverTab, unknown>>[]>(
    driverTabCountsSql(base, now, includeRemoved),
  )
  return driverTabCountsFrom(rows[0])
}

// ── ASSIGN STATUS — READY TO GO / NOT READY ────────────────────────────────

export type NotReadyReason =
  | 'not_qualifiable'
  | 'dqf'
  | 'no_truck'
  | 'truck_expired'

export interface Readiness {
  ready: boolean
  /** The FIRST reason, in the order a dispatcher would fix them. Null when ready. */
  reason: NotReadyReason | null
}

export interface ReadinessFacts {
  /** On the roster and a person — §6.2's DQF rule (`isQualifiable`). */
  qualifiable: boolean
  /** Missing or expired DQF entries (`dqfIncompleteCount`). */
  dqfIncomplete: number
  truckAssigned: boolean
  /** The assigned truck carries an expired compliance item. */
  truckExpired: boolean
}

/**
 * Derived on read, never stored (§6.4). A driver is ready when they are
 * qualifiable, their DQF has nothing missing or expired, a truck is assigned,
 * and that truck carries no expired compliance. "Not ready" names the FIRST
 * reason, because a red that does not say why is a red people learn to ignore.
 */
export function readinessFor(facts: ReadinessFacts): Readiness {
  if (!facts.qualifiable) return { ready: false, reason: 'not_qualifiable' }
  if (facts.dqfIncomplete > 0) return { ready: false, reason: 'dqf' }
  if (!facts.truckAssigned) return { ready: false, reason: 'no_truck' }
  if (facts.truckExpired) return { ready: false, reason: 'truck_expired' }
  return { ready: true, reason: null }
}
