import type { Prisma } from '@/generated/prisma/client'
import { parseWorkPeriod, type RemittanceReading } from './remittance'
import { loadRevenueCents } from '../money'
import { refreshBillingStatus } from '../billing-status'
import { MONEY_COLUMNS } from './remittance-shape'
import {
  keyFor,
  previewRemittance,
  type FreightRef,
  type Preview,
  type RowKey,
} from './remittance-preview'

// ---------------------------------------------------------------------------
// WHAT A CONFIRMED REMITTANCE WRITES, AND WHAT IT REFUSES TO TOUCH.
//
// ── THE EXCLUSION IS THE FIFTH OUTCOME, NOT A DATE ───────────────────────
//
// The owner's ruling of 2026-09-10: Zebra's revenue starts at the books
// cutover, and the fifth outcome IS the exclusion rule — no new mechanism.
//
// So there is no date comparison in this file. A unit whose load is
// `CLOSED_IN_DATATRUCK` comes back from the preview as
// `matched_closed_history` and this writer skips it entirely: no Payment
// share, no application, no accessorial, no status change. Nothing.
//
// THAT IS 96% OF EVERY WEEK CURRENTLY IN THE CORPUS — 847 of 881 units. A
// writer that touched them would be applying cash to freight another system
// already settled, against loads `SETTLEABLE_LOAD` excludes, so the money
// could never come out again. The one thing this file must get right is doing
// nothing, at scale, quietly.
//
// ── THE PAYMENT IS THE ACH, NOT THE SUM OF WHAT WE MATCHED ───────────────
//
// `amountCents` is the remittance's header total — the cash Amazon actually
// sent. `unappliedCents` is what is left after the live units are applied, and
// on every week in the corpus that is nearly the whole of it, because nearly
// every unit is closed history.
//
// A payment whose amount was the sum of its applications would always balance
// and would therefore never say anything. This one shows the gap.
// ---------------------------------------------------------------------------

type TxClient = Prisma.TransactionClient

/** Which money columns become accessorial rows, and as what. */
const ACCESSORIAL_TYPE: Record<string, 'DETENTION' | 'TONU' | 'OTHER'> = {
  Detention: 'DETENTION',
  TONU: 'TONU',
  'Fuel Surcharge': 'OTHER',
  Tolls: 'OTHER',
  Others: 'OTHER',
}

/**
 * `Base Rate` IS NOT AN ACCESSORIAL — ON A LOAD ROW.
 *
 * It is the linehaul the load was booked at; only what arrived on top of it is a
 * charge. Naming the exclusion here rather than filtering silently, because "why
 * is base rate missing" is the first question anybody reading this asks.
 *
 * ── EXCEPT ON A `TOUR - COMPLETED` ROW, SINCE 2026-09-26 ────────────────
 *
 * Owner's ruling. A tour's base is money Amazon paid for the trip that Zebra had
 * never booked anywhere: the Datatruck export's `Load pay` carries only the leg
 * amounts, so the trip's load was short by the whole tour base and the
 * remittance then read `over` by four to eight times.
 *
 * MEASURED, four for four to the cent, before the ruling: on DT-016233 the legs
 * are $37.87 + $56.73 = $94.60, which IS the load's linehaul exactly, and the
 * $654.97 tour base appears nowhere. Five loads, $4,790.24 of unbooked revenue.
 *
 * So a tour's base is booked as a remittance-sourced accessorial named
 * `Tour base`, and the load's revenue is recomputed from its rows. A LOAD row's
 * base rate stays excluded, because that one really is already the linehaul.
 */
const NOT_A_CHARGE = new Set(['Base Rate'])

/** The item type whose `Base Rate` IS a charge, by the 2026-09-26 ruling. */
const TOUR_BASE_ITEM = 'TOUR - COMPLETED'

/** What the tour base is called in the key and on the row. */
export const TOUR_BASE_LABEL = 'Tour base'

/**
 * How long a whole week's remittance import may hold its transaction.
 *
 * A week is ~140 applications, ~200 accessorials and ~140 revenue updates, each
 * a round trip to Neon at roughly 200ms. `LOAD_WRITE_TIMEOUT_MS` is 20s and
 * `SETTLEMENT_BATCH_TIMEOUT_MS` is 60s; neither is this shape of work.
 *
 * MEASURED: the 2026-09-13..19 week ran 120,425ms against a 120,000ms ceiling on
 * the first attempt at the tour-base ruling. The shape was then made cheaper —
 * three queries instead of three per load — and this is the honest headroom for
 * what remains, not a number chosen to make a failure go away.
 */
