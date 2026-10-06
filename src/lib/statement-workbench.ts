import type { Prisma } from '@/generated/prisma/client'
import { batchInputForOrg } from './settlement-batch'
import { grossFor, type HeldReason } from './settlement-week'
import { refreshTotals } from './settlements'
import {
  payFor,
  ruleInForce,
  type PayRule,
  type PaySnapshot,
} from './driver-pay'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// THE STATEMENT WORKBENCH: what can still be added to one settlement.
//
// ── WHY HELD LOADS ARE OFFERED RATHER THAN HIDDEN ─────────────────────────
//
// Owner's ruling, 2026-09-29: "held included with reason".
//
// A held load is one the engine declined to price by itself — an Amazon trip
// whose remittance has not arrived, or has arrived short. The batch leaves it
// out on purpose, and until now the only way to see it was the held list on the
// Tuesday screen, which names it and offers nothing.
//
// HIDING IT HERE WOULD MAKE THE WORKBENCH LIE BY OMISSION. The question this
// panel answers is "what freight of this driver's is not on this statement",
// and a held load is exactly that — the most interesting case of it. So it is
// listed, with the reason, and adding one is a deliberate act by somebody who
// has read the reason. What must not happen is a held load sliding in unmarked,
// which is why `held` is a field and not a filter.
// ---------------------------------------------------------------------------

export interface AddableTrip {
  loadId: string
  loadNumber: string
  companyName: string
  puPlace: string
  delPlace: string
  puDate: Date
  delDate: Date
  /** What the engine would settle this load on, where it would settle at all. */
  grossCents: number
  milesHundredths: number
  /** Null where the engine prices it cleanly. Set where a person must decide. */
  held: HeldReason | null
  /** Carried so the trip line can be written without re-reading the load. */
  loadIdForCompany: string
}

/**
 * This driver's settleable freight in the period that is not on a settlement.
 *
 * `settleableLoads` ALREADY EXCLUDES WHAT IS SETTLED — its `settleableWhere`
 * drops any load carrying a settlement load line — so this does not filter
 * again. A second exclusion here would be a second definition of "settled", and
 * the two would disagree the first time one of them changed.
 */
export async function addableTrips(
  tx: TxClient,
  input: {
    organizationId: string
    driverId: string
    periodStart: Date
    periodEnd: Date
  },
): Promise<AddableTrip[]> {
  // ── THE BATCH'S OWN READER, NARROWED TO ONE DRIVER ─────────────────────
  //
  // `settleableLoads` in `settlements.ts` returns a DIFFERENT `SettleableLoad`
  // — the raw load, without the places, dates and confirmed gross that
  // `grossFor` needs to decide whether a load settles. Building that shape here
  // would be a third definition of "a load the engine can price", and the one
  // that mattered would be whichever this panel happened to use.
  //
  // ── AND IT DOES NOT OPT OUT OF THE NET-PAY READS, THOUGH IT COULD ─────
  //
  // Nothing in this panel shows net, so the four reads that turn gross into net
  // are wasted here — exactly the argument the Tuesday screen makes for
  // skipping them. `tests/net-pay-guard.test.ts` allows one file to do that and
  // no other, and it caught this on the first run.
  //
  // THE FENCE IS WORTH MORE THAN FOUR ROUND TRIPS. What it really guards is
  // that a BATCH never skips them — a settlement computed without its
  // deductions overpays every driver who has any — and a fence with two members
  // is one somebody adds a third to. This panel renders only for a DRAFT its
  // reader is editing, so the cost lands on an edit screen and nowhere near a
  // statement.
  //
  // THE GUARD READS THIS FILE AS TEXT, so naming the option in prose counted as
  // using it and failed a second time. Same shape as `prod-url-guard`, which
  // says so in its own header: a mention is indistinguishable from a call.
  const drivers = await batchInputForOrg(tx, {
    organizationId: input.organizationId,
    period: { start: input.periodStart, end: input.periodEnd },
    statementDate: input.periodEnd,
    checkDate: input.periodEnd,
  })

  const mine = drivers.find((driver) => driver.driverId === input.driverId)
  if (!mine) return []

  return mine.loads.map((load) => {
    // THE SAME `grossFor` THE BATCH USES. A panel that decided for itself which
    // gross a load settles on would be a second answer to §3's question, and
    // the two would diverge on exactly the loads that are hard.
    const decision = grossFor(load)
    return {
      loadId: load.id,
      loadNumber: load.loadNumber,
      companyName: load.companyName,
      puPlace: load.puPlace,
      delPlace: load.delPlace,
      puDate: load.puDate,
      delDate: load.delDate,
      grossCents: decision.settles ? decision.grossCents : load.rateCents,
      loadIdForCompany: load.companyId,
      milesHundredths: load.milesHundredths,
      held: decision.settles ? null : decision.reason,
    }
  })
}

