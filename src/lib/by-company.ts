import { Prisma } from '@/generated/prisma/client'
import { bucketExprSql } from './week-sql'

/** Plain transaction client, as the other reporting modules declare it. */
type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// WHAT DID EACH COMPANY MAKE. Settle together, report apart.
//
// Item 7. Settlement is org-wide by ruling — one batch, one statement per
// driver, whoever's freight they pulled — and this is the other half of that
// sentence: the money still belongs to an authority, and somebody has to be
// able to see which.
//
// ── TWO NUMBERS, AND ONLY TWO ────────────────────────────────────────────
//
// GROSS is what the freight billed. AFTER DRIVER PAY is that minus what the
// drivers were paid for it. Nothing else is subtracted — not fuel, not tolls,
// not insurance, not escrow — which is why the column is labelled exactly
// "after driver pay" and not "profit" or "net". A column called profit that
// ignores fuel is a number somebody will quote at a bank.
//
// ── WHY THE RULES ARE IN SQL, SAID PLAINLY ───────────────────────────────
//
// The ruling is one query per number, grouped in SQL, inside five seconds on
// 14,464 loads. That means the gross rule is expressed HERE as well as in
// `grossFor` — a second expression of a money rule, which is precisely what
// flag 88 is about.
//
// It is done anyway, because the alternative is reading 14,464 rows into a
// worker and summing them there, and the money screen has already been down
// that road. The mitigation is that the agreement is TESTED rather than
// assumed: `by-company.test.ts` runs seeded loads through both this SQL and
// the engine's own definition and requires the same cents.
//
// ── A LOAD LANDS IN THE PERIOD OF ITS DELIVERY DATE ──────────────────────
//
// Not booked, not invoiced, not paid. The last DELIVERY stop's scheduled
// date, which is the same date the settlement engine pays it in, so a load
// cannot appear in one period here and another one there.
// ---------------------------------------------------------------------------

export type Grouping = 'week' | 'month'

export interface CompanyPeriodRow {
  /** UTC midnight: the Sunday of the week, or the 1st of the month. */
  periodStart: Date
  companyId: string
  companyName: string
  grossCents: number
  /**
   * How much of the gross above is a BROKER LOAD'S OWN RATE because nothing
   * has been invoiced yet.
   *
   * MARKED, as the ruling requires. It is a real figure — the load billed
   * that much — but it is what we intend to charge rather than what anybody
   * has been asked for, and a reader comparing two authorities deserves to
   * know which of them is quoting itself.
   */
  atRateCents: number
}

export interface DriverPayRow {
  periodStart: Date
  companyId: string
  driverPayCents: number
}

/**
 * The gross each authority billed, per period.
 *
 * ── THE FOUR CASES, IN THE ORDER THEY ARE ASKED ──────────────────────────
 *
 * 1. CLOSED HISTORY — the load gross Datatruck carried. It is INCLUDED here,
 *    deliberately and unlike everywhere else in this system: closed history is
 *    revenue, and this page is where money from before the cutover has to show
 *    up. Every other definition excludes it because it must never be settled
 *    or invoiced AGAIN; none of that applies to reading what it earned.
 *
 * 2. DIRECT-SETTLED AND CONFIRMED — the settled gross a person confirmed.
 *
 * 3. DIRECT-SETTLED, NOT CONFIRMED — what the remittance actually paid.
 *    `grossFor` refuses to settle a load in this state without a person
 *    looking; reporting it is a different question from paying on it, and the
 *    figure is the best evidence of what the freight earned.
 *
 * 4. BROKER — the invoice, and the load's own rate when nothing has been
 *    invoiced yet, counted into `atRateCents` so the page can say so.
 *
 * Deleted and cancelled loads are excluded throughout. A cancelled load
 * billed nobody.
 */
