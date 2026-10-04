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

// ---------------------------------------------------------------------------
// THE SUMMARY STRIPS ON INVOICES AND PAYMENTS. §6.2.8.
//
// ── WHY THESE ARE NOT `.length` OVER THE LIST READERS ────────────────────
//
// Both screens already showed counts, and both computed them from the rows the
// list reader had returned — `readInvoices` takes 2000, `listPayments` takes
// 300. A tab reading "Factored 41" was therefore right only while the business
// was small enough not to need the number, and wrong silently after that.
//
// ── THE WINDOW IS THE LIST'S WINDOW, WHICH IS THE WHOLE POINT ────────────
//
// Every figure here ties to the cent to the list its link opens: same window,
// same authority, same predicate. §6.2.8 also records what that costs — an
// invoice older than the window is not in the strip, and the unwindowed answer
// is the aging bar on /accounting/reports. Flag 49.
// ---------------------------------------------------------------------------

/**
 * Issued paper, partitioned. `factored` is NEVER inside `open` (§3.3).
 *
 * ── THREE BALANCES AND ONE FLOW, AND THE DIFFERENCE IS THE DATE BOUND ────
 *
 * Owner's ruling, 2026-10-04 (flag 49). `open`, `overdue` and `factored` are
 * AS OF TODAY over every issued invoice — no window — because a balance is not a
 * period question and windowing one hid the five-month-old unpaid invoice on the
 * screen whose job is to show what is owed.
 *
 * `invoicedCents` IS THE FLOW: what was billed inside the window. It is the
 * figure the picker moves, and it is labelled differently on screen so two true
 * numbers answering different questions cannot be read as one.
 */
export interface InvoiceStrip {
  /** AS OF TODAY. Issued, not factored, balance outstanding. */
  openCents: number
  /** A SUBSET of open, not a fourth category. Said on the strip. AS OF TODAY. */
  overdueCents: number
  factoredCents: number
  /**
   * How many invoices are factored. A COUNT, because the Factored tab read
   * `rows.filter(isFactored).length` over a reader capped at 2000 — right
   * only while the number was small enough not to matter.
   */
  factoredCount: number
  /**
   * THE FLOW: invoice totals for paper ISSUED inside the window, or over every
   * date when there is no window. Null never — an empty window is zero billed.
   */
  invoicedCents: number
  invoicedCount: number
  /**
   * One entry per `InvoiceStatus` in the WINDOW, because the chips describe the
   * LIST and the list is what the picker filters. They will therefore disagree
   * with the balances above them, which is what the two labels are for.
   */
  byStatus: { status: string; count: number }[]
}

export async function invoiceStrip(
  tx: TxClient,
  companyIds: readonly string[],
  /**
   * NULL MEANS EVERY DATE — the `?period=all` state a balance's link carries.
   * It bounds the FLOW figure and the chip counts, and never the balances.
   */
  period: PeriodWindow | null,
  now: Date = new Date(),
): Promise<InvoiceStrip> {
  const scope = scopeSql('i', companyIds)

  // ISSUED MEANS ISSUED: a DRAFT has been shown to nobody and a VOID was
  // withdrawn, so neither is money anybody is owed or owes. WRITTEN_OFF stays
  // out of `open` too — it was billed, and then given up on.
  // ISSUED, AND NOTHING ABOUT WHEN. The balances are as of today.
  const issued = Prisma.sql`
    i."deletedAt" IS NULL
    AND i."issueDate" IS NOT NULL
    AND i."status" NOT IN ('DRAFT', 'VOID')
    ${scope}
  `

  // THE WINDOW, WHERE IT APPLIES: the flow figure and the chip counts. Empty
  // when the caller passed none, which is `?period=all`.
  const inWindow =
    period === null
      ? Prisma.empty
      : Prisma.sql`
          AND i."issueDate" >= ${period.from}
          AND i."issueDate" < ${period.to}
        `

  const rows = await tx.$queryRaw<
    {
      open: bigint
      overdue: bigint
      factored: bigint
      factored_count: bigint
      invoiced: bigint
      invoiced_count: bigint
    }[]
  >`
    SELECT
      COALESCE(SUM(i."balanceCents") FILTER (
        WHERE i."isFactored" = false
          AND i."balanceCents" > 0
          AND i."status" <> 'WRITTEN_OFF'), 0)::bigint AS open,
      -- OVERDUE IS A SUBSET OF OPEN, by the same date arithmetic the aging
      -- buckets use: whole days, by date, so the figure does not depend on the
      -- time of day somebody opened the screen.
      COALESCE(SUM(i."balanceCents") FILTER (
        WHERE i."isFactored" = false
          AND i."balanceCents" > 0
          AND i."status" <> 'WRITTEN_OFF'
          AND i."dueDate" IS NOT NULL
          AND (${now}::date - i."dueDate"::date) > 0), 0)::bigint AS overdue,
      -- SOLD. The whole total, not the balance: what the factor took on is the
      -- invoice, and its balance is being collected by somebody else.
      COALESCE(SUM(i."totalCents") FILTER (
        WHERE i."isFactored" = true), 0)::bigint AS factored,
      COUNT(*) FILTER (WHERE i."isFactored" = true)::bigint AS factored_count,
      -- THE FLOW, in the same statement: what was billed inside the window.
      -- The whole invoice, not the balance — billing is the event.
      COALESCE(SUM(i."totalCents") FILTER (WHERE TRUE ${inWindow}), 0)::bigint
        AS invoiced,
      COUNT(*) FILTER (WHERE TRUE ${inWindow})::bigint AS invoiced_count
    FROM "Invoice" i
    WHERE ${issued}
  `

  const counts = await tx.$queryRaw<{ status: string; count: bigint }[]>`
    SELECT i."status"::text AS status, COUNT(*)::bigint AS count
    FROM "Invoice" i
    WHERE ${issued} ${inWindow}
    GROUP BY 1
    ORDER BY 1
  `

  const row = rows[0]
  if (!row) throw new Error('invoiceStrip: no row from a single-row SELECT.')

  return {
    openCents: Number(row.open),
    overdueCents: Number(row.overdue),
    factoredCents: Number(row.factored),
    factoredCount: Number(row.factored_count),
    invoicedCents: Number(row.invoiced),
    invoicedCount: Number(row.invoiced_count),
    byStatus: counts.map((entry) => ({
      status: entry.status,
      count: Number(entry.count),
    })),
  }
}

