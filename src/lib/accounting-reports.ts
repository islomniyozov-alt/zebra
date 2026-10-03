import { Prisma } from '@/generated/prisma/client'
import { bucketExprSql } from './week-sql'
import type { Grain, PeriodWindow } from './rolling-period'

/** Plain transaction client, as the other reporting modules declare it. */
type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// THE CHARTED FIGURES ON /accounting/reports. §6.2.7.
//
// Three readers, one statement each, all bucketed by the picker's grain over
// the picker's window.
//
// ── THEY DO NOT READ THE LIST READERS, AND THAT IS THE POINT ─────────────
//
// `readInvoices` takes 2000 rows, `listPayments` takes 300, `directAging` takes
// 500. Those caps are right for a screen somebody scrolls and wrong for a sum:
// a 52-week total built on a reader that stops at 300 rows is wrong exactly
// when the business is busy, and silently. So these aggregate in SQL over the
// whole window, and §6.2.7's "ties to the cent" claim is tested where the
// lists are not truncated — which is stated in the contract as the limit of it.
//
// ── CLOSED HISTORY ───────────────────────────────────────────────────────
//
// Item 7 includes it in GROSS, which is `by-company.ts`'s job and not this
// module's. Nothing here reads a load: an invoice, a payment and a settlement
// are all Zebra's own records, so there is no Datatruck history to include or
// exclude. Said out loud because "closed history included in gross, excluded
// everywhere else" is the kind of rule that gets applied to the wrong query.
// ---------------------------------------------------------------------------

/**
 * The company clause for one table alias, or nothing at all.
 *
 * EXPORTED because /accounting/reports hands the same list to agingSums in
 * factoring.ts, which takes a Prisma.Sql. Writing the clause twice is how one
 * chart ends up scoped and the one beside it does not.
 *
 * AN EMPTY LIST IS NO CLAUSE, never = ANY of an empty array: the latter matches
 * nothing and would empty every chart at once, which is the failure here that
 * looks like good news.
 */
export const scopeSql = (
  alias: string,
  companyIds: readonly string[],
): Prisma.Sql =>
  companyIds.length === 0
    ? Prisma.empty
    : Prisma.sql`AND ${Prisma.raw(`"${alias}"."companyId"`)} = ANY(${[...companyIds]})`

export interface ReceivablesPoint {
  bucketStart: Date
  /** Issued, not factored. What the carrier asked somebody to pay. */
  invoicedCents: number
  /** Issued and SOLD. Its own series — never inside the two above. */
  factoredCents: number
  /** Payments received, excluding factoring advances and reserves. */
  collectedCents: number
}

/**
 * Invoiced, factored and collected per bucket.
 *
 * ── WHY THREE SERIES AND NOT TWO ─────────────────────────────────────────
 *
 * §6.2.7: a factored invoice is sold, so it is neither a receivable nor money
 * the carrier collected. It is still revenue somebody raised, so hiding it
 * would make the invoiced line drop in a week the business was busy. Its own
 * series, drawn beside the other two.
 *
 * AND COLLECTED EXCLUDES FACTORING METHODS for the mirror reason: a factoring
 * advance arrives as a payment, and counting it as collection beside the
 * invoice it advanced against counts the same freight twice.
 *
 * ── THE DATES EACH SERIES BUCKETS ON ─────────────────────────────────────
 *
 * Invoiced and factored bucket on `issueDate` — the day the carrier billed —
 * and a DRAFT has no issue date and is not billing. Collected buckets on
 * `receivedAt`. So the three answer "what did we bill this week" and "what
 * arrived this week", which are different questions about the same week and
 * are not expected to match.
 *
 * WRITTEN_OFF STAYS IN INVOICED. It was billed; giving up on it later does not
 * unbill it. VOID does not: a void invoice was withdrawn, not forgiven.
 */