export async function grossByCompany(
  tx: TxClient,
  input: { grouping: Grouping; from: Date; to: Date },
): Promise<CompanyPeriodRow[]> {
  const unit = input.grouping === 'week' ? 'week' : 'month'

  // `date_trunc('week')` IS MONDAY IN POSTGRES and the settlement week is a
  // Sunday, so the week case shifts a day in and back out again. The month
  // case needs no such thing, which is why the two are not one expression
  // with a variable in it.
  const period =
    unit === 'week'
      ? bucketExprSql(Prisma.sql`d.del_date`, 'week')
      : Prisma.sql`date_trunc('month', d.del_date)`

  const rows = await tx.$queryRaw<
    {
      period_start: Date
      company_id: string
      company_name: string
      gross: bigint
      at_rate: bigint
    }[]
  >`
    WITH delivered AS (
      SELECT
        l."id",
        l."companyId",
        l."billingStatus",
        l."directSettled",
        l."settledGrossCents",
        l."settledGrossConfirmedAt",
        l."totalRevenueCents",
        s."scheduledAt" AS del_date
      FROM "Load" l
      -- THE LAST DELIVERY STOP, which is the date the engine pays it in.
      CROSS JOIN LATERAL (
        SELECT st."scheduledAt"
        FROM "LoadStop" st
        WHERE st."loadId" = l."id" AND st."type" = 'DELIVERY'
        ORDER BY st."sequence" DESC
        LIMIT 1
      ) s
      WHERE l."deletedAt" IS NULL
        AND l."isCancelled" = false
        AND s."scheduledAt" >= ${input.from}
        AND s."scheduledAt" < ${input.to}
    ),
    priced AS (
      SELECT
        d."companyId",
        ${period} AS period_start,
        CASE
          WHEN d."billingStatus" = 'CLOSED_IN_DATATRUCK' THEN d."totalRevenueCents"
          WHEN d."directSettled" AND d."settledGrossConfirmedAt" IS NOT NULL
            THEN COALESCE(d."settledGrossCents", 0)
          WHEN d."directSettled"
            THEN COALESCE((
              SELECT SUM(pla."amountCents")::int
              FROM "PaymentLoadApplication" pla
              WHERE pla."loadId" = d."id"
            ), 0)
          ELSE COALESCE(inv.amount, d."totalRevenueCents")
        END AS gross,
        CASE
          WHEN d."billingStatus" = 'CLOSED_IN_DATATRUCK' THEN 0
          WHEN d."directSettled" THEN 0
          WHEN inv.amount IS NULL THEN d."totalRevenueCents"
          ELSE 0
        END AS at_rate
      FROM delivered d
      LEFT JOIN LATERAL (
        -- A VOID INVOICE BILLED NOBODY. Without this a voided invoice would
        -- read as "invoiced, for nothing" and silently zero the load.
        SELECT SUM(il."amountCents")::int AS amount
        FROM "InvoiceLine" il
        JOIN "Invoice" i ON i."id" = il."invoiceId"
        WHERE il."loadId" = d."id" AND i."status" <> 'VOID'
      ) inv ON TRUE
    )
    SELECT
      p.period_start,
      p."companyId" AS company_id,
      c."name" AS company_name,
      SUM(p.gross)::bigint AS gross,
      SUM(p.at_rate)::bigint AS at_rate
    FROM priced p
    JOIN "Company" c ON c."id" = p."companyId"
    GROUP BY p.period_start, p."companyId", c."name"
    ORDER BY p.period_start, c."name"
  `

  return rows.map((row) => ({
    periodStart: row.period_start,
    companyId: row.company_id,
    companyName: row.company_name,
    grossCents: Number(row.gross),
    atRateCents: Number(row.at_rate),
  }))
}

/**
 * What the drivers were paid for each authority's freight, per period.
 *
 * ── EVERY LINE, WHICH IS BOTH HALVES OF A TEAM ───────────────────────────
 *
 * A team load carries two settlement load lines, one per crew member, each at
 * that driver's own percentage. Both are summed here — the company paid both
 * of them — and the LOAD is still one load, counted once in the gross above.
 * That is the whole reason the two numbers are read by two queries rather
 * than one join: a join would multiply the gross by the crew.
 *
 * ── BY THE LOAD'S AUTHORITY, NOT THE LINE'S ──────────────────────────────
 *
 * The line freezes a company too, and they agree — but the question asked is
 * "what did this company's freight cost in driver pay", and the freight's
 * authority is the load's.
 *
 * ── FINAL AND PAID ONLY ──────────────────────────────────────────────────
 *
 * A DRAFT batch is a proposal. Counting it would let a number on this page
 * move because somebody opened a draft and then closed it again.
 */
