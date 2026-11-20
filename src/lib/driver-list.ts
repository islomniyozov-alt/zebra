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
 * THREE TABS OVER ONE GRID (§6.4 part 1 v11.38, owner's ruling 2026-11-19),
 * each a different QUESTION, and Active + Inactive = All:
 *
 *   active    every person still employed — not removed, not INACTIVE (a
 *             driver on VACATION is Active)
 *   inactive  INACTIVE, with the termination date as a column — what the
 *             Terminated tab was, renamed
 *   all       every roster row; a REMOVED row is a mistake, not a person,
 *             and stays behind the existing toggle rather than in a tab
 *
 * Unassigned and the Vacation board were tabs until the same ruling; they are
 * now CHIPS (`DRIVER_CHIPS`) narrowing whichever tab is open.
 */
export const DRIVER_TABS = ['active', 'inactive', 'all'] as const

export type DriverTab = (typeof DRIVER_TABS)[number]

export function isDriverTab(value: string): value is DriverTab {
  return (DRIVER_TABS as readonly string[]).includes(value)
}

/**
 * The two filter chips (v11.38), each ANDed with the open tab:
 *
 *   unassigned  a working driver with no truck — the dispatcher's question
 *   vacation    VACATION, or an off-duty return date still ahead
 */
export const DRIVER_CHIPS = ['unassigned', 'vacation'] as const

export type DriverChip = (typeof DRIVER_CHIPS)[number]

export function isDriverChip(value: string): value is DriverChip {
  return (DRIVER_CHIPS as readonly string[]).includes(value)
}

/**
 * The tab and chip a URL asks for. OLD LINKS STILL OPEN (v11.38):
 * `tab=terminated` is Inactive; `tab=unassigned` and `tab=vacation` are Active
 * with that chip. Anything unrecognised opens Active with no chip (§7.1.6).
 */
export function driverViewFromUrl(
  rawTab: unknown,
  rawChip: unknown,
): { tab: DriverTab; chip: DriverChip | null } {
  const tabText = typeof rawTab === 'string' ? rawTab : ''
  const chipText = typeof rawChip === 'string' ? rawChip : ''
  const chip = isDriverChip(chipText) ? chipText : null
  if (isDriverTab(tabText)) return { tab: tabText, chip }
  if (tabText === 'terminated') return { tab: 'inactive', chip }
  if (isDriverChip(tabText)) return { tab: 'active', chip: chip ?? tabText }
  return { tab: 'active', chip }
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
 * mistakes, orthogonal to every tab, which is why it is a flag and not a tab.
 */
export function driverTabWhere(
  tab: DriverTab,
  includeRemoved = false,
): Prisma.DriverWhereInput {
  const kept: Prisma.DriverWhereInput = includeRemoved
    ? {}
    : { deletedAt: null }
  switch (tab) {
    case 'active':
      return { ...kept, status: { not: 'INACTIVE' } }
    case 'inactive':
      return { ...kept, status: 'INACTIVE' }
    case 'all':
      return kept
  }
}

/** The rows a chip keeps, ANDed with the tab's. */
export function driverChipWhere(
  chip: DriverChip,
  now: Date,
): Prisma.DriverWhereInput {
  switch (chip) {
    case 'unassigned':
      return { status: { in: [...WORKING_STATUSES] }, assignedTruckId: null }
    case 'vacation':
      return { OR: [{ status: 'VACATION' }, { offDutyUntil: { gt: now } }] }
  }
}

// ── SEARCH (v11.38): name, phone, assigned truck unit ─────────────────────
//
// Every word typed must match ONE of first name, last name, phone or the
// assigned truck's unit, case-insensitive, as a substring. LIKE's wildcards
// and its escape character are dropped from a term rather than escaped: a
// driver's name, phone or unit has none of them, and dropping them makes the
// SQL spelling below and Prisma's `contains` one rule with nothing to agree
// about. At most five words of forty characters each.

/** The words a search box's text searches for; empty means no search. */
export function searchTerms(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .replace(/[%_\\]/g, '')
    .split(/\s+/)
    .map((term) => term.slice(0, 40))
    .filter((term) => term !== '')
    .slice(0, 5)
}

/** The search as the list's `driver.findMany` spreads it. */
export function driverSearchWhere(
  terms: readonly string[],
): Prisma.DriverWhereInput {
  if (terms.length === 0) return {}
  return {
    AND: terms.map((term) => ({
      OR: [
        { firstName: { contains: term, mode: 'insensitive' as const } },
        { lastName: { contains: term, mode: 'insensitive' as const } },
        { phone: { contains: term, mode: 'insensitive' as const } },
        {
          assignedTruck: {
            is: {
              unitNumber: { contains: term, mode: 'insensitive' as const },
            },
          },
        },
      ],
    })),
  }
}

/**
 * The column a view brings of its own (§6.4 part 1): Inactive prints when the
 * driver left, the Vacation chip prints the return. Null otherwise.
 */
export function tabDateColumn(
  tab: DriverTab,
  chip: DriverChip | null = null,
): 'terminated' | 'returns' | null {
  if (tab === 'inactive') return 'terminated'
  if (chip === 'vacation') return 'returns'
  return null
}

/**
 * THE TAB'S DATE COLUMN TAKES A SEAT, IT DOES NOT ADD ONE (§6.4 part 1
 * v11.30). The chooser bounds the chosen set by the grid's cap, so a full set
 * plus the tab's date was one column past it — `Table` refused the render and
 * Terminated and Vacation answered 500 for every person with nine columns
 * shown, the multi-authority default among them.
 *
 * Under the cap the date is added. At the cap it takes Last activity's place;
 * without Last activity, the last chosen column before Warnings. The first
 * chosen column (the name, which the chooser locks) and Warnings are never
 * given up. The result is in the chosen order with the date appended; the page's
 * `keepColumns` puts it back in the table's own order.
 */
export function fitTabColumn(
  visible: readonly string[],
  tabColumn: string | null,
  cap: number,
): string[] {
  const chosen = visible.filter(
    (key) => key !== 'terminated' && key !== 'returns',
  )
  if (tabColumn === null) return chosen.slice(0, cap)
  if (chosen.length < cap) return [...chosen, tabColumn]
  const kept = chosen.slice(0, cap)
  const giveUp = kept.includes('lastActivity')
    ? 'lastActivity'
    : [...kept].reverse().find((key, index, reversed) => {
        const at = reversed.length - 1 - index
        return at > 0 && key !== 'warnings'
      })
  if (giveUp === undefined) return kept
  return [...kept.filter((key) => key !== giveUp), tabColumn]
}

/**
 * What every tab of the list is narrowed by before its own question: the
 * session's authority scope (empty is unrestricted, as `companyScopeFilter`),
 * the authority chip, the tag chip and the search (v11.38 — so the tab and
 * chip counts describe the rows the search leaves, never rows it has hidden).
 */
export interface DriverListBase {
  companyScopes: readonly string[]
  companyId?: string | null
  tag?: string | null
  /** `searchTerms` of the search box; empty or absent means no search. */
  search?: readonly string[]
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
    ...driverSearchWhere(base.search ?? []),
  }
}

/**
 * THE SAME BASE AND THE SAME TAB QUESTIONS, AS SQL OVER `"Driver" d` (§6.4
 * part 1 v11.02). The counts are one `COUNT(*) FILTER` each, so the head
 * of `/drivers` is one statement and not five; `driverTabWhere` above stays
 * the list's own predicate. TWO SPELLINGS OF ONE RULE, so the enforcer is
 * named: `tests/integration/drivers-page.test.ts` holds every tab's count
 * here equal to `driver.count` through `driverTabWhere`, with and without
 * removed rows, scoped, chipped and tagged.
 */
/** `driverSearchWhere`, spelled over `"Driver" d`. */
function driverSearchSql(terms: readonly string[]): Prisma.Sql {
  if (terms.length === 0) return Prisma.sql`TRUE`
  return Prisma.join(
    terms.map((term) => {
      const pattern = `%${term}%`
      return Prisma.sql`(d."firstName" ILIKE ${pattern}
          OR d."lastName" ILIKE ${pattern}
          OR d.phone ILIKE ${pattern}
          OR EXISTS (SELECT 1 FROM "Truck" st
                      WHERE st.id = d."assignedTruckId"
                        AND st."unitNumber" ILIKE ${pattern}))`
    }),
    ' AND ',
  )
}

function driverBaseSql(base: DriverListBase): Prisma.Sql {
  const scopes = [...base.companyScopes]
  return Prisma.sql`(${scopes.length === 0} OR d."companyId" = ANY(${scopes}::text[]))
       AND (${base.companyId ?? null}::text IS NULL OR d."companyId" = ${base.companyId ?? null})
       AND (${base.tag ?? null}::text IS NULL OR ${base.tag ?? null} = ANY(d."tags"))
       AND ${driverSearchSql(base.search ?? [])}`
}

export function driverTabSql(
  tab: DriverTab,
  includeRemoved = false,
): Prisma.Sql {
  const kept = includeRemoved
    ? Prisma.sql`TRUE`
    : Prisma.sql`d."deletedAt" IS NULL`
  switch (tab) {
    case 'active':
      return Prisma.sql`${kept} AND d."status"::text <> 'INACTIVE'`
    case 'inactive':
      return Prisma.sql`${kept} AND d."status"::text = 'INACTIVE'`
    case 'all':
      return kept
  }
}

/** `driverChipWhere`, spelled over `"Driver" d`. */
export function driverChipSql(chip: DriverChip, now: Date): Prisma.Sql {
  switch (chip) {
    case 'unassigned':
      return Prisma.sql`d."status"::text = ANY(${[...WORKING_STATUSES]}::text[]) AND d."assignedTruckId" IS NULL`
    case 'vacation':
      return Prisma.sql`(d."status"::text = 'VACATION' OR d."offDutyUntil" > ${now})`
  }
}

/** A count per tab, and per chip INSIDE the open tab. */
export type DriverCounts = Record<DriverTab | DriverChip, number>

/**
 * The three tab counts and the two chip counts as one SELECT returning one
 * row. A chip counts inside `tab` — the tab the person is looking at.
 */
export function driverTabCountsSql(
  base: DriverListBase,
  now: Date,
  includeRemoved: boolean,
  tab: DriverTab,
): Prisma.Sql {
  return Prisma.sql`SELECT ${Prisma.join(
    [
      ...DRIVER_TABS.map(
        (key) =>
          Prisma.sql`COUNT(*) FILTER (WHERE ${driverTabSql(key, includeRemoved)})::int AS ${Prisma.raw(`"${key}"`)}`,
      ),
      ...DRIVER_CHIPS.map(
        (chip) =>
          Prisma.sql`COUNT(*) FILTER (WHERE ${driverTabSql(tab, includeRemoved)} AND ${driverChipSql(chip, now)})::int AS ${Prisma.raw(`"${chip}"`)}`,
      ),
    ],
    ', ',
  )}
      FROM "Driver" d
     WHERE ${driverBaseSql(base)}`
}

/** `driverTabCountsSql`'s row, from either transport, as the page's record. */
export function driverTabCountsFrom(
  row: Partial<Record<DriverTab | DriverChip, unknown>> | null | undefined,
): DriverCounts {
  return Object.fromEntries(
    [...DRIVER_TABS, ...DRIVER_CHIPS].map((key) => [key, asNumber(row?.[key])]),
  ) as DriverCounts
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
 * `filter` is a further predicate over `d` (the health filter), or null;
 * `chip` narrows the tab (v11.38), or null.
 */
export function driverListSql(input: {
  base: DriverListBase
  tab: DriverTab
  chip: DriverChip | null
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
       AND ${driverTabSql(input.tab, input.includeRemoved)}
       AND ${input.chip ? driverChipSql(input.chip, input.now) : Prisma.sql`TRUE`}
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
  tab: DriverTab = 'active',
): Promise<DriverCounts> {
  const rows = await tx.$queryRaw<
    Partial<Record<DriverTab | DriverChip, unknown>>[]
  >(driverTabCountsSql(base, now, includeRemoved, tab))
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
