import { Prisma } from '@/generated/prisma/client'
import type { TruckHealthCheck } from './data-health'
import type { TxClient } from './tenancy'
import {
  TRUCK_STATUS_ORDER,
  TRUCK_VIEWS,
  type TruckListParams,
  type TruckViewName,
} from './truck-list'

// ---------------------------------------------------------------------------
// EVERY NUMBER ON THE TRUCKS LIST'S BAR AND IN ITS FOOTER, IN ONE STATEMENT
// (TMS-DESIGN-SYSTEM.md §6.5 part 1).
//
// Four view chips and up to seven status chips would be eleven counts a
// render; at 200 ms a statement from Dushanbe that is the whole page's budget
// twice over. This reads the list's base set ONCE, tags each truck with its
// status, whether it is removed, which views hold it and whether it passes the
// status filter, and groups by them. `truckChipCounts` derives every figure
// from the groups by the rule the bar has always used: a chip honours every
// OTHER filter and ignores its own group; a footer chip reports the view.
//
// ── THE SQL IS A SECOND EXPRESSION AND THE TEST IS THE MITIGATION ──────────
//
// The list's rows come from the Prisma predicates in `truck-list.ts`, and those
// stay the definition. This file restates them in SQL, as `load-list-counts.ts`
// does for the loads list, and `tests/integration/truck-list.test.ts` runs
// both over the same rows and requires the same number PER VIEW AND PER STATUS
// CHIP, named, so a drift fails by the chip's own name.
// ---------------------------------------------------------------------------

/** One group of the statement: trucks sharing a status and the same flags. */
export interface TruckCountGroup {
  status: string
  removed: boolean
  active: boolean
  unassigned: boolean
  inactive: boolean
  /** Passes the `?status=` filter (always true when none is set). */
  statusOk: boolean
  n: number
}

/** The status chips' keys: the six values, and Removed. */
export type StatusChip = (typeof TRUCK_STATUS_ORDER)[number] | 'REMOVED'

export interface TruckChipCounts {
  /** Each view chip, under every filter except the view. */
  views: Record<TruckViewName, number>
  /** The footer: every filter and the view, by the Status column's value. */
  status: Record<StatusChip, number>
  /** The rows the view selects — the footer's total. */
  matching: number
}

const inView = (group: TruckCountGroup, view: TruckViewName): boolean => {
  switch (view) {
    case 'active':
      return group.active
    case 'unassigned':
      return group.unassigned
    case 'all':
      return true
    case 'inactive':
      return group.inactive
  }
}

/**
 * Every chip, from the groups. THE SAME RULE AS THE PRISMA COUNTS IN
 * `truck-list.ts`: a view chip honours the status filter and replaces the
 * active view; a status chip honours everything, the view included, and keys
 * a removed row under `REMOVED` whatever its stored status says.
 *
 * Every key starts at zero, so a chip with nothing behind it reads 0 rather
 * than vanishing (§7.1.6's rule for a count).
 */
export function truckChipCounts(
  groups: readonly TruckCountGroup[],
  view: TruckViewName,
): TruckChipCounts {
  const counts: TruckChipCounts = {
    views: { active: 0, unassigned: 0, all: 0, inactive: 0 },
    status: { ...zeroStatus() },
    matching: 0,
  }
  for (const group of groups) {
    if (!group.statusOk) continue
    for (const name of TRUCK_VIEWS) {
      if (inView(group, name)) counts.views[name] += group.n
    }
    if (inView(group, view)) {
      const chip: StatusChip = group.removed
        ? 'REMOVED'
        : (group.status as StatusChip)
      counts.status[chip] = (counts.status[chip] ?? 0) + group.n
      counts.matching += group.n
    }
  }
  return counts
}

function zeroStatus(): Record<StatusChip, number> {
  const zero = { REMOVED: 0 } as Record<StatusChip, number>
  for (const status of TRUCK_STATUS_ORDER) zero[status] = 0
  return zero
}

// ── THE FRAGMENTS ──────────────────────────────────────────────────────────

const LIVE = Prisma.sql`t."deletedAt" IS NULL`
const NOT_SOLD = Prisma.sql`t."status" <> 'SOLD'`

/** `HOLDS_SEAT` in SQL: a driver not removed and not terminated holds it. */
const SOMEBODY_HOLDS = Prisma.sql`EXISTS (
  SELECT 1 FROM "Driver" d
   WHERE d."assignedTruckId" = t."id"
     AND d."deletedAt" IS NULL
     AND d."status" <> 'INACTIVE'
)`