export async function driverPayByCompany(
  tx: TxClient,
  input: { grouping: Grouping; from: Date; to: Date },
): Promise<DriverPayRow[]> {
  const unit = input.grouping === 'week' ? 'week' : 'month'
  const period =
    unit === 'week'
      ? bucketExprSql(Prisma.sql`d.del_date`, 'week')
      : Prisma.sql`date_trunc('month', d.del_date)`

  const rows = await tx.$queryRaw<
    { period_start: Date; company_id: string; pay: bigint }[]
  >`
    WITH delivered AS (
      SELECT
        l."id",
        l."companyId",
        s."scheduledAt" AS del_date
      FROM "Load" l
      CROSS JOIN LATERAL (
        SELECT st."scheduledAt"
        FROM "LoadStop" st
        WHERE st."loadId" = l."id" AND st."type" = 'DELIVERY'
        ORDER BY st."sequence" DESC
        LIMIT 1
      ) s
      WHERE l."deletedAt" IS NULL
        AND l."isCancelled" = false
        AND s."scheduledAt" >= ${input.from}
        AND s."scheduledAt" < ${input.to}
    )
    SELECT
      ${period} AS period_start,
      d."companyId" AS company_id,
      SUM(line."amountCents")::bigint AS pay
    FROM delivered d
    JOIN "SettlementLoadLine" line ON line."loadId" = d."id"
    JOIN "Settlement" st ON st."id" = line."settlementId"
    JOIN "SettlementBatch" b ON b."id" = st."batchId"
    WHERE b."status" IN ('FINAL', 'PAID')
    GROUP BY ${period}, d."companyId"
    ORDER BY 1, 2
  `

  return rows.map((row) => ({
    periodStart: row.period_start,
    companyId: row.company_id,
    driverPayCents: Number(row.pay),
  }))
}

/**
 * The period the first FINAL batch covers, or null when there has never been
 * one.
 *
 * ── WHY THIS IS A SEPARATE QUESTION ──────────────────────────────────────
 *
 * Before Zebra settled anything, driver pay for a period is not zero — it is
 * UNKNOWN. Datatruck paid those drivers and this system never saw it. A zero
 * would read as "this freight cost nothing to drive", which is the most
 * expensive wrong number this page could print.
 *
 * So the page shows "—" for every period before this date, with the sentence
 * saying where the data starts. `null` means no FINAL batch exists at all and
 * every period gets the dash.
 */
export async function firstSettledPeriodStart(
  tx: TxClient,
): Promise<Date | null> {
  const batch = await tx.settlementBatch.findFirst({
    where: { status: { in: ['FINAL', 'PAID'] } },
    orderBy: { periodStart: 'asc' },
    select: { periodStart: true },
  })
  return batch?.periodStart ?? null
}

export interface ReportCell {
  companyId: string
  companyName: string
  grossCents: number
  atRateCents: number
  /**
   * Gross minus every settlement load line for this company's freight in this
   * period — or NULL, meaning "not known here".
   *
   * NULL IS NOT ZERO AND THE DIFFERENCE IS THE POINT. Before Zebra's first
   * FINAL batch, Datatruck paid those drivers and this system never saw it. A
   * zero would read as "this freight cost nothing to drive", which is the most
   * expensive wrong number this page could print.
   */
  afterDriverPayCents: number | null
  /**
   * What the drivers were paid for this company's freight in this period, or
   * NULL on the same rule as `afterDriverPayCents` above.
   *
   * CARRIED RATHER THAN DERIVED. §6.2.7's chart draws gross, pay and after-pay
   * as three bars, and the only other way to get pay out of this cell is
   * `gross - afterDriverPay` at the call site — algebra that is exact today
   * and silently wrong the moment anything else is ever subtracted from the
   * after-pay figure. The assembler has the number; it hands it over.
   */
  driverPayCents: number | null
}

export interface ReportPeriod {
  periodStart: Date
  companies: ReportCell[]
  /** The "All companies" row: every authority in this period, summed. */
  all: ReportCell
}

export interface Report {
  periods: ReportPeriod[]
  /** Null when Zebra has never settled anything; the page says so once. */
  firstSettledPeriodStart: Date | null
}

/**
 * Put the two queries together.
 *
 * ── THE GROUPING IS ALREADY DONE ─────────────────────────────────────────
 *
 * Both inputs arrive grouped by (period, company) from SQL. This walks them
 * once to pair them up and total them; it does not group, sum over loads, or
 * filter. `by-company.test.ts` breaks on a version that groups here, because
 * summing 14,464 rows in a worker is the road the money screen already went
 * down once.
 */
