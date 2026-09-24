import type { Prisma } from '@/generated/prisma/client'
import type { CompanyScopeFilter, TxClient } from './tenancy'
import { readyToInvoiceWhere } from './invoices'
import { complianceCount } from './compliance'
import { NOT_CLOSED_HISTORY } from './billing-status'
import type { AuthorizedSession, Resource } from './permissions'
import { can } from './permissions'
import { PERSON_DRIVER } from './driver-kind'

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
/**
 * Finished, billable, and attached to nobody.
 *
 * THE SAME SHAPE `isReady` NOW REFUSES, asked as a question instead of an
 * answer: these are the loads whose badge dropped off Ready to invoice, and
 * the reason they must be counted somewhere is that dropping off a queue is
 * not the same as being noticed.
 */
export function unassignedFinishedWhere(): Prisma.LoadWhereInput {
  return {
    ...NOT_CLOSED_HISTORY,
    deletedAt: null,
    isCancelled: false,
    operationalStatus: 'POD_RECEIVED',
    totalRevenueCents: { gt: 0 },
    // Either half missing is the alarm. Driver is the one that stops the pay;
    // truck is the owner's ruling and the evidence that a POD arrived for a
    // movement nobody witnessed. See `isAssigned`.
    OR: [{ driverId: null }, { truckId: null }],
  }
}

export interface ActionRow {
  key: string
  /** Counted, never estimated. Zero rows are dropped before render. */
  count: number
  /**
   * What the row is WORTH, where the money is the point.
   *
   * "3 payments not yet applied" is a filing job; "$14,200 not yet applied" is
   * money the carrier cannot see in any receivable figure. Only the unapplied
   * row carries one — the others are counts of work, and inventing a value for
   * them would be a number nobody could reproduce.
   */
  amountCents?: number
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
  /** Optional second query, for rows whose point is an amount. */
  amount?: (tx: TxClient, scope: CompanyScopeFilter) => Promise<number>
}

/**
 * Everything the queue can show, with the permission each row needs.
 *
 * Ordered by how much a delay costs: money that is ageing first, then work
 * that is merely waiting.
 */
const ACTIONS: ActionSpec[] = [
  {
    // COMPLIANCE FIRST, because it is the only row where the cost of ignoring
    // it is a truck held at a scale house rather than a slow invoice. Gated on
    // `compliance`, which every operator role holds through FLEET_READ — a
    // dispatcher must see this one (§2.5), it gates a real dispatch decision.
    //
    // The horizon is the authority's own `complianceWarnDays`, read by
    // `complianceQueue` — the Phase 1 settings field that had nothing reading
    // it until now (§2.3).
    key: 'compliance',
    resource: 'compliance',
    href: '/safety',
    tone: 'danger',
    count: async (tx, scope) => (await complianceCount(tx, scope)).count,
  },
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
          ...NOT_CLOSED_HISTORY,
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
          ...NOT_CLOSED_HISTORY,
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
    // ── FINISHED FREIGHT NOBODY IS ATTACHED TO (ruled 2026-09-06) ─────────
    //
    // THE ALARM FOR AN OMISSION, WHICH IS WHY IT HAD TO BE BUILT NOW.
    // `settleableWhere(driverId, …)` filters on driverId as an equality, so a
    // load with no driver matches NO driver's query: it is never refused, it is
    // simply never found, and nobody is paid. Every other check on this
    // dashboard counts things that are THERE. This one exists because the
    // failure mode is absence, and absence is invisible to every query that
    // filters for what it wants.
    //
    // Production, 2026-09-06: loads 1015 and 1016, $2,703.58 of finished
    // freight attached to nobody, neither on any settlement. Daler had found
    // one of them by opening it; nothing would have found the other.
    //
    // IT NAMES THE MONEY, and that is not decoration. "2 loads finished with no
    // driver" is a filing job somebody scrolls past; "$2,703.58" is the driver's
    // pay, and it is the half that gets acted on. The row shape already carries
    // an amount for exactly this reason — see `amountCents`.
    key: 'unassignedFinished',
    resource: 'load',
    // The loads list, narrowed to the status they are all sitting at. It does
    // not filter on assignment — that would be a query parameter invented for
    // one dashboard row — so this lands on a short list a human can scan.
    href: '/loads?status=POD_RECEIVED',
    // DANGER, not warning. The scale on this dashboard is "danger for money
    // going stale"; a driver not being paid for finished work is exactly that,
    // and it goes stale silently rather than aging into a report.
    tone: 'danger',
    count: (tx, scope) =>
      tx.load.count({
        where: {
          ...unassignedFinishedWhere(),
          ...NOT_CLOSED_HISTORY,
          ...scope,
        },
      }),
    amount: async (tx, scope) => {
      const total = await tx.load.aggregate({
        where: {
          ...unassignedFinishedWhere(),
          ...NOT_CLOSED_HISTORY,
          ...scope,
        },
        _sum: { totalRevenueCents: true },
      })
      return total._sum.totalRevenueCents ?? 0
    },
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
    // THE MONEY IS THE POINT HERE. Summed from the same rows the count
    // counts, so the figure and the number beside it cannot disagree.
    amount: async (tx, scope) =>
      (
        await tx.payment.aggregate({
          where: { ...scope, deletedAt: null, unappliedCents: { gt: 0 } },
          _sum: { unappliedCents: true },
        })
      )._sum.unappliedCents ?? 0,
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
    permitted.map(async (action) => {
      const [count, amountCents] = await Promise.all([
        action.count(tx, scope),
        action.amount ? action.amount(tx, scope) : Promise.resolve(undefined),
      ])
      return {
        key: action.key,
        href: action.href,
        tone: action.tone,
        count,
        ...(amountCents === undefined ? {} : { amountCents }),
      }
    }),
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
  /** Trucks with a live driver paired to them, and trucks without. */
  trucksPaired: number
  trucksIdle: number
  /** Drivers paired to a truck, and drivers without one. */
  driversPaired: number
  driversIdle: number
  /** Loads moving right now: dispatched through at-delivery. */
  inTransit: number
}