export type AddTripsFailure =
  | 'not_found'
  | 'not_draft'
  | 'no_loads'
  | 'already_settled'
  /**
   * No rule in force on the delivery date, or one the engine cannot apply.
   * Refused WHOLE, the way `generateSettlement` refuses — a trip added at the
   * freight because nobody could price it is a cheque for a hundred percent.
   */
  | 'no_pay_rule'

export type AddTripsResult =
  | { ok: true; added: number }
  | { ok: false; reason: AddTripsFailure }

/**
 * Put chosen loads onto a DRAFT settlement, as trip lines and as pay.
 *
 * ── DRAFT ONLY, AND THAT IS THE WHOLE GUARD ───────────────────────────────
 *
 * A settlement that has been approved is a document somebody has been handed,
 * and §7 freezes it. Adding freight to one after the fact would change a figure
 * on paper without changing the paper.
 *
 * ── ONE ROW PER TRIP, PRICED (§6.2.2, migration 67) ───────────────────────
 *
 * A trip added here is a `SettlementLoadLine` — freight under `grossCents`,
 * the driver's cut under `amountCents`, the rule frozen beside it — and
 * nothing else. Until 67 this ALSO wrote a `SettlementLine` of type LOAD_PAY,
 * and wrote the FREIGHT as the pay on both rows, with a comment deferring the
 * pricing to `Recalculate`. `Recalculate` re-adds and does not re-price
 * (`recalculateAction` says so in its own words), so a trip added by hand was a
 * cheque for a hundred percent of the freight until somebody noticed. Nobody
 * had done it to a real statement — 0 of 6 workbench statements on dev carried
 * a load line — and it is closed before anybody does.
 *
 * THE PRICE IS `payFor` UNDER THE RULE IN FORCE WHEN THE LOAD RAN, the same
 * lookup `generateSettlement` makes. A load the rule cannot price refuses the
 * whole add, the way generation refuses: a short cheque with no explanation on
 * it is worse than a refusal that names the load.
 *
 * `refreshTotals` then reads both tables, so the header counts this trip once.
 */