export async function receivablesSeries(
  tx: TxClient,
  companyIds: readonly string[],
  period: PeriodWindow,
  grain: Grain,
): Promise<ReceivablesPoint[]> {
  const invoiceBucket = bucketExprSql(Prisma.sql`i."issueDate"`, grain)
  const paymentBucket = bucketExprSql(Prisma.sql`p."receivedAt"`, grain)

  // ONE STATEMENT, TWO TABLES, A FULL OUTER JOIN ON THE BUCKET. A week with
  // invoices and no payments must still produce a row, and so must the
  // reverse — an inner join would drop exactly the weeks worth looking at.
  const rows = await tx.$queryRaw<
    {
      bucket_start: Date
      invoiced: bigint
      factored: bigint
      collected: bigint
    }[]
  >`
    WITH billed AS (
      SELECT ${invoiceBucket} AS bucket_start,
             COALESCE(SUM(i."totalCents") FILTER (
               WHERE i."isFactored" = false), 0)::bigint AS invoiced,
             COALESCE(SUM(i."totalCents") FILTER (
               WHERE i."isFactored" = true), 0)::bigint AS factored
      FROM "Invoice" i
      WHERE i."deletedAt" IS NULL
        AND i."issueDate" IS NOT NULL
        AND i."status" NOT IN ('DRAFT', 'VOID')
        ${scopeSql('i', companyIds)}
        AND i."issueDate" >= ${period.from}
        AND i."issueDate" < ${period.to}
      GROUP BY 1
    ),
    received AS (
      SELECT ${paymentBucket} AS bucket_start,
             COALESCE(SUM(p."amountCents"), 0)::bigint AS collected
      FROM "Payment" p
      WHERE p."deletedAt" IS NULL
        -- FACTORING IS NOT COLLECTION. See the note above the function.
        AND p."method" NOT IN ('FACTORING_ADVANCE', 'FACTORING_RESERVE')
        ${scopeSql('p', companyIds)}
        AND p."receivedAt" >= ${period.from}
        AND p."receivedAt" < ${period.to}
      GROUP BY 1
    )
    SELECT COALESCE(b.bucket_start, r.bucket_start) AS bucket_start,
           COALESCE(b.invoiced, 0)::bigint AS invoiced,
           COALESCE(b.factored, 0)::bigint AS factored,
           COALESCE(r.collected, 0)::bigint AS collected
    FROM billed b
    FULL OUTER JOIN received r ON r.bucket_start = b.bucket_start
    ORDER BY 1
  `

  return rows.map((row) => ({
    bucketStart: row.bucket_start,
    invoicedCents: Number(row.invoiced),
    factoredCents: Number(row.factored),
    collectedCents: Number(row.collected),
  }))
}

export interface SettlementPaidPoint {
  bucketStart: Date
  /** The freight the percentages were taken OF — Settlement.grossCents. */
  grossCents: number
  /** What the cheques were written for. */
  netCents: number
}

/**
 * Paid settlements per bucket, gross against net.
 *
 * PAID MEANS THE BATCH IS PAID, which is the state the batches grid shows and
 * the only one that means money left the account. A FINAL batch is approved and
 * unpaid; counting it here would put next week's cheques in this week's total.
 *
 * BUCKETED ON `periodStart`, the week the work was done — not `checkDate`, the
 * day it was paid for. A chart of "settlements paid" by cheque date moves a
 * week's pay into whichever week the office got round to it.
 */
export async function settlementsPaidSeries(
  tx: TxClient,
  companyIds: readonly string[],
  period: PeriodWindow,
  grain: Grain,
): Promise<SettlementPaidPoint[]> {
  const bucket = bucketExprSql(Prisma.sql`s."periodStart"`, grain)

  const rows = await tx.$queryRaw<
    { bucket_start: Date; gross: bigint; net: bigint }[]
  >`
    SELECT ${bucket} AS bucket_start,
           COALESCE(SUM(s."grossCents"), 0)::bigint AS gross,
           COALESCE(SUM(s."netCents"), 0)::bigint AS net
    FROM "Settlement" s
    JOIN "SettlementBatch" b ON b."id" = s."batchId"
    WHERE s."deletedAt" IS NULL
      AND b."deletedAt" IS NULL
      AND b."status" = 'PAID'
      ${scopeSql('s', companyIds)}
      AND s."periodStart" >= ${period.from}
      AND s."periodStart" < ${period.to}
    GROUP BY 1
    ORDER BY 1
  `

  return rows.map((row) => ({
    bucketStart: row.bucket_start,
    grossCents: Number(row.gross),
    netCents: Number(row.net),
  }))
}

export const DEDUCTION_CATEGORIES = [
  'standing',
  'fuelTolls',
  'advances',
  'other',
] as const

export type DeductionCategory = (typeof DEDUCTION_CATEGORIES)[number]

export interface DeductionSlice {
  category: DeductionCategory
  /** POSITIVE cents: what came off the cheques. See the note on the sign. */
  cents: number
  lines: number
}

