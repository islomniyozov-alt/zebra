import { Prisma } from '@/generated/prisma/client'
import { READY, type LoadListParams } from './load-list'
import {
  addDays,
  rangeOf,
  UNPAID_BILLING,
  type LoadViewName,
  type ViewContext,
} from './load-views'
import { weekOf } from './settlement-week'
import { statesInZone, ZONE_CHOICES } from './stop-time'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// EVERY NUMBER ON THE LOADS LIST'S BAR, IN ONE STATEMENT
// (TMS-DESIGN-SYSTEM.md §6.7, owner's ruling of 2026-10-09).
//
// The bar used to cost six statements per render: the footer's count, a status
// `groupBy`, a billing `groupBy`, and three counts for Ready, Upcoming and
// Unpaid. Upcoming alone was 394 ms on dev. This reads the list's base set
// ONCE, tags each load with its status, its billing state and four flags, and
// groups by them. `chipCounts` then derives every chip and the footer total
// from the groups, by the rule the bar has always used: a chip honours every
// OTHER filter and ignores its own group.
//
// ── THE SQL IS A SECOND EXPRESSION AND THE TEST IS THE MITIGATION ──────────
//
// The list's rows come from the Prisma predicates in `load-views.ts` and
// `load-list.ts`, and those stay the definition. This file restates them in
// SQL, as `dashboard-counts.ts` does for the Needs-you rows, and
// `tests/integration/load-list.test.ts` runs both over the same rows and
// requires the same number ONE CASE PER CHIP AND PER VIEW, named, so a drift
// fails by the chip's own name.
//
// ── A STOP'S DAY IS COMPUTED HERE, NOT BOUNDED ─────────────────────────────
//
// The Prisma form bounds each stop by `zoneMidnight` in one arm per zone,
// because a `where` cannot compute. SQL can: the local date is the stop's time
// read at its zone — a CASE over the state, else the authority's zone — and the
// CASE is generated from `stop-time.ts`'s own map, so both forms share one
// table. The FIRST pickup is the MIN of those days and the FINAL delivery the
// MAX, which is exactly "one in range and none before (or after) it".
// ---------------------------------------------------------------------------

/** One group of the statement: loads sharing a status, a billing and flags. */
export interface CountGroup {
  op: string
  bs: string
  inView: boolean
  ready: boolean
  upcoming: boolean
  unpaid: boolean
  n: number
}

export interface ChipCounts {
  /** By operational status, under every filter except status. */
  status: Record<string, number>
  /** By billing status plus `READY`, under every filter except billing. */
  billing: Record<string, number>
  upcoming: number
  unpaid: number
  /** The footer's total: every filter, the view included. */
  matching: number
}

/**
 * Every chip and the footer total, from the groups.
 *
 * THE SAME RULE AS THE PRISMA COUNTS IN `load-list.ts`: status counts honour
 * billing and the view; billing counts honour status and the view; a view
 * chip honours status and billing and REPLACES the active view; the footer
 * honours everything.
 */
export function chipCounts(
  groups: readonly CountGroup[],
  params: Pick<LoadListParams, 'status' | 'billing'>,
): ChipCounts {
  const statusOk = (g: CountGroup) => !params.status || g.op === params.status
  const billingOk = (g: CountGroup) =>
    !params.billing ||
    (params.billing === READY ? g.ready : g.bs === params.billing)
  const counts: ChipCounts = {
    status: {},
    billing: {},
    upcoming: 0,
    unpaid: 0,
    matching: 0,
  }
  for (const g of groups) {
    if (billingOk(g) && g.inView) {
      counts.status[g.op] = (counts.status[g.op] ?? 0) + g.n
    }
    if (statusOk(g) && g.inView) {
      // THE READY CHIP IS THE PREDICATE, NEVER THE COLUMN. `READY` is the same
      // string as the column value `READY_TO_INVOICE`, which direct-settled
      // freight also carries; counting both under one key showed 1,603 on dev
      // against the predicate's 849. The column value is left out here, as the
      // old page's override left it out.
      if (g.bs !== READY) {
        counts.billing[g.bs] = (counts.billing[g.bs] ?? 0) + g.n
      }
      if (g.ready) counts.billing[READY] = (counts.billing[READY] ?? 0) + g.n
    }
    if (statusOk(g) && billingOk(g)) {
      if (g.upcoming) counts.upcoming += g.n
      if (g.unpaid) counts.unpaid += g.n
      if (g.inView) counts.matching += g.n
    }
  }
  return counts
}