/**
 * The fleet BY ASSIGNMENT STATE, which is the question actually being asked.
 *
 * "Eleven trucks" is inventory. "Nine paired, two idle" is a decision: two
 * tractors are earning nothing this morning, and somebody should know that
 * before the load board closes.
 *
 * Counts, not percentages and not a chart — §14 bans the animated chart, and
 * five integers answer "what have I got" faster than anything with a legend.
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
  const liveTruck = {
    ...scope,
    deletedAt: null,
    status: { not: 'SOLD' },
  } as const
  // A REFERRAL PAYEE IS NOT ON THE ROSTER (owner's ruling, 2026-09-24).
  // "How many drivers do we have" is a question about people — the answer is
  // read for insurance and for CSA exposure — and a commission carried as a
  // Driver row would inflate it. The ruling keeps those rows ACTIVE on purpose
  // so they keep being paid, so the roster status cannot do this filtering.
  const liveDriver = {
    ...scope,
    deletedAt: null,
    status: { not: 'INACTIVE' },
    ...PERSON_DRIVER,
  } as const
  /** A driver who still works here. Reused so both sides agree on "live". */
  const pairedDriver = {
    deletedAt: null,
    status: { not: 'INACTIVE' },
    ...PERSON_DRIVER,
  } as const

  const [trucksPaired, trucksIdle, driversPaired, driversIdle, inTransit] =
    await Promise.all([
      // A truck is paired when a live driver points at it. The pairing lives
      // on `Driver.assignedTruckId` and only there, so this is the only
      // direction the schema can answer.
      tx.truck.count({
        where: { ...liveTruck, drivers: { some: pairedDriver } },
      }),
      // NOT `NOT some` — `none` over the same filter, so a truck whose only
      // driver has been retired counts as idle rather than as spoken for.
      tx.truck.count({
        where: { ...liveTruck, drivers: { none: pairedDriver } },
      }),
      tx.driver.count({
        where: { ...liveDriver, assignedTruckId: { not: null } },
      }),
      tx.driver.count({ where: { ...liveDriver, assignedTruckId: null } }),
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

  return { trucksPaired, trucksIdle, driversPaired, driversIdle, inTransit }
}

// --- this week, per authority -------------------------------------------------

export interface WeekRow {
  companyId: string
  companyName: string
  /** Booked in the week — freight taken on, whether or not it has run. */
  booked: number
  /** Delivered in the week. Revenue counts on this one. */
  delivered: number
  revenueCents: number
  /** Of that revenue: sold to a factor, and collected by the carrier. */
  factoredCents: number
  directCents: number
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

  const ids = companies.map((company) => company.id)
  const live = { deletedAt: null, isCancelled: false } as const
  const deliveredThisWeek = {
    statusEvents: {
      some: {
        axis: 'OPERATIONAL',
        toStatus: 'DELIVERED',
        outcome: 'APPLIED',
        occurredAt: { gte: since },
      },
    },
  } as const

  // FOUR GROUPED QUERIES, not four per authority: the dashboard is the first
  // screen of the day and it must not cost a round trip per company.
  //
  // BOOKED AND DELIVERED ARE DIFFERENT WEEKS' WORK and neither is the other's
  // proxy. A quiet booking week with a heavy delivery week is a business
  // running down its backlog, and one number cannot show it.
  const [booked, delivered, factored, direct] = await Promise.all([
    tx.load.groupBy({
      by: ['companyId'],
      where: { companyId: { in: ids }, ...live, bookedAt: { gte: since } },
      _count: { _all: true },
    }),
    tx.load.groupBy({
      by: ['companyId'],
      where: { companyId: { in: ids }, ...live, ...deliveredThisWeek },
      _count: { _all: true },
      _sum: { totalRevenueCents: true },
    }),
    // FACTORED VS DIRECT, over the same delivered set, so the two sum to the
    // revenue beside them. `isFactored` on the load is the apportioned truth —
    // step 4 put it there and `findFactoringDrift` keeps it honest.
    tx.load.groupBy({
      by: ['companyId'],
      where: {
        companyId: { in: ids },
        ...live,
        ...deliveredThisWeek,
        isFactored: true,
      },
      _sum: { totalRevenueCents: true },
    }),
    tx.load.groupBy({
      by: ['companyId'],
      where: {
        companyId: { in: ids },
        ...live,
        ...deliveredThisWeek,
        isFactored: false,
      },
      _sum: { totalRevenueCents: true },
    }),
  ])

  const bookedBy = new Map(booked.map((row) => [row.companyId, row]))
  const deliveredBy = new Map(delivered.map((row) => [row.companyId, row]))
  const factoredBy = new Map(factored.map((row) => [row.companyId, row]))
  const directBy = new Map(direct.map((row) => [row.companyId, row]))

  // Every authority appears, including the ones that hauled nothing — a
  // missing row reads as a bug, where a zero reads as a quiet week.
  return companies.map((company) => ({
    companyId: company.id,
    companyName: company.name,
    booked: bookedBy.get(company.id)?._count._all ?? 0,
    delivered: deliveredBy.get(company.id)?._count._all ?? 0,
    revenueCents: deliveredBy.get(company.id)?._sum.totalRevenueCents ?? 0,
    factoredCents: factoredBy.get(company.id)?._sum.totalRevenueCents ?? 0,
    directCents: directBy.get(company.id)?._sum.totalRevenueCents ?? 0,
  }))
}