/**
 * Deductions for the window, in the four categories §6.2.7 names.
 *
 * ── THE CATEGORIES ARE ASSEMBLED, NOT STORED ─────────────────────────────
 *
 * `SettlementDeductionLine` has no category column. It carries a printed
 * `type` label — `Fuel`, `Insurance`, `Escrow`, `Admin Fee` — and the id of the
 * rule or one-off that produced it. The brief calls the four buckets "the
 * categories the statement prints"; the statement prints one row per LINE, so
 * the buckets are derived here and §6.2.7 is where the mapping is written down.
 *
 * SOURCE BEATS LABEL, and the order below is the contract. The categories
 * OVERLAP — an org-wide fuel charge is both standing and fuel — and a donut
 * whose slices overlap is not a share of anything. "What did the organization's
 * own rules take off these cheques" is the question this chart is asked, so a
 * standing charge is standing whatever it is called.
 *
 * ── ONLY NEGATIVE LINES ──────────────────────────────────────────────────
 *
 * `totalCents` is SIGNED and Other Pay shares the table: a reimbursement is a
 * positive row. A donut of "deductions" that included them would net two
 * opposite things into one slice. The sign is flipped on the way out so the
 * chart adds up.
 *
 * ── MEASURED BEFORE IT WAS WRITTEN ───────────────────────────────────────
 *
 * Dev holds ONE deduction line in the entire database — Insurance, -$450.00,
 * from no standing charge — across 142 settlements, with no advances, no
 * one-off charges and no fuel or toll lines
 * (`scripts/census-deduction-categories.ts`). So three of these four buckets
 * are empty on dev and the variety comes from seeded fixtures. A four-slice
 * donut designed against that artefact without saying so would be a guess.
 */
export async function deductionsByCategory(
  tx: TxClient,
  companyIds: readonly string[],
  period: PeriodWindow,
): Promise<DeductionSlice[]> {
  const rows = await tx.$queryRaw<
    { category: string; cents: bigint; lines: bigint }[]
  >`
    SELECT
      CASE
        -- SOURCE FIRST. A line whose rule id is a StandingCharge is the
        -- organization's own charge, whatever label it prints under.
        WHEN EXISTS (
          SELECT 1 FROM "StandingCharge" sc
          WHERE sc."id" = dl."recurringDeductionId"
        ) THEN 'standing'
        WHEN dl."type" IN ('Fuel', 'Toll', 'Tolls') THEN 'fuelTolls'
        WHEN dl."type" IN ('Advance', 'Advances') THEN 'advances'
        ELSE 'other'
      END AS category,
      -- FLIPPED TO POSITIVE. Deductions are stored negative; a chart of what
      -- came off the cheques should not be four negative slices.
      COALESCE(SUM(-dl."totalCents"), 0)::bigint AS cents,
      COUNT(*)::bigint AS lines
    FROM "SettlementDeductionLine" dl
    JOIN "Settlement" s ON s."id" = dl."settlementId"
    JOIN "SettlementBatch" b ON b."id" = s."batchId"
    WHERE s."deletedAt" IS NULL
      AND b."deletedAt" IS NULL
      -- PAID BATCHES ONLY, the same population as the paid-per-week bars this
      -- donut sits under. Two charts in one section describing two different
      -- sets of settlements is a screen that disagrees with itself; and a DRAFT
      -- batch is recomputed on every refresh, so its deductions change under
      -- the reader between two readings of the same window.
      AND b."status" = 'PAID'
      -- DEDUCTIONS ONLY, never Other Pay. See the note on the sign.
      AND dl."totalCents" < 0
      ${scopeSql('s', companyIds)}
      AND s."periodStart" >= ${period.from}
      AND s."periodStart" < ${period.to}
    GROUP BY 1
  `

  const found = new Map(
    rows.map((row) => [
      row.category,
      { cents: Number(row.cents), lines: Number(row.lines) },
    ]),
  )

  // EVERY CATEGORY, IN ORDER, INCLUDING THE EMPTY ONES. A donut built from the
  // rows alone would reorder its own legend as the data changed, and a category
  // that disappears on a quiet week reads as one somebody deleted.
  return DEDUCTION_CATEGORIES.map((category) => ({
    category,
    cents: found.get(category)?.cents ?? 0,
    lines: found.get(category)?.lines ?? 0,
  }))
}
