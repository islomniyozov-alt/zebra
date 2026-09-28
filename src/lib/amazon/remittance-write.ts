import type { Prisma } from '@/generated/prisma/client'
import {
  parseWorkPeriod,
  type RemittanceReading,
  type RemittanceSummary,
} from './remittance'
import { loadRevenueCents } from '../money'
import { refreshBillingStatus } from '../billing-status'
import { MONEY_COLUMNS } from './remittance-shape'
import {
  keyFor,
  referenceOfKey,
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

/**
 * WHETHER THIS TRIP'S BASE IS MISSING FROM THE RATE, OR ALREADY IN IT.
 *
 * Owner's ruling, 2026-09-26, option 1: book the tour base ONLY where
 * `rate + base == remitted`.
 *
 * ── WHY IT IS CONDITIONAL ─────────────────────────────────────────────────
 *
 * Booking every completed tour's base unconditionally was tried and measured. Of
 * the 39 trips carrying one on the 2026-09-13..19 week:
 *
 *   29  the base is ALREADY in the rate — `linehaul == remitted` exactly
 *    5  the base is MISSING — the gap IS the base, exactly
 *    0  neither
 *
 * So Datatruck includes it for most trips and omits it for a few, and a blanket
 * rule overstated 29 loads by the whole base and held 29 lines that were right.
 * The zero in "neither" is what makes a conditional rule safe rather than a
 * heuristic: the two populations do not overlap and nothing falls between them.
 *
 * ── IT IS AN EQUALITY, NOT A TOLERANCE ────────────────────────────────────
 *
 * `rate + base == remitted` to the cent. A near-miss is NOT a tour base to book
 * — it is a genuine short or over that somebody has to look at, and rounding it
 * into a match would be this system deciding a discrepancy was not one. That is
 * why DT-016422 (over by $272.29) and DT-016453 (over by $0.26) stay over: the
 * $0.26 is exactly the sort of thing a tolerance would have swallowed.
 */
export function booksTourBase(input: {
  /** What the remittance paid for the whole trip. */
  remittedCents: number
  /** The trip's rate as Zebra has it — the sum of the group's revenue. */
  ratedCents: number
  /** The tour base this remittance carries, zero when there is none. */
  tourBaseCents: number
}): boolean {
  if (input.tourBaseCents <= 0) return false
  return input.remittedCents === input.ratedCents + input.tourBaseCents
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

/**
 * True when every row in the workbook is money that is not freight.
 *
 * `classifyItemType` returns null for `Adjustments - Dispute` on purpose, so a
 * file with no classified row is a file with no freight. Asserted on the ROWS
 * rather than on the Load Board summary block: the rows are what the writer
 * iterates, and a mismatch between the two is exactly the kind of thing that
 * should show up as a refusal somewhere rather than be papered over here.
 */
export function isAdjustmentOnly(reading: RemittanceReading): boolean {
  return (
    reading.rows.length > 0 && reading.rows.every((row) => row.item === null)
  )
}

/**
 * Amazon's printed adjustment lines, for the note on such a payment.
 *
 * Null for an ordinary freight remittance, so the caller keeps its existing
 * wording and nothing changes for the six weeks already imported.
 */
/**
 * THE MARKER THAT SAYS "THIS PAYMENT IS A CREDIT, NOT FREIGHT".
 *
 * ── WHY A MARKER IS NEEDED AT ALL ─────────────────────────────────────────
 *
 * Two rulings meet here and they LOOK like they conflict:
 *
 *   2026-09-26  a payment that only declares the period and paid nothing into
 *               it is NOT the week's remittance — the label spans two weeks and
 *               the applications are the better evidence
 *   2026-09-27  a workbook whose money is entirely `Adjustments - Dispute`
 *               books a payment with zero applications, SHOWN on the money
 *               screen with Amazon's text
 *
 * THEY ONLY CONFLICT IF THE TWO CANNOT BE TOLD APART, and by shape they cannot:
 * a dispute credit has no applications, and so does a freight remittance whose
 * every unit is closed history — which is most of the corpus. "Zero
 * applications" is therefore not the discriminator, and the first attempt at
 * this used it and broke the 2026-09-26 guard on its first run.
 *
 * SO THE WRITER MARKS IT, and the screen reads the mark. The fact lives in the
 * workbook — no freight rows — and nothing on the `Payment` row carries it
 * otherwise.
 *
 * ── A NOTE PREFIX IS THE INTERIM, AND A COLUMN IS THE DURABLE FIX ─────────
 *
 * This is our own text, written in exactly one place and read in exactly one
 * place through this constant, which is what makes it tolerable — unlike
 * matching Amazon's wording, which changes without notice and did so this week.
 *
 * IT IS STILL A STRING STANDING IN FOR A BOOLEAN. The durable form is a column
 * on `Payment` — `isAdjustment`, defaulting false — and that is a migration and
 * a production ritual, which is a decision to take deliberately rather than
 * fold into this change. Flagged rather than done.
 */
/**
 * THE REFERENCES A WORKBOOK NAMES, deduplicated, in the preview's own terms.
 *
 * `keyFor` decides whether a row is keyed by its trip or by its load, and this
 * has to agree with it exactly — a reference list built by reading `loadId`
 * directly would miss every leg under a trip and the preview would report them
 * unmatched.
 */
export function remittanceReferences(reading: RemittanceReading): string[] {
  return [
    ...new Set(
      reading.rows
        // ONE DEFINITION OF WHAT A ROW'S REFERENCE IS — see `referenceOfKey`.
        .map((row) => referenceOfKey(keyFor(row)))
        .filter((value): value is string => value !== null),
    ),
  ]
}

/**
 * The freight those references point at, EVERY load per reference.
 *
 * ── A MAP OF ONE WAS THE 2026-09-25 BUG ───────────────────────────────────
 *
 * A trip with three legs has three Zebra loads carrying one `referenceNumber`,
 * and `Map<string, FreightRef>` kept whichever was written last — silently,
 * which is how a trip's whole remitted total came to be compared against one
 * leg's rate and seven lines were reported `over`.
 *
 * ── READ IT INSIDE THE TRANSACTION THE WRITE USES ─────────────────────────
 *
 * Not before it opens. The conditional tour-base predicate compares the remitted
 * total against the load's RATE, and on a re-import the rate outside the
 * transaction still carries the previous run's tour base — which made
 * `rate + base == remitted` false for every trip and booked nothing. The
 * comparison has to be against the state the write starts from.
 *
 * EXTRACTED FROM THE SCRIPT ON 2026-09-28 so the upload screen builds the same
 * map. Two copies of "which loads does this reference mean" is the shape that
 * produced the bug above.
 */
export async function freightForReferences(
  tx: TxClient,
  references: readonly string[],
): Promise<Map<string, FreightRef[]>> {
  const loads =
    references.length === 0
      ? []
      : await tx.load.findMany({
          where: { deletedAt: null, referenceNumber: { in: [...references] } },
          select: {
            id: true,
            loadNumber: true,
            referenceNumber: true,
            totalRevenueCents: true,
            billingStatus: true,
          },
        })

  const freight = new Map<string, FreightRef[]>()
  for (const load of loads) {
    if (!load.referenceNumber) continue
    freight.set(load.referenceNumber, [
      ...(freight.get(load.referenceNumber) ?? []),
      {
        id: load.id,
        loadNumber: load.loadNumber,
        reference: load.referenceNumber,
        totalRevenueCents: load.totalRevenueCents,
        closedHistory: load.billingStatus === 'CLOSED_IN_DATATRUCK',
      },
    ])
  }
  return freight
}

/** A company as the carrier match needs to see it. */
export interface CarrierCandidate {
  id: string
  name: string
  legalName: string | null
  scac: string | null
}

export type CarrierMatch =
  | { ok: true; company: CarrierCandidate }
  | { ok: false; matched: number }

/**
 * WHICH AUTHORITY A WORKBOOK'S CASH BELONGS TO.
 *
 * Owner's ruling, 2026-09-25: the company whose identity matches the workbook's
 * Carrier line, and REFUSE unless exactly one. Confirmed the same day as SCAC
 * AND legal name, both exact, both picking the same row.
 *
 * ── THE RULING SAID "MC" AND THE WORKBOOK HAS NO MC ───────────────────────
 *
 * Checked against the raw sheet: there is no motor-carrier number anywhere in
 * it. What it carries is a Carrier name and a SCAC —
 * `carrier "RAM HAULAGE LLC"`, `scac "ABFQZ"` — and `Company.legalName` and
 * `Company.scac` are the two columns that answer them.
 *
 * NOT A FUZZY MATCH. Case is folded because Amazon shouts the carrier name and
 * the company row does not; nothing else is relaxed. A week's cash is not routed
 * by a near miss, and two companies in this group differ by one word.
 *
 * ── EXTRACTED FROM THE SCRIPT ON 2026-09-28 ───────────────────────────────
 *
 * It lived inline in `scripts/import-amazon-remittance.ts` and the upload SCREEN
 * needed the same decision. Two copies of "which carrier got paid" is the shape
 * this codebase has paid for twice already — see `settleableInPeriod`. One
 * function, both callers.
 */
export function matchRemittanceCarrier(
  summary: Pick<RemittanceSummary, 'carrier' | 'scac'>,
  companies: readonly CarrierCandidate[],
): CarrierMatch {
  const same = (a: string | null, b: string | null) =>
    a !== null &&
    b !== null &&
    a.trim().toUpperCase() === b.trim().toUpperCase()

  const matches = companies.filter(
    (company) =>
      same(company.scac, summary.scac) &&
      same(company.legalName, summary.carrier),
  )
  return matches.length === 1
    ? { ok: true, company: matches[0]! }
    : { ok: false, matched: matches.length }
}

export const ADJUSTMENT_NOTE_PREFIX = 'Amazon adjustment'

export function adjustmentNote(reading: RemittanceReading): string | null {
  if (!isAdjustmentOnly(reading)) return null
  const lines = reading.summary.adjustments
    // ZERO LINES ARE DROPPED. Every workbook prints all four adjustment
    // categories whether or not they carry anything, so keeping the zeros would
    // bury the one line that says what happened in three that say nothing.
    .filter((line) => line.cents !== 0)
    .map((line) => `${line.type} · ${line.description}`.trim())
  const period = reading.summary.workPeriod ?? ''
  const head = `${ADJUSTMENT_NOTE_PREFIX} ${period}`.trim()
  return lines.length === 0 ? head : `${head} — ${lines.join('; ')}`
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
      // ── AMAZON'S OWN TEXT, WHEN THE MONEY IS ENTIRELY AN ADJUSTMENT ────
      //
      // Owner's ruling, 2026-09-27: such a workbook books a Payment with zero
      // applications, unapplied by design, shown on the money screen with
      // Amazon's text. This is that text — the adjustment lines as printed,
      // `Adjustments · 2 Resolved`, not a sentence written here about them.
      //
      // WHY IT MATTERS ON THIS PAYMENT PARTICULARLY: it has no applications, so
      // nothing else on the screen can say what it was for. A freight payment is
      // explained by the loads it paid; this one is explained only by its note.
      notes:
        adjustmentNote(reading) ??
        `Amazon remittance ${reading.summary.workPeriod ?? ''}`.trim(),
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

    // ── IS THIS TRIP'S BASE MISSING FROM THE RATE? ────────────────────
    //
    // Asked ONCE for the whole group, before any row is written, because it is a
    // question about the trip's arithmetic and not about an individual row.
    // `line.ratedCents` is the rate as Zebra has it and `line.remittedCents` is
    // what arrived, both already computed by the preview.
    const tourBaseCents = reading.rows
      .filter((row) => {
        const k = keyFor(row)
        const ref =
          k.branch === 'tour' || k.branch === 'load_under_trip'
            ? k.tripId
            : k.branch === 'single_load'
              ? k.loadId
              : ''
        return ref === reference && isTourBase(row.itemType, 'Base Rate')
      })
      .reduce((sum, row) => sum + (row.money['Base Rate'] ?? 0), 0)

    const bookTheBase = booksTourBase({
      remittedCents: line.remittedCents,
      ratedCents: line.ratedCents,
      tourBaseCents,
    })

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
        // THE TOUR BASE IS THE ONE EXCEPTION, by the 2026-09-26 ruling — and
        // only where the trip's rate is actually short of it. `bookTheBase` is
        // the group's arithmetic; `isTourBase` is this row's shape. Both.
        const tourBase = isTourBase(row.itemType, column) && bookTheBase
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