const VIEW_SQL: Record<Exclude<TruckViewName, 'all'>, Prisma.Sql> = {
  active: Prisma.sql`(${LIVE} AND ${NOT_SOLD})`,
  unassigned: Prisma.sql`(${LIVE} AND ${NOT_SOLD} AND NOT ${SOMEBODY_HOLDS})`,
  inactive: Prisma.sql`(t."deletedAt" IS NOT NULL OR t."status" = 'SOLD')`,
}

/** `truckHealthWhere` in SQL, check by check — the Prisma form's own tests. */
const HEALTH_SQL: Record<TruckHealthCheck, Prisma.Sql> = {
  vin: Prisma.sql`(t."vin" IS NULL OR t."vin" = '')`,
  plate: Prisma.sql`(t."plate" IS NULL OR t."plate" = '')`,
  odometer: Prisma.sql`t."currentOdometer" IS NULL`,
  registration: Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "ComplianceItem" ci
     WHERE ci."truckId" = t."id" AND ci."deletedAt" IS NULL AND ci."type" = 'REGISTRATION')`,
  inspection: Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "ComplianceItem" ci
     WHERE ci."truckId" = t."id" AND ci."deletedAt" IS NULL AND ci."type" = 'ANNUAL_INSPECTION')`,
}

/** The `where` of `truckListWhere().base`, in SQL. */
function baseSql(
  params: TruckListParams,
  companyScopes: readonly string[],
): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`true`]
  if (companyScopes.length > 0) {
    parts.push(Prisma.sql`t."companyId" = ANY(${[...companyScopes]}::text[])`)
  }
  if (params.company) parts.push(Prisma.sql`t."companyId" = ${params.company}`)
  if (params.q !== '') {
    const term = `%${params.q}%`
    parts.push(
      Prisma.sql`(t."unitNumber" ILIKE ${term} OR t."plate" ILIKE ${term} OR t."vin" ILIKE ${term})`,
    )
  }
  if (params.fleet) parts.push(Prisma.sql`t."fleetStatus" = ${params.fleet}`)
  if (params.make) parts.push(Prisma.sql`t."make" = ${params.make}`)
  if (params.yearFrom !== undefined) {
    parts.push(Prisma.sql`t."year" >= ${params.yearFrom}`)
  }
  if (params.yearTo !== undefined) {
    parts.push(Prisma.sql`t."year" <= ${params.yearTo}`)
  }
  if (params.tag) parts.push(Prisma.sql`${params.tag} = ANY(t."tags")`)
  if (params.missing) {
    parts.push(LIVE, HEALTH_SQL[params.missing])
  }
  return Prisma.join(parts, ' AND ')
}

/** The groups, from the database. One statement. */
export async function truckCountGroups(
  tx: TxClient,
  params: TruckListParams,
  companyScopes: readonly string[],
): Promise<TruckCountGroup[]> {
  const statusOk = params.status
    ? Prisma.sql`t."status"::text = ${params.status}`
    : Prisma.sql`true`
  const rows = await tx.$queryRaw<
    {
      status: string
      removed: boolean
      active: boolean
      unassigned: boolean
      inactive: boolean
      status_ok: boolean
      n: number
    }[]
  >`
    SELECT
      t."status"::text AS status,
      (t."deletedAt" IS NOT NULL) AS removed,
      ${VIEW_SQL.active} AS active,
      ${VIEW_SQL.unassigned} AS unassigned,
      ${VIEW_SQL.inactive} AS inactive,
      (${statusOk}) AS status_ok,
      COUNT(*)::int AS n
    FROM "Truck" t
    WHERE ${baseSql(params, companyScopes)}
    GROUP BY 1, 2, 3, 4, 5, 6
  `
  return rows.map((row) => ({
    status: row.status,
    removed: row.removed,
    active: row.active,
    unassigned: row.unassigned,
    inactive: row.inactive,
    statusOk: row.status_ok,
    n: row.n,
  }))
}

/** Every chip for the list, in one statement. */
export async function truckListCounts(
  tx: TxClient,
  params: TruckListParams,
  companyScopes: readonly string[],
): Promise<TruckChipCounts> {
  return truckChipCounts(
    await truckCountGroups(tx, params, companyScopes),
    params.view,
  )
}
