import type { Prisma } from '@/generated/prisma/client'
import { parseWorkPeriod, type RemittanceReading } from './remittance'
import { MONEY_COLUMNS } from './remittance-shape'
import {
  keyFor,
  previewRemittance,
  type FreightRef,
  type Preview,
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
  freightByReference: ReadonlyMap<string, FreightRef>
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
 */
export const sourceKeyFor = (
  invoiceNumber: string,
  reference: string,
  itemType: string,
  column: string,
): string => `${invoiceNumber}:${reference}:${itemType}:${column}`

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
      line.load !== null &&
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
    const load = line.load!
    await tx.paymentLoadApplication.create({
      data: {
        paymentId: payment.id,
        loadId: load.id,
        organizationId: input.organizationId,
        amountCents: line.remittedCents,
      },
    })

    // ── THE CHARGES THAT ARRIVED WITH THE CASH ──────────────────────────
    //
    // Column-list driven, so a Detention or an Others that has been zero for
    // six weeks needs no code on the day it is not. Zero columns write
    // nothing: a zero accessorial would claim somebody checked and found none.
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
            loadId: load.id,
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
              rowReference,
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