export interface PaymentStrip {
  /**
   * AS OF TODAY, over every payment: money received that is not against an
   * invoice yet. Owner's ruling 2026-10-04 — a balance carries no window.
   */
  unappliedCents: number
  /** How many payments carry it — "$14,200 across 3 payments". */
  unappliedCount: number
  /** THE FLOW: what arrived inside the window, or over every date. */
  receivedCents: number
  receivedCount: number
  /**
   * Every payment in the WINDOW, and how many are fully applied — the chip
   * counts, which describe the list rather than the balance above it.
   */
  totalCount: number
  appliedCount: number
}

export async function paymentStrip(
  tx: TxClient,
  companyIds: readonly string[],
  /** NULL MEANS EVERY DATE — `?period=all`. Bounds the flow, not the balance. */
  period: PeriodWindow | null,
): Promise<PaymentStrip> {
  const inWindow =
    period === null
      ? Prisma.empty
      : Prisma.sql`
          AND p."receivedAt" >= ${period.from}
          AND p."receivedAt" < ${period.to}
        `

  const rows = await tx.$queryRaw<
    {
      unapplied: bigint
      unapplied_count: bigint
      received: bigint
      received_count: bigint
      total_count: bigint
      applied_count: bigint
    }[]
  >`
    SELECT
      -- THE BALANCE: every unapplied dollar, whenever it arrived.
      COALESCE(SUM(p."unappliedCents"), 0)::bigint AS unapplied,
      COUNT(*) FILTER (WHERE p."unappliedCents" > 0)::bigint AS unapplied_count,
      -- THE FLOW, and the two chip counts, which are windowed.
      COALESCE(SUM(p."amountCents") FILTER (WHERE TRUE ${inWindow}), 0)::bigint
        AS received,
      COUNT(*) FILTER (WHERE TRUE ${inWindow})::bigint AS received_count,
      COUNT(*) FILTER (WHERE TRUE ${inWindow})::bigint AS total_count,
      COUNT(*) FILTER (
        WHERE p."unappliedCents" = 0 ${inWindow})::bigint AS applied_count
    FROM "Payment" p
    WHERE p."deletedAt" IS NULL
      ${scopeSql('p', companyIds)}
  `

  const row = rows[0]
  if (!row) throw new Error('paymentStrip: no row from a single-row SELECT.')

  return {
    unappliedCents: Number(row.unapplied),
    unappliedCount: Number(row.unapplied_count),
    receivedCents: Number(row.received),
    receivedCount: Number(row.received_count),
    totalCount: Number(row.total_count),
    appliedCount: Number(row.applied_count),
  }
}

// ---------------------------------------------------------------------------
// PAYROLL: THE PIPELINE STRIP AND THE PER-DRIVER SERIES. §6.2.9.
// ---------------------------------------------------------------------------

