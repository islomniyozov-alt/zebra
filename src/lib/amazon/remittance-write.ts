import type { Prisma } from '@/generated/prisma/client'
import { parseWorkPeriod, type RemittanceReading } from './remittance'
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
 * `Base Rate` IS NOT AN ACCESSORIAL. It is the linehaul the load was booked
 * at; only what arrived on top of it is a charge. Naming the exclusion here
 * rather than filtering silently, because "why is base rate missing" is the
 * first question anybody reading this asks.
 */
const NOT_A_CHARGE = new Set(['Base Rate'])

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
        if (NOT_A_CHARGE.has(column)) continue
        const cents = row.money[column] ?? 0
        if (cents === 0) continue

        await tx.loadAccessorial.create({
          data: {
            loadId: line.loads[0]!.id,
            organizationId: input.organizationId,
            type: ACCESSORIAL_TYPE[column] ?? 'OTHER',
            amountCents: cents,
            isBillable: true,
            // APPROVED ON ARRIVAL, because Amazon has already paid it. The
            // PENDING default is for a charge somebody is claiming from a
            // broker; this is cash in the bank.
            status: 'APPROVED',
            approvedAt: input.receivedAt,
            notes: `${column} — Amazon ${row.itemType}`,
            sourceKey: sourceKeyFor(
              invoiceNumber,
              rowKey,
              row.itemType,
              column,
            ),
          },
        })
        accessorialsWritten++
      }
    }
  }

  return {
    paymentId: payment.id,
    appliedUnits: live.length,
    appliedCents,
    accessorialsWritten,
    skippedClosedHistory: preview.counts.matched_closed_history,
    unappliedCents: headerCents - appliedCents,
    alreadyImported: false,
    preview,
  }
}