// ── THE FRAGMENTS ──────────────────────────────────────────────────────────

const NOT_CLOSED = Prisma.sql`l."billingStatus" <> 'CLOSED_IN_DATATRUCK'`
const NOT_CANCELLED = Prisma.sql`l."isCancelled" = false`
const QUEUE = Prisma.sql`${NOT_CLOSED} AND ${NOT_CANCELLED}`
const NO_SEAT = Prisma.sql`(l."driverId" IS NULL OR l."truckId" IS NULL)`

/**
 * The zone a stop is dated in: its state's, else its authority's. Generated
 * from `stop-time.ts`, so the CASE and `zoneForState` cannot disagree.
 */
const STOP_ZONE = Prisma.sql`CASE ${Prisma.join(
  ZONE_CHOICES.map(
    (zone) =>
      Prisma.sql`WHEN s."state" = ANY(${statesInZone(zone)}::text[]) THEN ${zone}`,
  ),
  ' ',
)} ELSE c."timezone" END`

/** The day of the first pickup (MIN) or final delivery (MAX), or NULL. */
function stopDay(type: 'PICKUP' | 'DELIVERY'): Prisma.Sql {
  const pick = type === 'PICKUP' ? Prisma.raw('MIN') : Prisma.raw('MAX')
  return Prisma.sql`(
    SELECT ${pick}(
      ((COALESCE(s."scheduledAt", s."windowStart") AT TIME ZONE 'UTC')
        AT TIME ZONE ${STOP_ZONE})::date
    )
    FROM "LoadStop" s
    WHERE s."loadId" = l."id" AND s."type" = ${Prisma.raw(`'${type}'`)}
  )`
}

const between = (day: Prisma.Sql, from: string, to: string) =>
  Prisma.sql`COALESCE(${day} BETWEEN ${from}::date AND ${to}::date, false)`

const READY_SQL = Prisma.sql`(
  ${QUEUE}
  AND l."operationalStatus" = 'POD_RECEIVED'
  AND l."totalRevenueCents" > 0
  AND l."directSettled" = false
  AND NOT EXISTS (SELECT 1 FROM "InvoiceLine" il WHERE il."loadId" = l."id")
)`

/**
 * Every named view, in SQL. TYPED AGAINST `LoadViewName`, so a view added to
 * `load-views.ts` without its SQL here is a type error rather than a chip that
 * counts the wrong thing.
 */
const VIEW_SQL: Record<LoadViewName, (ctx: ViewContext) => Prisma.Sql> = {
  podMissing: () =>
    Prisma.sql`(${QUEUE} AND l."operationalStatus" = 'DELIVERED')`,
  noRate: () =>
    Prisma.sql`(${QUEUE} AND l."operationalStatus" = 'POD_RECEIVED' AND l."totalRevenueCents" <= 0)`,
  unassignedFinished: () =>
    Prisma.sql`(${QUEUE} AND l."operationalStatus" = 'POD_RECEIVED' AND l."totalRevenueCents" > 0 AND ${NO_SEAT})`,
  unassigned: () =>
    Prisma.sql`(${QUEUE} AND l."operationalStatus" IN ('AVAILABLE', 'BOOKED') AND ${NO_SEAT})`,
  readyToInvoice: () => READY_SQL,
  picksUpToday: (ctx) =>
    Prisma.sql`(${QUEUE} AND ${between(stopDay('PICKUP'), ctx.today, ctx.today)})`,
  deliversThisWeek: (ctx) => {
    const week = weekOf(new Date(`${ctx.today}T00:00:00Z`))
    return Prisma.sql`(${QUEUE} AND ${between(
      stopDay('DELIVERY'),
      week.start.toISOString().slice(0, 10),
      week.end.toISOString().slice(0, 10),
    )})`
  },
  pickup: (ctx) => {
    const range = rangeOf(ctx)
    return range === null
      ? Prisma.sql`true`
      : between(stopDay('PICKUP'), range.from, range.to)
  },
  delivery: (ctx) => {
    const range = rangeOf(ctx)
    return range === null
      ? Prisma.sql`true`
      : between(stopDay('DELIVERY'), range.from, range.to)
  },
  // THE SUBQUERY ONLY FOR BOOKED LOADS: the CASE keeps Postgres from dating the
  // stops of fourteen thousand loads to answer a question about sixty.
  upcoming: (ctx) => Prisma.sql`(
    ${QUEUE} AND l."operationalStatus" = 'BOOKED'
    AND CASE WHEN l."operationalStatus" = 'BOOKED'
      THEN ${between(stopDay('PICKUP'), ctx.today, addDays(ctx.today, 7))}
      ELSE false END
  )`,
  unpaid: () => Prisma.sql`(
    ${NOT_CANCELLED}
    AND l."operationalStatus" IN ('DELIVERED', 'POD_RECEIVED')
    AND l."billingStatus"::text = ANY(${[...UNPAID_BILLING]}::text[])
  )`,
}