export const REMITTANCE_IMPORT_TIMEOUT_MS = 600_000

/**
 * Whether this row's `Base Rate` is money to book on the load.
 *
 * TRUE ONLY FOR A COMPLETED TOUR. A cancelled tour's money arrives as TONU in
 * its own column and is already a charge; a load row's base rate is the
 * linehaul. Written as a function so the guard has one thing to break.
 */
export function isTourBase(itemType: string, column: string): boolean {
  return column === 'Base Rate' && itemType === TOUR_BASE_ITEM
}

export interface RemittanceWriteInput {
  organizationId: string
  companyId: string
  customerId: string
  reading: RemittanceReading
  /** EVERY load per reference. A trip's legs share one reference. */
  freightByReference: ReadonlyMap<string, readonly FreightRef[]>
  receivedAt: Date
  recordedByUserId?: string | null
}

export interface RemittanceWriteResult {
  paymentId: string
  /** Units that produced writes. Never includes closed history. */
  appliedUnits: number
  appliedCents: number
  accessorialsWritten: number
  /** Counted, deliberately untouched. */
  skippedClosedHistory: number
  unappliedCents: number
  /** True when this remittance had already been written. */
  alreadyImported: boolean
  preview: Preview
}

/**
 * The source key MONEY-DESIGN §2 names: invoice, reference, item type, column.
 *
 * The COLUMN is in the key and the design's version did not have it. Without
 * it a row's fuel surcharge and its tolls would share one key and the second
 * would be refused as a duplicate of the first — one charge silently lost per
 * row that carries two.
 *
 * AND THE ROW'S OWN IDENTITY IS IN IT TOO, since 2026-09-25. The reference
 * alone was not enough: for a load under a trip the reference IS the trip, so
 * every load under one trip shared a key. See `rowIdentity`.
 */
export const sourceKeyFor = (
  invoiceNumber: string,
  key: RowKey,
  itemType: string,
  column: string,
): string => `${invoiceNumber}:${rowIdentity(key)}:${itemType}:${column}`

/**
 * What distinguishes ONE ROW from the others sharing its reference.
 *
 * ── THE COLLISION THIS FIXES ──────────────────────────────────────────────
 *
 * The key used to be built from the REFERENCE, which for a load under a trip is
 * the TRIP — so every load under one trip produced the same key. On the
 * 2026-09-13..19 remittance that is 38 collisions, all of them
 * `T-<tripId>:LOAD - COMPLETED:Fuel Surcharge` and friends: several loads under
 * one trip, each with its own fuel surcharge.
 *
 * The unique index refused the second one and the write threw, which is the
 * right failure and is how this was found — but it means the week could not
 * import at all, and an `upsert` or a `skipDuplicates` here would have dropped
 * real charges silently instead.
 *
 * SO THE TRIP STAYS IN THE KEY AND THE LOAD JOINS IT. Keeping both means the
 * key still says which trip the charge belongs to, which is what somebody
 * reconciling a trip wants to grep for.
 */
function rowIdentity(key: RowKey): string {
  switch (key.branch) {
    case 'tour':
      return key.tripId
    case 'load_under_trip':
      return `${key.tripId}/${key.loadId}`
    case 'single_load':
      return key.loadId
    case 'unkeyable':
      // Unreachable from the caller, which skips unkeyable rows — but returning
      // a constant would make every unkeyable row collide with every other.
      throw new Error('sourceKeyFor: an unkeyable row has no identity')
  }
}

