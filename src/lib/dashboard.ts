import type { CompanyScopeFilter, TxClient } from './tenancy'
import { readyToInvoiceWhere } from './invoices'
import type { AuthorizedSession, Resource } from './permissions'
import { can } from './permissions'

// ---------------------------------------------------------------------------
// THE DASHBOARD (Step B).
//
// Three questions, in the order somebody opening the application at 6am asks
// them:
//
//   1. WHAT NEEDS ME?          the action queue
//   2. WHAT HAVE I GOT?        the fleet, in plain numbers
//   3. HOW IS THE WEEK GOING?  revenue per authority — money roles only
//
// EVERY ROW IS COUNTED FROM REAL STATE. There is no dashboard table, no
// nightly rollup and no cached figure: each queue row is a `count` over the
// same predicate the screen it links to uses. A dashboard whose numbers are
// computed a second way is a dashboard that eventually disagrees with the
// screen it sends you to, and the person stops believing both.
//
// ROLE FILTERING IS A PERMISSION QUESTION, answered by permissions.ts and not
// by this file. Each row names the resource it needs; `actionQueue` drops the
// ones the session cannot read, and — this is the part that matters — it never
// RUNS their queries. A dispatcher's dashboard does not count unpaid invoices
// and then hide the number; it does not ask.
//
// §14 forbids the gradient hero card, the animated chart and "No data
// available". What is left is a list of things to do and some counts, which is
// what the screen is for.
// ---------------------------------------------------------------------------

/** A row in the action queue: what needs doing, how many, and where. */
export interface ActionRow {
  key: string
  /** Counted, never estimated. Zero rows are dropped before render. */
  count: number
  href: string
  /** Danger for money going stale, warning for work waiting, else neutral. */
  tone: 'danger' | 'warning' | 'neutral'
}

interface ActionSpec {
  key: string
  resource: Resource
  href: string
  tone: ActionRow['tone']
  count: (tx: TxClient, scope: CompanyScopeFilter) => Promise<number>
}

/**
 * Everything the queue can show, with the permission each row needs.
 *
 * Ordered by how much a delay costs: money that is ageing first, then work
 * that is merely waiting.
 */
const ACTIONS: ActionSpec[] = [
  {
    // Delivered, no POD. The load cannot be billed and the clock is running.
    key: 'podMissing',
    resource: 'load',
    href: '/loads?status=DELIVERED',
    tone: 'danger',
    count: (tx, scope) =>
      tx.load.count({
        where: {
          ...scope,
          deletedAt: null,
          isCancelled: false,
          operationalStatus: 'DELIVERED',
        },
      }),
  },
  {
    // POD in, no rate. Nobody can invoice it and nobody is looking at it.
    key: 'noRate',
    resource: 'load.financials',
    href: '/loads?status=POD_RECEIVED',
    tone: 'danger',
    count: (tx, scope) =>
      tx.load.count({
        where: {
          ...scope,
          deletedAt: null,
          isCancelled: false,
          operationalStatus: 'POD_RECEIVED',
          totalRevenueCents: { lte: 0 },
        },
      }),
  },
  {
    // The SAME predicate the invoice screen's ready queue uses, from the same
    // function — so the dashboard cannot promise work the queue does not have.
    key: 'readyToInvoice',
    resource: 'invoice',
    href: '/invoices',
    tone: 'warning',
    count: (tx, scope) =>
      tx.load.count({ where: { ...readyToInvoiceWhere(), ...scope } }),
  },
  {
    key: 'overdue',
    resource: 'receivable',
    href: '/receivables',
    tone: 'danger',
    count: (tx, scope) =>
      // Past its due date with a balance. The aging screen buckets these; the
      // dashboard only says how many are past due at all.
      tx.invoice.count({
        where: {
          ...scope,
          deletedAt: null,
          isFactored: false,
          balanceCents: { gt: 0 },
          status: { notIn: ['DRAFT', 'VOID', 'WRITTEN_OFF'] },
          dueDate: { lt: new Date() },
        },
      }),
  },
  {
    key: 'unapplied',
    resource: 'payment',
    href: '/payments',
    tone: 'warning',
    count: (tx, scope) =>
      tx.payment.count({
        where: { ...scope, deletedAt: null, unappliedCents: { gt: 0 } },
      }),
  },
  {
    key: 'draftSettlements',
    resource: 'settlement',
    href: '/settlements',
    tone: 'warning',
    count: (tx, scope) =>
      tx.settlement.count({
        where: { ...scope, deletedAt: null, status: 'DRAFT' },
      }),
  },
  {
    // Freight nobody is driving. Neutral because it is normal for a few hours
    // and only interesting if it stays.
    key: 'unassigned',
    resource: 'dispatch',
    href: '/dispatch',
    tone: 'neutral',
    count: (tx, scope) =>
      tx.load.count({
        where: {
          ...scope,
          deletedAt: null,
          isCancelled: false,
          operationalStatus: { in: ['AVAILABLE', 'BOOKED'] },
          OR: [{ driverId: null }, { truckId: null }],
        },
      }),
  },
]

