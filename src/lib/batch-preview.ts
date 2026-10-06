import type { Prisma } from '@/generated/prisma/client'
import { SETTLEABLE_LOAD } from './settlements'
import { payFor, ruleInForce, type PayFailure } from './driver-pay'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// WHAT WOULD AND WOULD NOT GO INTO A BATCH, BEFORE ONE IS OPENED.
//
// Owner's ruling, 2026-09-29: authority and a date range, an available grid,
// and everything else grouped BY REASON.
//
// ── WHY THE UNAVAILABLE LIST IS THE POINT ─────────────────────────────────
//
// `openBatch` already refuses nothing — it opens, drafts, and whatever the
// engine could not price is simply absent. The Tuesday strip then names the
// blocked drivers, after the fact. So the question "what am I about to leave
// out" had no screen, and the answer arrived as an absence somebody had to
// notice.
//
// EVERY LOAD IN THE WINDOW LANDS IN EXACTLY ONE BUCKET. Not a filter chain
// where a load can quietly match two rules and be counted once — the order
// below is the precedence and it is stated, so a load with no driver AND no POD
// is reported under one reason rather than disappearing between two passes.
//
// ── IT CLASSIFIES IN THE WORKER, DELIBERATELY ─────────────────────────────
//
// One read of the window, then a per-row decision. This is not the aggregation
// `by-company.ts` pushes into SQL: there is no SUM here, the row count is a
// week's freight rather than a corpus, and each reason needs a different join
// to express as a predicate — five queries returning five disjoint sets that
// have to add up to the whole, which is five chances for a load to fall through
// the gap between them.
// ---------------------------------------------------------------------------

export const UNAVAILABLE_REASONS = [
  'inTransit',
  'outsideRange',
  'alreadyInBatch',
  'noDriver',
  'noRule',
] as const

export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

export interface PreviewTrip {
  loadId: string
  loadNumber: string
  companyId: string
  companyName: string
  driverName: string | null
  /**
   * WHO IS PAID, which is not always the driver's own name (§6.2.10).
   * `Driver.payToName` is the name on the statement when one is set — a leasing
   * company, a spouse, an owner-operator's LLC — and the driver's name otherwise.
   * The trip picker shows the payee because that is the row the office is
   * deciding about.
   */
  payeeName: string | null
  /**
   * Company driver or owner-operator, from `Driver.employmentType`.
   *
   * THE SCREEN SHOWS IT BECAUSE THE PAY RULE USUALLY FOLLOWS IT, and a batch
   * with one owner-operator in the wrong week is the kind of mistake that is
   * obvious on the row and invisible in the total.
   */
  driverType: string | null
  /** The broker's own reference for the trip. Datatruck's "Load ref". */
  referenceNumber: string | null
  /** DELIVERED or POD_RECEIVED — the operational axis, as the office reads it. */
  status: string
  /** When the POD landed, which is the date a week is decided by. */
  podAt: Date | null
  deliveredAt: Date | null
  pickupAt: Date | null
  /** `Chicago, IL → Dallas, TX`. One cell, because it is read as one fact. */
  locations: string | null
  /**
   * THE LOAD'S REVENUE — what the percentage is taken OF, not the driver's cut.
   *
   * NAMED `grossCents` ON PURPOSE and not "load pay": `Settlement.grossCents`
   * is the same quantity, and the agreement test for this screen is that the
   * ticked trips sum to the BATCH's gross. A column called pay that held revenue
   * is the error this project has already made once, in `topDriversByGross`.
   */
  grossCents: number
  /**
   * THE DRIVER'S CUT FOR THIS TRIP, under the rule in force — the office's own
   * "load pay" (owner's ruling, 2026-10-05).
   *
   * COMPUTED BY `payFor`, THE FUNCTION THAT WILL SETTLE IT. Not a percentage
   * applied here: a second implementation of pay would agree with the engine
   * until the day it did not, and the day it did not would be a Friday.
   *
   * NULL MEANS THE PAY CANNOT BE COMPUTED YET — a CUSTOM rule, or a percentage
   * rule with no percentage on it. Those rows say so in words and cannot be
   * ticked (§6.2.10): a trip whose pay nobody can state must not go into a batch
   * on the strength of a blank cell.
   */
  loadPayCents: number | null
  /**
   * Why `loadPayCents` is null, for the words on the row.
   *
   * `PayFailure` ITSELF, not a hand-written copy of it. The first version listed
   * three of the four and the compiler named the fourth — `no_miles`, a per-mile
   * rule on a load nobody put miles on. A row saying "no rule" about that would
   * send somebody to the wrong screen.
   */
  payProblem: PayFailure | null
  /** Null on an available trip; the bucket otherwise. */
  reason: UnavailableReason | null
}