export async function addTripsToSettlement(
  tx: TxClient,
  settlementId: string,
  loadIds: readonly string[],
): Promise<AddTripsResult> {
  if (loadIds.length === 0) return { ok: false, reason: 'no_loads' }

  const settlement = await tx.settlement.findFirst({
    where: { id: settlementId, deletedAt: null },
    select: {
      id: true,
      status: true,
      driverId: true,
      organizationId: true,
      periodStart: true,
      periodEnd: true,
    },
  })
  if (!settlement) return { ok: false, reason: 'not_found' }
  if (settlement.status !== 'DRAFT') return { ok: false, reason: 'not_draft' }

  const offered = await addableTrips(tx, {
    organizationId: settlement.organizationId,
    driverId: settlement.driverId,
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
  })
  const byId = new Map(offered.map((trip) => [trip.loadId, trip]))

  // ANYTHING NOT STILL ON OFFER IS REFUSED, WHOLE. A load that was settled
  // between the page rendering and the button being pressed is the race this
  // exists for, and adding the rest quietly would leave somebody believing all
  // of them landed.
  if (loadIds.some((id) => !byId.has(id))) {
    return { ok: false, reason: 'already_settled' }
  }

  // ── PRICED BEFORE ANYTHING IS WRITTEN ────────────────────────────────────
  //
  // The driver's rules, read once; the loads, read for the fields `payFor`
  // needs and for the POD date the rule is looked up on — the same lookup
  // `generateSettlement` makes, so a trip added by hand is paid exactly what a
  // generated one would have been.
  const rules: PayRule[] = await tx.driverPayRule.findMany({
    where: { driverId: settlement.driverId },
    select: {
      id: true,
      type: true,
      percentBps: true,
      perMileCents: true,
      flatCents: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  })
  const payable = await tx.load.findMany({
    where: { id: { in: [...loadIds] } },
    select: {
      id: true,
      loadNumber: true,
      linehaulCents: true,
      fuelSurchargeCents: true,
      accessorialsCents: true,
      totalRevenueCents: true,
      actualMiles: true,
      dispatchedMiles: true,
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
    },
  })
  const priced = new Map<
    string,
    { amountCents: number; snapshot: PaySnapshot }
  >()
  for (const load of payable) {
    const rule = ruleInForce(
      rules,
      load.statusEvents[0]?.occurredAt ?? settlement.periodEnd,
    )
    const result = payFor(load, rule)
    // WHOLE, not the rest: see the header.
    if (!result.ok) return { ok: false, reason: 'no_pay_rule' }
    priced.set(load.id, {
      amountCents: result.amountCents,
      snapshot: result.snapshot,
    })
  }

  const existing = await tx.settlementLoadLine.count({
    where: { settlementId },
  })
  let sortOrder = existing

  for (const id of loadIds) {
    const trip = byId.get(id)!
    const pay = priced.get(id)
    if (!pay) return { ok: false, reason: 'already_settled' }
    await tx.settlementLoadLine.create({
      data: {
        settlementId,
        organizationId: settlement.organizationId,
        loadId: trip.loadId,
        companyId: trip.loadIdForCompany,
        // WHOSE LINE IT IS, stored on the row and not only reachable through
        // the settlement — a team load writes one line per driver and the pair
        // are told apart by this.
        driverId: settlement.driverId,
        companyName: trip.companyName,
        loadNumber: trip.loadNumber,
        puPlace: trip.puPlace,
        delPlace: trip.delPlace,
        puDate: trip.puDate,
        delDate: trip.delDate,
        // THE FREIGHT, as the engine would settle it, and THE CUT, as the rule
        // prices it — two different numbers, which is the whole of 67.
        grossCents: trip.grossCents,
        milesHundredths: trip.milesHundredths,
        amountCents: pay.amountCents,
        payRuleSnapshot: pay.snapshot as unknown as Prisma.InputJsonValue,
        settledBasis: trip.held === null ? 'rate' : 'held_added',
        sortOrder: sortOrder++,
      },
    })
  }

  await refreshTotals(tx, settlementId)
  return { ok: true, added: loadIds.length }
}

// ---------------------------------------------------------------------------
// THE HEADER BOX (§6.2.2).
//
// Fourteen figures, and the rule the section is built on is that EVERY ONE OF
// THEM IS THE SUM OF SOMETHING ON THE PAGE BELOW IT. So this reads them from
// the settlement's own stored totals and its own lines — never by recomputing
// the engine — because a header that disagreed with the grid under it would be
// the one thing a driver checking his pay would find first.
//
// ── THE TWO `‹ ›` PAIRS GO TO DIFFERENT PLACES ────────────────────────────
//
// The artefact puts prev/next on the settlement number AND on the period, and
// they are two different journeys: one walks the batch (the run somebody is
// working through), the other walks the driver (one person across weeks). Both
// are read here so the page never renders a chevron that leads nowhere.
// ---------------------------------------------------------------------------

export interface StatementNeighbours {
  /** Adjacent statements in the same batch, by settlement number. */
  prevInBatch: { id: string; settlementNumber: string } | null
  nextInBatch: { id: string; settlementNumber: string } | null
  /** The same driver's adjacent periods, whatever batch they sit in. */
  prevPeriod: { id: string; periodStart: Date; periodEnd: Date } | null
  nextPeriod: { id: string; periodStart: Date; periodEnd: Date } | null
}

export interface FuelAndTolls {
  fuelCents: number
  tollCents: number
  totalCents: number
  fuelCount: number
  tollCount: number
  /**
   * What is already coming off the cheque, from `Expense.isDriverDeduction`.
   *
   * THE WHOLE POINT OF PRINTING IT BESIDE THE TOTAL. §6.2.3: a read is not a
   * charge, and the header figure is what was BURNED. Without this second
   * number the reader cannot tell a company-fuel driver from one who is about
   * to be charged $284.43, which is the difference the four modes exist to
   * settle.
   */
  alreadyDeductedCents: number
}

/**
 * Fuel and tolls for one driver in one period.
 *
 * READ-ONLY AND CHARGES NOTHING. `FuelTransaction` carries the purchase and
 * `Expense` carries the toll; neither carries a decision about who pays, so
 * this reports and stops. The columns that would let it charge are the held
 * migration (§6.2.3).
 *
 * BOUNDED BY THE PERIOD THE STATEMENT ALREADY HAS, not by a week recomputed
 * here — the statement's period is frozen on the row and a second opinion
 * about which days it covers is how a figure ends up on two statements.
 */
export async function fuelAndTollsFor(
  tx: TxClient,
  input: { driverId: string; periodStart: Date; periodEnd: Date },
): Promise<FuelAndTolls> {
  // INCLUSIVE AT BOTH ENDS, on every one of the three reads below. The period
  // end is stored as the Saturday itself, so a Saturday fill-up belongs to the
  // week it happened in.
  const window = { driverId: input.driverId, deletedAt: null }
  const [fuel, tolls, deducted] = await Promise.all([
    tx.fuelTransaction.aggregate({
      where: {
        ...window,
        purchasedAt: { gte: input.periodStart, lte: input.periodEnd },
      },
      _sum: { totalCents: true },
      _count: { _all: true },
    }),
    tx.expense.aggregate({
      where: {
        ...window,
        category: 'TOLLS',
        incurredAt: { gte: input.periodStart, lte: input.periodEnd },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    tx.expense.aggregate({
      where: {
        ...window,
        category: 'TOLLS',
        isDriverDeduction: true,
        incurredAt: { gte: input.periodStart, lte: input.periodEnd },
      },
      _sum: { amountCents: true },
    }),
  ])

  const fuelCents = fuel._sum.totalCents ?? 0
  const tollCents = tolls._sum.amountCents ?? 0
  return {
    fuelCents,
    tollCents,
    totalCents: fuelCents + tollCents,
    fuelCount: fuel._count._all,
    tollCount: tolls._count._all,
    alreadyDeductedCents: deducted._sum.amountCents ?? 0,
  }
}

/** The four documents a reader can step to from this one. */
export async function statementNeighbours(
  tx: TxClient,
  input: {
    settlementId: string
    batchId: string | null
    driverId: string
    settlementNumber: string
    periodStart: Date
  },
): Promise<StatementNeighbours> {
  const inBatch = { id: true, settlementNumber: true }
  const inPeriod = { id: true, periodStart: true, periodEnd: true }
  const batchWhere = (direction: 'lt' | 'gt') => ({
    batchId: input.batchId ?? '',
    deletedAt: null,
    settlementNumber: { [direction]: input.settlementNumber },
  })
  const driverWhere = (direction: 'lt' | 'gt') => ({
    driverId: input.driverId,
    deletedAt: null,
    id: { not: input.settlementId },
    periodStart: { [direction]: input.periodStart },
  })

  // NO BATCH MEANS NO BATCH NEIGHBOURS, and `batchId: ''` finds nothing rather
  // than finding every unbatched statement in the organization — which is what
  // `batchId: null` would have matched.
  const [prevInBatch, nextInBatch, prevPeriod, nextPeriod] = await Promise.all([
    input.batchId === null
      ? null
      : tx.settlement.findFirst({
          where: batchWhere('lt'),
          orderBy: { settlementNumber: 'desc' },
          select: inBatch,
        }),
    input.batchId === null
      ? null
      : tx.settlement.findFirst({
          where: batchWhere('gt'),
          orderBy: { settlementNumber: 'asc' },
          select: inBatch,
        }),
    tx.settlement.findFirst({
      where: driverWhere('lt'),
      orderBy: { periodStart: 'desc' },
      select: inPeriod,
    }),
    tx.settlement.findFirst({
      where: driverWhere('gt'),
      orderBy: { periodStart: 'asc' },
      select: inPeriod,
    }),
  ])

  return { prevInBatch, nextInBatch, prevPeriod, nextPeriod }
}