/**
 * The action queue for one session.
 *
 * Rows the session cannot read are never counted — not counted and hidden.
 * Rows that count zero are dropped, because a queue of noughts is a queue
 * nobody reads.
 */
export async function actionQueue(
  tx: TxClient,
  session: AuthorizedSession,
  scope: CompanyScopeFilter = {},
): Promise<ActionRow[]> {
  const permitted = ACTIONS.filter((action) =>
    can(session, 'read', action.resource),
  )

  const counted = await Promise.all(
    permitted.map(async (action) => ({
      key: action.key,
      href: action.href,
      tone: action.tone,
      count: await action.count(tx, scope),
    })),
  )

  return counted.filter((row) => row.count > 0)
}

/** Which rows a session would be offered, before any counting. For tests. */
export function actionKeysFor(session: AuthorizedSession): string[] {
  return ACTIONS.filter((action) => can(session, 'read', action.resource)).map(
    (action) => action.key,
  )
}

// --- the fleet, in plain numbers ---------------------------------------------

export interface FleetGlance {
  trucks: number
  trailers: number
  drivers: number
  /** Loads moving right now: dispatched through at-delivery. */
  inTransit: number
}

/**
 * Counts, not percentages and not a chart.
 *
 * §14 bans the animated chart; four integers answer "what have I got" faster
 * than anything that needs a legend.
 */
export async function fleetGlance(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
): Promise<FleetGlance> {
  // ONE FILTER, SPREAD EVERYWHERE. Truck, Trailer, Driver, Load, Invoice,
  // Payment and Settlement all key the authority as `companyId`, so
  // `companyScopeFilter`'s shape drops into each of them unchanged. Company
  // itself is the exception and needs `companyIdScopeFilter` — see tenancy.ts
  // and the seven screens that got it wrong in Phase 2.
  const [trucks, trailers, drivers, inTransit] = await Promise.all([
    tx.truck.count({
      where: { ...scope, deletedAt: null, status: { not: 'SOLD' } },
    }),
    tx.trailer.count({
      where: { ...scope, deletedAt: null, status: { not: 'SOLD' } },
    }),
    tx.driver.count({
      where: { ...scope, deletedAt: null, status: { not: 'INACTIVE' } },
    }),
    tx.load.count({
      where: {
        ...scope,
        deletedAt: null,
        isCancelled: false,
        operationalStatus: {
          in: [
            'DISPATCHED',
            'AT_PICKUP',
            'LOADED',
            'IN_TRANSIT',
            'AT_DELIVERY',
          ],
        },
      },
    }),
  ])

  return { trucks, trailers, drivers, inTransit }
}

// --- this week, per authority -------------------------------------------------

export interface WeekRow {
  companyId: string
  companyName: string
  loads: number
  revenueCents: number
}

/**
 * The Monday-to-now week, per operating authority.
 *
 * PER AUTHORITY and never summed into one figure: RAM and Dolphins are
 * separate businesses with separate books, and a combined number is one no
 * accountant can act on. The screen shows a total row only because the owner
 * of both asked for it, and it is labelled as the group.
 *
 * Counted from loads that were DELIVERED in the week — revenue is earned when
 * the freight moves, not when it is booked and not when it is paid.
 */
export function weekStart(now: Date): Date {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  // getUTCDay: 0 is Sunday, so Monday is 1. A Sunday belongs to the week that
  // began six days earlier, not to the one starting tomorrow.
  const back = start.getUTCDay() === 0 ? 6 : start.getUTCDay() - 1
  start.setUTCDate(start.getUTCDate() - back)
  return start
}

export async function thisWeek(
  tx: TxClient,
  companyIds: readonly string[],
  now: Date = new Date(),
): Promise<WeekRow[]> {
  const since = weekStart(now)

  const companies = await tx.company.findMany({
    where: companyIds.length > 0 ? { id: { in: [...companyIds] } } : {},
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
  if (companies.length === 0) return []

  // One grouped query rather than one per authority: the dashboard is the
  // first screen of the day and it must not cost a round trip per company.
  const grouped = await tx.load.groupBy({
    by: ['companyId'],
    where: {
      companyId: { in: companies.map((company) => company.id) },
      deletedAt: null,
      isCancelled: false,
      statusEvents: {
        some: {
          axis: 'OPERATIONAL',
          toStatus: 'DELIVERED',
          outcome: 'APPLIED',
          occurredAt: { gte: since },
        },
      },
    },
    _count: { _all: true },
    _sum: { totalRevenueCents: true },
  })

  const byCompany = new Map(grouped.map((row) => [row.companyId, row]))

  // Every authority appears, including the ones that hauled nothing — a
  // missing row reads as a bug, where a zero reads as a quiet week.
  return companies.map((company) => ({
    companyId: company.id,
    companyName: company.name,
    loads: byCompany.get(company.id)?._count._all ?? 0,
    revenueCents: byCompany.get(company.id)?._sum.totalRevenueCents ?? 0,
  }))
}