export function assembleReport(input: {
  gross: readonly CompanyPeriodRow[]
  pay: readonly DriverPayRow[]
  firstSettledPeriodStart: Date | null
}): Report {
  const payOf = new Map(
    input.pay.map((row) => [
      `${row.periodStart.getTime()}:${row.companyId}`,
      row.driverPayCents,
    ]),
  )

  const byPeriod = new Map<number, CompanyPeriodRow[]>()
  for (const row of input.gross) {
    const key = row.periodStart.getTime()
    byPeriod.set(key, [...(byPeriod.get(key) ?? []), row])
  }

  const settledFrom = input.firstSettledPeriodStart?.getTime() ?? null

  const periods = [...byPeriod.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, rows]): ReportPeriod => {
      // KNOWN ONLY FROM THE FIRST FINAL BATCH ONWARDS. Not "known when a row
      // happens to exist" — a period after the cutover with no lines really
      // did cost nothing in Zebra-settled pay, and that zero is a fact.
      const known = settledFrom !== null && time >= settledFrom

      const companies = rows
        .map((row): ReportCell => {
          const pay = payOf.get(`${time}:${row.companyId}`) ?? 0
          return {
            companyId: row.companyId,
            companyName: row.companyName,
            grossCents: row.grossCents,
            atRateCents: row.atRateCents,
            afterDriverPayCents: known ? row.grossCents - pay : null,
            driverPayCents: known ? pay : null,
          }
        })
        .sort((a, b) => a.companyName.localeCompare(b.companyName))

      const sum = (pick: (cell: ReportCell) => number) =>
        companies.reduce((n, cell) => n + pick(cell), 0)

      return {
        periodStart: new Date(time),
        companies,
        all: {
          companyId: 'all',
          companyName: 'All companies',
          grossCents: sum((cell) => cell.grossCents),
          atRateCents: sum((cell) => cell.atRateCents),
          // THE DASH SURVIVES THE TOTAL. A row that sums a column of unknowns
          // into a number would invent the very figure the dash refuses to.
          afterDriverPayCents: known
            ? sum((cell) => cell.afterDriverPayCents ?? 0)
            : null,
          driverPayCents: known
            ? sum((cell) => cell.driverPayCents ?? 0)
            : null,
        },
      }
    })

  return { periods, firstSettledPeriodStart: input.firstSettledPeriodStart }
}

// ---------------------------------------------------------------------------
// THE THIRD CUT: BY DRIVER.
//
// §6.2's Reports page offers the same money by company, by week or by driver.
// The first two come out of `assembleReport` above; this is the third, and it is
// a different shape rather than a transpose — a driver's row is what they were
// PAID, not what an authority billed, and the two are never the same number.
//
// ── SETTLED WEEKS ONLY, AND IT SAYS SO ────────────────────────────────────
//
// `FINAL` and `PAID` batches, exactly like `driverPayByCompany`. A DRAFT is
// recomputed on every refresh and its figures change under the reader; putting
// them in a report would make the report disagree with itself between two
// readings, which is worse than a report that is missing this week.
//
// GROUPED IN SQL, NOT IN THE WORKER. Same rule as the rest of this file: the
// money screen already went down the road of summing rows in TypeScript and came
// back at 4,427ms. `by-company.test.ts` breaks on a version that groups here.
// ---------------------------------------------------------------------------

export interface DriverTotalRow {
  driverId: string
  driverName: string
  /** How many settlements in the window — the weeks they were paid for. */
  weeks: number
  grossCents: number
  deductionsCents: number
  otherPayCents: number
  netCents: number
}

export async function driverTotals(
  tx: TxClient,
  input: { from: Date; to: Date },
): Promise<DriverTotalRow[]> {
  const rows = await tx.$queryRaw<
    {
      driver_id: string
      first_name: string
      last_name: string
      weeks: bigint
      gross: bigint
      deductions: bigint
      other_pay: bigint
      net: bigint
    }[]
  >`
    SELECT
      d."id"                          AS driver_id,
      d."firstName"                   AS first_name,
      d."lastName"                    AS last_name,
      COUNT(*)::bigint                AS weeks,
      SUM(st."earningsCents")::bigint AS gross,
      SUM(st."deductionsCents")::bigint AS deductions,
      SUM(st."otherPayCents")::bigint AS other_pay,
      SUM(st."netCents")::bigint      AS net
    FROM "Settlement" st
    JOIN "SettlementBatch" b ON b."id" = st."batchId"
    JOIN "Driver" d ON d."id" = st."driverId"
    WHERE b."status" IN ('FINAL', 'PAID')
      AND b."deletedAt" IS NULL
      AND d."deletedAt" IS NULL
      AND b."periodStart" >= ${input.from}
      AND b."periodStart" < ${input.to}
    GROUP BY d."id", d."firstName", d."lastName"
    ORDER BY d."lastName", d."firstName"
  `

  return rows.map((row) => ({
    driverId: row.driver_id,
    driverName: `${row.first_name} ${row.last_name}`,
    weeks: Number(row.weeks),
    grossCents: Number(row.gross),
    deductionsCents: Number(row.deductions),
    otherPayCents: Number(row.other_pay),
    netCents: Number(row.net),
  }))
}