export async function writeRemittance(
  tx: TxClient,
  input: RemittanceWriteInput,
): Promise<RemittanceWriteResult> {
  const { reading, freightByReference: freight } = input
  const preview = previewRemittance(reading, freight)
  const invoiceNumber = reading.summary.invoiceNumber ?? ''

  // ── ALREADY IMPORTED? ──────────────────────────────────────────────────
  //
  // Asked before anything is written, and the database is asked again by the
  // unique index when the create runs. Two guards for one rule because this is
  // the one that stops a double payment reaching a settlement.
  const existing = await tx.payment.findFirst({
    where: {
      organizationId: input.organizationId,
      remittanceKey: invoiceNumber,
    },
    select: { id: true, unappliedCents: true },
  })
  if (existing) {
    return {
      paymentId: existing.id,
      appliedUnits: 0,
      appliedCents: 0,
      accessorialsWritten: 0,
      skippedClosedHistory: preview.counts.matched_closed_history,
      unappliedCents: existing.unappliedCents,
      alreadyImported: true,
      preview,
    }
  }

  // ── THE LIVE UNITS, AND ONLY THE LIVE UNITS ────────────────────────────
  //
  // `matched_closed_history` is absent from this list by construction. So is
  // `unmatched`, which has no load to apply to, and `unkeyable`.
  const live = preview.lines.filter(
    (line) =>
      line.loads.length > 0 &&
      (line.outcome === 'matched_exact' ||
        line.outcome === 'short' ||
        line.outcome === 'over'),
  )

  const appliedCents = live.reduce((sum, line) => sum + line.remittedCents, 0)
  const headerCents = reading.totals.headerCents

  const period = parseWorkPeriod(reading.summary.workPeriod)

  const payment = await tx.payment.create({
    data: {
      organizationId: input.organizationId,
      companyId: input.companyId,
      customerId: input.customerId,
      method: 'ACH',
      referenceNumber: invoiceNumber,
      remittanceKey: invoiceNumber,
      receivedAt: input.receivedAt,
      amountCents: headerCents,
      unappliedCents: headerCents - appliedCents,
      recordedByUserId: input.recordedByUserId ?? null,
      notes: `Amazon remittance ${reading.summary.workPeriod ?? ''}`.trim(),
      // THE WORK PERIOD AS DAYS, not only as the sentence in `notes`. The money
      // screen asks "is this week's remittance in" and had to ask it sideways —
      // through the loads the payment applied to — because the period existed
      // only inside a string. `parseWorkPeriod` refuses anything that is not a
      // Sunday-to-Saturday week, so a label this cannot read leaves these null
      // and the screen falls back to the sideways question rather than storing
      // a week it guessed.
      ...(period ? { periodStart: period.start, periodEnd: period.end } : {}),
    },
    select: { id: true },
  })

  let accessorialsWritten = 0

  for (const line of live) {
    // ── ONE APPLICATION PER LEG, EACH ITS OWN SHARE ─────────────────────
    //
    // Owner's ruling, 2026-09-25. This wrote ONE application carrying the
    // group's whole `remittedCents` against ONE load — so a trip's total landed
    // on a single leg, and the settlement engine then compared that total
    // against that leg's rate and called it `over`. Seven loads on the first
    // real week, $749.57 against $94.60 among them.
    //
    // The engine's per-load comparison was right the whole time. This was the
    // wrong denominator, written into the data.
    //
    // `appliedCents` comes from the preview so the split has ONE definition:
    // for a matched group it is each load's own rate exactly, and for a short or
    // over group it is the arrived cash apportioned by rate. Either way the
    // parts sum to `remittedCents`.
    for (const [index, load] of line.loads.entries()) {
      await tx.paymentLoadApplication.create({
        data: {
          paymentId: payment.id,
          loadId: load.id,
          organizationId: input.organizationId,
          amountCents: line.appliedCents[index] ?? 0,
        },
      })
    }

    // ── THE CHARGES THAT ARRIVED WITH THE CASH ──────────────────────────
    //
    // Column-list driven, so a Detention or an Others that has been zero for
    // six weeks needs no code on the day it is not. Zero columns write
    // nothing: a zero accessorial would claim somebody checked and found none.
    //
    // ── WHICH LEG A TRIP'S CHARGE LANDS ON ──────────────────────────────
    //
    // The FIRST, and it is arbitrary because the data gives no better answer. A
    // remittance row under a trip carries its own Amazon load id, but Zebra's
    // legs all carry the TRIP as their `referenceNumber` — there is no column
    // pairing one to the other, so "which leg had the detention" is not a
    // question these two files can answer.
    //
    // NOT APPORTIONED. A detention charge happened at one stop; splitting it
    // across three legs would invent three charges that never existed and make
    // each one unreconcilable against the remittance that named it.
    //
    // The `sourceKey` carries the row's own trip-and-load identity, so every
    // charge stays distinct and greppable back to its line whichever leg holds
    // it. Stated here rather than left to be discovered.
    const reference =
      line.key.branch === 'tour' || line.key.branch === 'load_under_trip'
        ? line.key.tripId
        : line.key.branch === 'single_load'
          ? line.key.loadId
          : ''

    for (const row of reading.rows) {
      const rowKey = keyFor(row)
      const rowReference =
        rowKey.branch === 'tour' || rowKey.branch === 'load_under_trip'
          ? rowKey.tripId
          : rowKey.branch === 'single_load'
            ? rowKey.loadId
            : ''
      if (rowReference !== reference) continue

      for (const column of MONEY_COLUMNS) {
        // THE TOUR BASE IS THE ONE EXCEPTION, by the 2026-09-26 ruling.
        const tourBase = isTourBase(row.itemType, column)
        if (NOT_A_CHARGE.has(column) && !tourBase) continue
        const cents = row.money[column] ?? 0
        if (cents === 0) continue

        await tx.loadAccessorial.create({
          data: {
            loadId: line.loads[0]!.id,
            organizationId: input.organizationId,
            type: ACCESSORIAL_TYPE[column] ?? 'OTHER',
            amountCents: cents,
            // ── ONLY THE TOUR BASE ADDS TO REVENUE ────────────────────
            //
            // `accessorialsTotalCents` counts BILLABLE rows, and revenue is
            // `linehaul + fuelSurcharge + accessorials`. Marking every
            // remittance charge billable DOUBLE COUNTS, and the rehearsal said
            // so in one number: all 139 units went `short` where 132 had
            // matched to the cent.
            //
            // THAT IS THE EVIDENCE THAT `Load pay` ALREADY CONTAINS THEM. Those
            // 132 matched because the Datatruck rate equalled the whole remitted
            // amount — surcharges, tolls and all — so a remittance surcharge is
            // a BREAKDOWN of money already inside the rate, not money on top of
            // it. It is written for the detail and excluded from the sum.
            //
            // The tour base is the exception the ruling is about: it belongs to
            // the TOUR row, Datatruck's `Load pay` never captured it, and it is
            // the only one of these that is genuinely additional.
            //
            // A Datatruck-sourced accessorial is untouched by this — DT-016453
            // carries $124.00 of its own and that stays billable.
            isBillable: tourBase,
            // APPROVED ON ARRIVAL, because Amazon has already paid it. The
            // PENDING default is for a charge somebody is claiming from a
            // broker; this is cash in the bank.
            status: 'APPROVED',
            approvedAt: input.receivedAt,
            notes: tourBase
              ? `${TOUR_BASE_LABEL} — Amazon ${row.itemType}`
              : `${column} — Amazon ${row.itemType}`,
            sourceKey: sourceKeyFor(
              invoiceNumber,
              rowKey,
              row.itemType,
              // NAMED `Tour base` IN THE KEY TOO, so the row is greppable as
              // what it is rather than as a base rate that slipped through.
              tourBase ? TOUR_BASE_LABEL : column,
            ),
          },
        })
        accessorialsWritten++
      }
    }
  }

  // ── THE LOAD'S REVENUE FOLLOWS ITS ROWS ─────────────────────────────────
  //
  // `Load.totalRevenueCents` is a STORED column and `remittanceOutcome` compares
  // against it, so booking the tour base and stopping would leave the very
  // number this ruling exists to correct at its old value. `recomputeFromAccessorials`
  // is `rates.ts`'s own rollup — shared rather than reimplemented, so the
  // remittance and the rate screen cannot disagree about what a load is worth.
  //
  // IT ALSO REFRESHES THE BILLING STATUS, which is the point of going through
  // that function rather than writing two columns here: a load whose revenue
  // moved may no longer be fully paid, and `billingStatusFor` owns that.
  const touchedLoadIds = [
    ...new Set(live.flatMap((line) => line.loads.map((load) => load.id))),
  ]

  // ── THREE QUERIES PLUS ONE UPDATE EACH, NOT THREE EACH ────────────────
  //
  // `recomputeFromAccessorials` is the right rule and the wrong shape at this
  // scale: it reads the load, sums its rows and refreshes the billing status
  // ONE LOAD AT A TIME, which for a week's 139 loads is over 400 round trips to
  // Neon. The first attempt at this ruling died on exactly that —
  //
  //   Transaction API error: A query cannot be executed on an expired
  //   transaction. The timeout for this transaction was 120000 ms, however
  //   120425 ms passed since the start of the transaction.
  //
  // — which is the transaction-budget hazard AGENTS.md records, arriving through
  // a loop rather than through a missing `timeoutMs`.
  //
  // SO THE SHAPE CHANGES AND THE RULE DOES NOT. The totals come from one
  // `groupBy`, the rates from one `findMany`, the revenue from
  // `loadRevenueCents` — the same function `rates.ts` uses, called here rather
  // than reimplemented in SQL — and the billing status from ONE
  // `refreshBillingStatus` over every id instead of one call per load.
  const totals = await tx.loadAccessorial.groupBy({
    by: ['loadId'],
    where: {
      loadId: { in: touchedLoadIds },
      isBillable: true,
      status: { not: 'DENIED' },
    },
    _sum: { amountCents: true },
  })
  const accessorialsByLoad = new Map(
    totals.map((row) => [row.loadId, row._sum.amountCents ?? 0]),
  )
  const rates = await tx.load.findMany({
    where: { id: { in: touchedLoadIds } },
    select: { id: true, linehaulCents: true, fuelSurchargeCents: true },
  })
  for (const load of rates) {
    const accessorialsCents = accessorialsByLoad.get(load.id) ?? 0
    await tx.load.update({
      where: { id: load.id },
      data: {
        accessorialsCents,
        totalRevenueCents: loadRevenueCents({
          linehaulCents: load.linehaulCents,
          fuelSurchargeCents: load.fuelSurchargeCents,
          accessorialsCents,
        }),
      },
    })
  }
  // ONE CALL, EVERY ID. A load whose revenue moved may no longer be fully paid,
  // and `billingStatusFor` owns that question.
  await refreshBillingStatus(tx, touchedLoadIds)

  // ── AND THE OUTCOME IS RE-DERIVED AGAINST THE REVENUE IT JUST SET ───────
  //
  // Otherwise the numbers this function REPORTS would lag the numbers it wrote
  // by one run: the first preview compared the remittance against a load whose
  // tour base was not yet booked, so it would still say `over` on the very
  // trips this ruling matches. A caller reading those counts would conclude the
  // ruling had not worked.
  //
  // The applications above are unaffected by the order: a reference maps to one
  // load on this data, so its share is the whole remitted amount whatever the
  // rate says. Stated rather than assumed, because it stops being true the day
  // a trip's legs arrive as separate loads.
  const refreshed = await tx.load.findMany({
    where: { id: { in: touchedLoadIds } },
    select: {
      id: true,
      loadNumber: true,
      referenceNumber: true,
      totalRevenueCents: true,
      billingStatus: true,
    },
  })
  const afterByReference = new Map<string, FreightRef[]>()
  for (const load of refreshed) {
    if (!load.referenceNumber) continue
    afterByReference.set(load.referenceNumber, [
      ...(afterByReference.get(load.referenceNumber) ?? []),
      {
        id: load.id,
        loadNumber: load.loadNumber,
        reference: load.referenceNumber,
        totalRevenueCents: load.totalRevenueCents,
        closedHistory: load.billingStatus === 'CLOSED_IN_DATATRUCK',
      },
    ])
  }
  // Freight this remittance never matched keeps its original entry, so the
  // unmatched count does not collapse to nothing.
  for (const [reference, group] of freight) {
    if (!afterByReference.has(reference)) {
      afterByReference.set(reference, [...group])
    }
  }
  const previewAfter = previewRemittance(reading, afterByReference)

  return {
    paymentId: payment.id,
    appliedUnits: live.length,
    appliedCents,
    accessorialsWritten,
    skippedClosedHistory: preview.counts.matched_closed_history,
    unappliedCents: headerCents - appliedCents,
    alreadyImported: false,
    // THE PREVIEW AFTER THE WRITE, not before it. See the note above.
    preview: previewAfter,
  }
}