/**
 * Pay in flight, by the state of its run. AS OF TODAY — no window.
 *
 * §6.2.9: "how much is sitting in draft" is not a question about a period, and
 * §6.2.8's ruling is that a balance carries no date bound.
 *
 * A PIPELINE, NOT A PARTITION. Draft can still change, FINAL IS APPROVED AND
 * UNPAID — money the carrier owes this week — and paid has left the account.
 * Merging any two of them would hide the only one with a deadline.
 */
export interface PipelineStrip {
  draftCents: number
  draftCount: number
  finalCents: number
  finalCount: number
  paidCents: number
  paidCount: number
}

export async function pipelineStrip(
  tx: TxClient,
  companyIds: readonly string[],
): Promise<PipelineStrip> {
  // SUMMED FROM THE SETTLEMENTS, grouped by the BATCH's status, because the
  // batch is what moves through the three states — a settlement's own status
  // does not carry "paid" (§6.2.7's note on the same join).
  //
  // SCOPED ON THE SETTLEMENT, which is where `companyId` lives: a batch is
  // org-wide and carries none.
  const rows = await tx.$queryRaw<
    { status: string; cents: bigint; count: bigint }[]
  >`
    SELECT b."status"::text AS status,
           COALESCE(SUM(s."netCents"), 0)::bigint AS cents,
           COUNT(DISTINCT b."id")::bigint AS count
    FROM "SettlementBatch" b
    JOIN "Settlement" s ON s."batchId" = b."id" AND s."deletedAt" IS NULL
    WHERE b."deletedAt" IS NULL
      ${scopeSql('s', companyIds)}
    GROUP BY 1
  `

  const of = (status: string) => rows.find((row) => row.status === status)
  return {
    draftCents: Number(of('DRAFT')?.cents ?? 0),
    draftCount: Number(of('DRAFT')?.count ?? 0),
    finalCents: Number(of('FINAL')?.cents ?? 0),
    finalCount: Number(of('FINAL')?.count ?? 0),
    paidCents: Number(of('PAID')?.cents ?? 0),
    paidCount: Number(of('PAID')?.count ?? 0),
  }
}

/**
 * Net pay per driver per settlement week, for the sparkline on each row.
 *
 * ── THIRTEEN WEEKS, WHATEVER THE PICKER SAYS ─────────────────────────────
 *
 * §6.2.9, and the only deliberate exception in the product to "the chips and the
 * period govern everything below them": a sparkline over four points says
 * nothing. The row's FIGURES are the window's; the shape beside them is the
 * driver's own history.
 *
 * ── A MISSING WEEK IS ABSENT, NOT ZERO ───────────────────────────────────
 *
 * Returned sparse, one entry per week that HAS a settlement, because unpaid and
 * not-yet-settled are different facts and a zero would assert the first. The
 * caller maps the weeks it wants onto this and leaves gaps where there is
 * nothing — the same rule `Sparkline` already follows for a null point.
 *
 * ONE STATEMENT FOR EVERY DRIVER ON SCREEN. A query per row would be fifty round
 * trips on a list of fifty.
 */
export async function netPayByDriverWeek(
  tx: TxClient,
  driverIds: readonly string[],
  from: Date,
): Promise<Map<string, { weekStart: Date; netCents: number }[]>> {
  // NO DRIVERS, NO QUERY. `= ANY('{}')` matches nothing, so this would be a
  // round trip to learn what the caller already knew.
  if (driverIds.length === 0) return new Map()

  const rows = await tx.$queryRaw<
    { driver_id: string; week_start: Date; net: bigint }[]
  >`
    SELECT s."driverId" AS driver_id,
           ${bucketExprSql(Prisma.sql`s."periodStart"`, 'week')} AS week_start,
           COALESCE(SUM(s."netCents"), 0)::bigint AS net
    FROM "Settlement" s
    JOIN "SettlementBatch" b ON b."id" = s."batchId"
    WHERE s."deletedAt" IS NULL
      AND b."deletedAt" IS NULL
      -- FINAL AND PAID ONLY, the same rule driverTotals applies: a DRAFT is
      -- recomputed on every refresh, so a shape drawn from one changes under the
      -- reader between two readings of the same screen.
      AND b."status" IN ('FINAL', 'PAID')
      AND s."driverId" = ANY(${[...driverIds]})
      AND s."periodStart" >= ${from}
    GROUP BY 1, 2
    ORDER BY 2
  `

  const out = new Map<string, { weekStart: Date; netCents: number }[]>()
  for (const row of rows) {
    const mine = out.get(row.driver_id) ?? []
    mine.push({ weekStart: row.week_start, netCents: Number(row.net) })
    out.set(row.driver_id, mine)
  }
  return out
}