function isViewName(value: string | undefined): value is LoadViewName {
  return value !== undefined && Object.hasOwn(VIEW_SQL, value)
}

/** The active view in SQL; an unknown or absent name narrows nothing. */
function viewSql(params: LoadListParams, ctx: ViewContext): Prisma.Sql {
  if (!isViewName(params.view)) return Prisma.sql`true`
  return VIEW_SQL[params.view]({ ...ctx, from: params.from, to: params.to })
}

/**
 * The list's base filters in SQL: scope, authority, the reference search, the
 * broker, and the driver in either seat. The `where` of `loadListWhere().base`.
 */
function baseSql(
  params: LoadListParams,
  companyScopes: readonly string[],
): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`l."deletedAt" IS NULL`]
  if (companyScopes.length > 0) {
    parts.push(Prisma.sql`l."companyId" = ANY(${[...companyScopes]}::text[])`)
  }
  if (params.company) parts.push(Prisma.sql`l."companyId" = ${params.company}`)
  if (params.ref.trim() !== '') {
    const term = `%${params.ref.trim()}%`
    parts.push(
      Prisma.sql`(l."referenceNumber" ILIKE ${term} OR l."loadNumber" ILIKE ${term})`,
    )
  }
  if (params.customer) {
    parts.push(Prisma.sql`l."customerId" = ${params.customer}`)
  }
  if (params.driver) {
    parts.push(
      Prisma.sql`(l."driverId" = ${params.driver} OR l."coDriverId" = ${params.driver})`,
    )
  }
  return Prisma.join(parts, ' AND ')
}

/** The groups, from the database. One statement. */
export async function loadCountGroups(
  tx: TxClient,
  params: LoadListParams,
  companyScopes: readonly string[],
  ctx: ViewContext,
): Promise<CountGroup[]> {
  const rows = await tx.$queryRaw<
    {
      op: string
      bs: string
      in_view: boolean
      ready: boolean
      upcoming: boolean
      unpaid: boolean
      n: number
    }[]
  >`
    SELECT
      l."operationalStatus"::text AS op,
      l."billingStatus"::text AS bs,
      COALESCE(${viewSql(params, ctx)}, false) AS in_view,
      COALESCE(${READY_SQL}, false) AS ready,
      COALESCE(${VIEW_SQL.upcoming(ctx)}, false) AS upcoming,
      COALESCE(${VIEW_SQL.unpaid(ctx)}, false) AS unpaid,
      COUNT(*)::int AS n
    FROM "Load" l
    JOIN "Company" c ON c."id" = l."companyId"
    WHERE ${baseSql(params, companyScopes)}
    GROUP BY 1, 2, 3, 4, 5, 6
  `
  return rows.map((row) => ({
    op: row.op,
    bs: row.bs,
    inView: row.in_view,
    ready: row.ready,
    upcoming: row.upcoming,
    unpaid: row.unpaid,
    n: row.n,
  }))
}

/** Every chip and the footer total for the list, in one statement. */
export async function loadListCounts(
  tx: TxClient,
  params: LoadListParams,
  companyScopes: readonly string[],
  ctx: ViewContext,
): Promise<ChipCounts> {
  return chipCounts(
    await loadCountGroups(tx, params, companyScopes, ctx),
    params,
  )
}