export interface BatchPreview {
  available: PreviewTrip[]
  unavailable: Record<UnavailableReason, PreviewTrip[]>
  /** Every load looked at, so a reader can check the buckets add up. */
  considered: number
}

/**
 * Classify a window's freight.
 *
 * `from`/`to` BOUND THE POD, not the delivery stop. A week is decided by when
 * the POD landed (MONEY-DESIGN §0), and a load delivered on Saturday whose POD
 * arrives Monday belongs to the following week — which is precisely the case
 * `outsideRange` exists to show rather than silently drop.
 */
export async function previewBatch(
  tx: TxClient,
  input: {
    from: Date
    to: Date
    /** Narrows the grid only. The batch itself is org-wide — see the page. */
    companyId: string | null
  },
): Promise<BatchPreview> {
  // A WINDOW WIDER THAN THE RANGE, so `outsideRange` has something to report.
  // Asking only for the range would make that bucket permanently empty and the
  // screen would claim there is nothing just outside it.
  const margin = 14 * 86_400_000
  const loads = await tx.load.findMany({
    where: {
      // `SETTLEABLE_LOAD` IS THE SHARED BASE — deleted, cancelled and closed
      // history, in one place. Restating those three here would be a fourth
      // copy of what freight is even a candidate.
      ...SETTLEABLE_LOAD,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      stops: {
        some: {
          type: 'DELIVERY',
          scheduledAt: {
            gte: new Date(input.from.getTime() - margin),
            lte: new Date(input.to.getTime() + margin),
          },
        },
      },
    },
    orderBy: { loadNumber: 'asc' },
    take: 2000,
    select: {
      id: true,
      loadNumber: true,
      referenceNumber: true,
      operationalStatus: true,
      companyId: true,
      driverId: true,
      // THE WHOLE MONEY SHAPE `payFor` TAKES. Six scalars rather than the one
      // this query used to read, because a percentage rule works off the
      // linehaul and a per-mile rule off the miles — deciding here which of them
      // "really" matters would be this file knowing how pay rules work, which is
      // the same argument the comment on `payRules` below already makes.
      linehaulCents: true,
      fuelSurchargeCents: true,
      accessorialsCents: true,
      totalRevenueCents: true,
      actualMiles: true,
      dispatchedMiles: true,
      company: { select: { name: true } },
      driver: {
        select: {
          firstName: true,
          lastName: true,
          // THE PAYEE AND THE EMPLOYMENT, for the trip picker's columns
          // (§6.2.10). Two scalars on a relation this query already reads.
          payToName: true,
          employmentType: true,
          // THE WHOLE RULE, because `ruleInForce` takes a `PayRule` and
          // deciding here which of its fields it "really" needs would be this
          // file knowing how pay rules work.
          payRules: true,
        },
      },
      // ── BOTH ENDS NOW, NOT ONLY THE DELIVERY ──────────────────────────
      //
      // The picker shows pickup, delivery and the pair of places, so the filter
      // on `type` is gone and the derivation below picks the ends out. Two or
      // three rows per load against a `take: 2000` cap, on a screen that is read
      // once a week.
      stops: {
        orderBy: { sequence: 'asc' },
        select: {
          type: true,
          scheduledAt: true,
          city: true,
          state: true,
          name: true,
        },
      },
      statusEvents: {
        where: {
          axis: 'OPERATIONAL',
          toStatus: 'POD_RECEIVED',
          outcome: 'APPLIED',
        },
        orderBy: { occurredAt: 'asc' },
        take: 1,
        select: { occurredAt: true },
      },
      settlementLoadLines: { select: { id: true }, take: 1 },
    },
  })

  const unavailable: Record<UnavailableReason, PreviewTrip[]> = {
    inTransit: [],
    outsideRange: [],
    alreadyInBatch: [],
    noDriver: [],
    noRule: [],
  }
  const available: PreviewTrip[] = []

  // `Chicago, IL`, or the facility name when a Relay import left no city — the
  // same fallback the loads list uses, for the same reason.
  const place = (stop: {
    city: string | null
    state: string | null
    name: string | null
  }) => {
    const city = [stop.city, stop.state].filter(Boolean).join(', ')
    return city === '' ? (stop.name ?? null) : city
  }

  for (const load of loads) {
    const podAt = load.statusEvents[0]?.occurredAt ?? null
    const pickup = load.stops.find((stop) => stop.type === 'PICKUP') ?? null
    const deliveries = load.stops.filter((stop) => stop.type === 'DELIVERY')
    const delivery = deliveries[deliveries.length - 1] ?? null
    const ends = [pickup, delivery]
      .map((stop) => (stop ? place(stop) : null))
      .filter((text): text is string => text !== null)

    const trip: PreviewTrip = {
      loadId: load.id,
      loadNumber: load.loadNumber,
      companyId: load.companyId,
      companyName: load.company.name,
      driverName: load.driver
        ? `${load.driver.firstName} ${load.driver.lastName}`
        : null,
      // THE PAYEE FALLS BACK TO THE DRIVER'S OWN NAME, because `payToName` is
      // optional precisely so that it is not a second copy of a name already
      // on the row (see the schema's comment on it).
      payeeName:
        load.driver?.payToName?.trim() ||
        (load.driver
          ? `${load.driver.firstName} ${load.driver.lastName}`
          : null),
      driverType: load.driver?.employmentType ?? null,
      referenceNumber: load.referenceNumber,
      status: load.operationalStatus,
      podAt,
      deliveredAt: delivery?.scheduledAt ?? null,
      pickupAt: pickup?.scheduledAt ?? null,
      locations: ends.length === 0 ? null : ends.join(' → '),
      grossCents: load.totalRevenueCents,
      // ── THE DRIVER'S CUT, FROM THE ENGINE ──────────────────────────────
      //
      // `input.to` is the date the rule is looked up on, which is the same date
      // the `noRule` bucket below uses — one reading of "which rule applies", so
      // the grid cannot offer a trip whose rule it then disagrees about.
      ...(() => {
        const rule = ruleInForce(load.driver?.payRules ?? [], input.to)
        if (rule === null) {
          return { loadPayCents: null, payProblem: 'no_rule' as const }
        }
        const pay = payFor(
          {
            id: load.id,
            loadNumber: load.loadNumber,
            linehaulCents: load.linehaulCents,
            fuelSurchargeCents: load.fuelSurchargeCents,
            accessorialsCents: load.accessorialsCents,
            totalRevenueCents: load.totalRevenueCents,
            actualMiles: load.actualMiles,
            dispatchedMiles: load.dispatchedMiles,
          },
          rule,
        )
        return pay.ok
          ? { loadPayCents: pay.amountCents, payProblem: null }
          : { loadPayCents: null, payProblem: pay.reason }
      })(),
      reason: null,
    }

    // ── THE PRECEDENCE, STATED ────────────────────────────────────────
    //
    // Most-settled first: a load already on a statement is reported as such
    // whatever else is true of it, because "it is done" is the answer that
    // stops somebody looking. Then the two facts about the freight itself,
    // then the two about who would be paid — a load with no POD and no driver
    // is in transit first, because that is the earlier problem.
    const reason: UnavailableReason | null =
      load.settlementLoadLines.length > 0
        ? 'alreadyInBatch'
        : podAt === null
          ? 'inTransit'
          : podAt < input.from || podAt > input.to
            ? 'outsideRange'
            : load.driverId === null
              ? 'noDriver'
              : ruleInForce(load.driver?.payRules ?? [], input.to) === null
                ? 'noRule'
                : null

    if (reason === null) available.push(trip)
    else unavailable[reason].push({ ...trip, reason })
  }

  return { available, unavailable, considered: loads.length }
}
