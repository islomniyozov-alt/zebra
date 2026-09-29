import type { Prisma } from '@/generated/prisma/client'
import { batchInputForOrg } from './settlement-batch'
import { grossFor, type HeldReason } from './settlement-week'
import { refreshTotals } from './settlements'

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
 * ── THE TRIP LINE AND THE PAY LINE ARE WRITTEN TOGETHER ───────────────────
 *
 * `SettlementLoadLine` is the frozen snapshot the statement prints; the
 * `SettlementLine` of type LOAD_PAY is what the driver is actually paid for it.
 * Writing one without the other is how a statement comes to show a trip that
 * pays nothing, or pay with no trip behind it — both of which are arguments in
 * front of a driver.
 *
 * WHAT THIS DOES NOT DO IS PRICE THE LOAD. `amountCents` is left at the gross
 * for a held load and at the engine's figure otherwise, and `Recalculate` is
 * what applies the pay rule. Pricing here would be a third place that knows how
 * a driver is paid.
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

  const existing = await tx.settlementLoadLine.count({
    where: { settlementId },
  })
  let sortOrder = existing

  for (const id of loadIds) {
    const trip = byId.get(id)!
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
        grossCents: trip.grossCents,
        milesHundredths: trip.milesHundredths,
        amountCents: trip.grossCents,
        settledBasis: trip.held === null ? 'rate' : 'held_added',
        sortOrder: sortOrder++,
      },
    })

    await tx.settlementLine.create({
      data: {
        settlementId,
        organizationId: settlement.organizationId,
        type: 'LOAD_PAY',
        description: `${trip.loadNumber} ${trip.puPlace} → ${trip.delPlace}`,
        amountCents: trip.grossCents,
        loadId: trip.loadId,
        sortOrder: sortOrder,
      },
    })
  }

  await refreshTotals(tx, settlementId)
  return { ok: true, added: loadIds.length }
}
