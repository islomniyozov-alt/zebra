import { Prisma } from '@/generated/prisma/client'
import { firstSettledPeriodStart } from './by-company'

/** Plain transaction client, as the other reporting modules declare it. */
type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// THE DASHBOARD'S NUMBERS. THREE QUERIES FOR FIVE PANELS.
//
// Dashboard redesign part 1. `dashboard.ts` beside this is the ACTION QUEUE —
// what needs doing, one count per row — and stays as it is. This file is the
// money: KPIs, thirteen weeks of history, revenue by authority, revenue by
// customer, loads per day.
//
// ── THE GROSS RULE IS ITEM 7'S, NOT A SECOND ONE ─────────────────────────
//
// `by-company.ts` expresses it in SQL and says why it is willing to: the
// alternative is reading 14,000 rows into a worker. The same reasoning applies
// here and the same hazard with it — flag 88, a money rule written twice — so
// THE CASE EXPRESSION IS COPIED VERBATIM and `dashboard-kpis.test.ts` requires
// this file and `grossByCompany` to return the same cents over the same seeded
// loads. A copy that is tested against its original is a cache; a copy that is
// not is a second opinion.
//
//   CLOSED HISTORY COUNTS AT ITS OWN RATE. 13,517 loads on dev ran, were
//   billed and were paid in Datatruck. They are excluded from every QUEUE —
//   nobody can action them — and included in every TOTAL, because the carrier
//   earned that money.
//
//   DIRECT-SETTLED COUNTS WHAT AMAZON CONFIRMED, or what it has actually paid
//   when it has not confirmed. Never the booked rate, which is a hope.
//
//   A VOID INVOICE BILLED NOBODY, so it falls back to the rate rather than
//   reading as "invoiced, for nothing".
//
// ── A LOAD LANDS IN THE PERIOD OF ITS LAST DELIVERY STOP ─────────────────
//
// The same date the settlement engine pays it in, so a load cannot appear in
// one period here and another there. Not booked, not invoiced, not paid.
//
// ── DRIVER PAY IS BOTH CREW LINES; THE LOAD COUNTS ONCE ──────────────────
//
// A team load writes one `SettlementLoadLine` per driver, so joining the lines
// sums both halves — which is right, it cost that much to drive. The LOAD is
// counted in `delivered`, before that join, so it is one load however many
// people were paid for it. Getting this backwards inflates the load count by
// the number of team runs and is invisible in any total.
//
// ── WHY THREE QUERIES AND NOT SIX ────────────────────────────────────────
//
// Q1 groups by (week, company) and three panels are folded out of it in
// TypeScript: the weekly series sums across companies, the by-company panel
// sums across weeks, the KPI strip sums everything. One scan, three answers.
// Q2 is by customer and Q3 is loads per day; neither can come off Q1's
// grouping without multiplying rows.
//
// THE ASSEMBLY IS PURE AND SEPARATELY TESTED. `assembleDashboard` takes rows
// and returns the panels — no clock, no database — because the derivations
// (margin, cents per mile, the thirteen weeks including the empty ones) are
// where an off-by-one hides, and a server component has a screen rather than a
// guard.
// ---------------------------------------------------------------------------

/**
 * The gross rule, item 7's, as one SQL fragment used by every query here.
 *
 * ONE FRAGMENT RATHER THAN THREE COPIES in this file, so the three queries
 * cannot disagree with each other even if they drift from `by-company.ts`.
 * The test pins the agreement with `by-company.ts`.
 */
const GROSS_CENTS = Prisma.sql`
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
  END
`

/**
 * Delivered loads in the window, with the fields the gross rule needs.
 *
 * `companyId` IS FILTERED HERE AND NOT IN THE OUTER QUERY, so the company chip
 * narrows the scan rather than the result. On 14,000 loads that is the
 * difference between a filter and a report.
 */
const deliveredIn = (
  from: Date,
  to: Date,
  companyId: string | null,
) => Prisma.sql`
  SELECT
    l."id",
    l."companyId",
    l."customerId",
    l."billingStatus",
    l."directSettled",
    l."settledGrossCents",
    l."settledGrossConfirmedAt",
    l."totalRevenueCents",
    -- ACTUAL MILES WHERE THEY EXIST, dispatched where they do not. The same
    -- precedence the settlement engine uses, and zero rather than NULL so a
    -- load with neither does not poison a SUM.
    --
    -- NO BACKTICKS IN THESE COMMENTS. This is inside a tagged template, so a
    -- backtick CLOSES IT — the first version of this line quoted a zero and
    -- esbuild reported "Expected ; but found 0" from the middle of the SQL.
    COALESCE(l."actualMiles", l."dispatchedMiles", 0) AS miles,
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
    AND s."scheduledAt" >= ${from}
    AND s."scheduledAt" < ${to}
    ${companyId === null ? Prisma.empty : Prisma.sql`AND l."companyId" = ${companyId}`}
`

/** The invoice total for a load, VOID excluded. Item 7's lateral, verbatim. */
const INVOICED = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT SUM(il."amountCents")::int AS amount
    FROM "InvoiceLine" il
    JOIN "Invoice" i ON i."id" = il."invoiceId"
    WHERE il."loadId" = d."id" AND i."status" <> 'VOID'
  ) inv ON TRUE
`

/**
 * `date_trunc('week')` IS MONDAY IN POSTGRES and the settlement week is a
 * Sunday, so this shifts a day in and back out. Lifted from `by-company.ts`
 * rather than rewritten, because two expressions of "which week" is two
 * answers.
 */
/**
 * Which bucket a delivery falls in, for the grain on screen.
 *
 * OWNER RULING 2026-10-02: the period picker drives the granularity — a week
 * shows seven days, a quarter shows weeks. Two expressions rather than one with
 * a variable in it, because the WEEK case has to shift a day in and back out:
 * `date_trunc('week')` is MONDAY in Postgres and a settlement week opens on a
 * SUNDAY (MONEY-DESIGN §0). The day case needs no such thing, and hiding that
 * difference behind an argument is how the Sunday boundary gets lost.
 */
export type Grain = 'day' | 'week'

const bucketOf = (grain: Grain) =>
  grain === 'week'
    ? Prisma.sql`(date_trunc('week', d.del_date + interval '1 day') - interval '1 day')`
    : Prisma.sql`date_trunc('day', d.del_date)`

export interface WeekCompanyRow {
  weekStart: Date
  companyId: string
  companyName: string
  grossCents: number
  driverPayCents: number
  loads: number
  miles: number
}

export interface CustomerRow {
  customerId: string
  customerName: string
  grossCents: number
  loads: number
}

export interface DayRow {
  day: Date
  loads: number
}

/**
 * Q1 — gross, driver pay, loads and miles per (week, company).
 *
 * THE DRIVER-PAY JOIN IS A LATERAL SUBQUERY, not a join in the main FROM. A
 * plain join to `SettlementLoadLine` multiplies the load row by the number of
 * crew lines, and then `COUNT(*)` counts a team load twice and `SUM(miles)`
 * doubles its miles. Summing inside the lateral keeps one row per load, which
 * is what makes `loads` and `miles` trustworthy beside `driverPayCents`.
 *
 * FINAL AND PAID ONLY. A draft batch is recomputed on every refresh, so
 * counting it would make this week's figure move when somebody opens a screen.
 */
export async function weekCompanyRows(
  tx: TxClient,
  input: {
    from: Date
    to: Date
    companyId: string | null
    /** Daily or weekly buckets. Owner ruling: the picker decides. */
    grain: Grain
  },
): Promise<WeekCompanyRow[]> {
  const bucket = bucketOf(input.grain)
  const rows = await tx.$queryRaw<
    {
      week_start: Date
      company_id: string
      company_name: string
      gross: bigint
      pay: bigint
      loads: bigint
      miles: bigint
    }[]
  >`
    WITH delivered AS (${deliveredIn(input.from, input.to, input.companyId)}),
    priced AS (
      SELECT
        d."companyId",
        ${bucket} AS week_start,
        ${GROSS_CENTS} AS gross,
        COALESCE(pay.amount, 0) AS pay,
        d.miles AS miles
      FROM delivered d
      ${INVOICED}
      LEFT JOIN LATERAL (
        SELECT SUM(line."amountCents")::int AS amount
        FROM "SettlementLoadLine" line
        JOIN "Settlement" st ON st."id" = line."settlementId"
        JOIN "SettlementBatch" b ON b."id" = st."batchId"
        WHERE line."loadId" = d."id" AND b."status" IN ('FINAL', 'PAID')
      ) pay ON TRUE
    )
    SELECT
      p.week_start,
      p."companyId" AS company_id,
      c."name" AS company_name,
      SUM(p.gross)::bigint AS gross,
      SUM(p.pay)::bigint AS pay,
      COUNT(*)::bigint AS loads,
      SUM(p.miles)::bigint AS miles
    FROM priced p
    JOIN "Company" c ON c."id" = p."companyId"
    GROUP BY p.week_start, p."companyId", c."name"
    ORDER BY p.week_start, c."name"
  `

  return rows.map((row) => ({
    weekStart: row.week_start,
    companyId: row.company_id,
    companyName: row.company_name,
    grossCents: Number(row.gross),
    driverPayCents: Number(row.pay),
    loads: Number(row.loads),
    miles: Number(row.miles),
  }))
}

/** Q2 — gross per customer over the whole window. */
export async function customerRows(
  tx: TxClient,
  input: { from: Date; to: Date; companyId: string | null },
): Promise<CustomerRow[]> {
  const rows = await tx.$queryRaw<
    {
      customer_id: string | null
      customer_name: string | null
      gross: bigint
      loads: bigint
    }[]
  >`
    WITH delivered AS (${deliveredIn(input.from, input.to, input.companyId)}),
    priced AS (
      SELECT d."customerId", ${GROSS_CENTS} AS gross
      FROM delivered d
      ${INVOICED}
    )
    SELECT
      p."customerId" AS customer_id,
      cu."name" AS customer_name,
      SUM(p.gross)::bigint AS gross,
      COUNT(*)::bigint AS loads
    FROM priced p
    -- LEFT, because Load.customerId is nullable and a load with no customer
    -- still earned money. An inner join would drop it from the total and the
    -- panel would not add up to the KPI beside it.
    LEFT JOIN "Customer" cu ON cu."id" = p."customerId"
    GROUP BY p."customerId", cu."name"
    ORDER BY SUM(p.gross) DESC
  `

  return rows.map((row) => ({
    customerId: row.customer_id ?? '',
    customerName: row.customer_name ?? '',
    grossCents: Number(row.gross),
    loads: Number(row.loads),
  }))
}

/** Q3 — how many loads delivered each day. No money, so no gross rule. */
export async function dayRows(
  tx: TxClient,
  input: { from: Date; to: Date; companyId: string | null },
): Promise<DayRow[]> {
  const rows = await tx.$queryRaw<{ day: Date; loads: bigint }[]>`
    WITH delivered AS (${deliveredIn(input.from, input.to, input.companyId)})
    SELECT date_trunc('day', d.del_date) AS day, COUNT(*)::bigint AS loads
    FROM delivered d
    GROUP BY 1
    ORDER BY 1
  `
  return rows.map((row) => ({ day: row.day, loads: Number(row.loads) }))
}

// ---------------------------------------------------------------------------
// THE PURE HALF. No clock, no database.
// ---------------------------------------------------------------------------

export interface DashboardKpis {
  grossCents: number
  /**
   * What Zebra paid drivers for this freight, or NULL meaning NOT KNOWN HERE.
   *
   * ── WHY THIS IS NULLABLE, MEASURED ───────────────────────────────────────
   *
   * Dev, Jul–Sep 2026: gross $2,755,782.16 and driver pay $184,774.65, because
   * 13,517 of those loads are closed history. DATATRUCK PAID THOSE DRIVERS AND
   * THIS SYSTEM NEVER SAW IT. The gross is real — the carrier earned it, which
   * is item 7's rule — and the pay is not zero, it is unknown.
   *
   * `by-company.ts` already says this about its own column and says it hardest:
   * "a zero would read as 'this freight cost nothing to drive', which is the
   * most expensive wrong number this page could print". The first version of
   * this interface typed both of these `number` and would have printed
   * $2,571,007.51 as the owner's headline margin. It is null before the first
   * FINAL batch instead, and the screen renders an em dash (§8).
   */
  driverPayCents: number | null
  /**
   * Gross minus driver pay. NOT "profit" and NOT "net", and NULL wherever the
   * pay is.
   *
   * `by-company.ts` labels its own column "after driver pay" and says why:
   * nothing else is subtracted — not fuel, not tolls, not insurance, not
   * escrow — and a column called profit that ignores fuel is a number somebody
   * will quote at a bank. The field carries the brief's name; THE SCREEN MUST
   * STILL SAY "after driver pay".
   */
  marginCents: number | null
  loads: number
  miles: number
  /**
   * Gross per mile, in cents. NULL when there are no miles, never zero.
   *
   * Zero reads as "this freight earned nothing per mile", which is a claim
   * about the rate. No miles recorded is a claim about the data, and §8 renders
   * that as an em dash.
   */
  centsPerMile: number | null
}

export interface WeekPoint {
  weekStart: Date
  grossCents: number
  /** Null for a week that closed before Zebra settled anything. */
  driverPayCents: number | null
  marginCents: number | null
  loads: number
  miles: number
}

export interface CompanySlice {
  companyId: string
  companyName: string
  grossCents: number
  driverPayCents: number
  loads: number
}

export interface Dashboard {
  kpis: DashboardKpis
  /** Thirteen entries, oldest first, INCLUDING the weeks with nothing in them. */
  weeks: WeekPoint[]
  byCompany: CompanySlice[]
  byCustomer: CustomerRow[]
  perDay: DayRow[]
  /**
   * The period the first FINAL batch covers, or null when there has never been
   * one. Everything before it has UNKNOWN driver pay, and the screen says so
   * in a sentence rather than leaving a reader to wonder about the dashes.
   */
  payKnownFrom: Date | null
  /** Daily or weekly, so a chart can label its axis correctly. */
  grain: Grain
}

/** Gross per mile, or null. One definition, used by the KPI and the series. */
function perMile(grossCents: number, miles: number): number | null {
  return miles <= 0 ? null : Math.round(grossCents / miles)
}

/**
 * The Sunday a settlement week opens on, in UTC.
 *
 * MONEY-DESIGN §0, and the same boundary `WEEK_START` computes in SQL. It is
 * written here as well so the assembler can generate the EMPTY weeks: a week
 * with no freight returns no row, and a series driven only by rows would draw
 * eleven points across thirteen weeks and label none of them.
 */
export function sundayOf(day: Date): Date {
  const start = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
  )
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  return start
}

/** The last `count` settlement weeks, oldest first, ending with `now`'s week. */
export function recentSundays(now: Date, count: number): Date[] {
  const latest = sundayOf(now)
  const out: Date[] = []
  for (let back = count - 1; back >= 0; back--) {
    const week = new Date(latest)
    week.setUTCDate(week.getUTCDate() - back * 7)
    out.push(week)
  }
  return out
}

/**
 * Rows into panels.
 *
 * `weeks` is an ARGUMENT rather than something derived from the rows, and that
 * is the whole point of the function: the series must show a week that earned
 * nothing, and a row-driven series cannot, because nothing earned means no row.
 */
export function assembleDashboard(input: {
  rows: readonly WeekCompanyRow[]
  customers: readonly CustomerRow[]
  days: readonly DayRow[]
  /** The weeks to plot, oldest first. From `recentSundays`. */
  weeks: readonly Date[]
  /**
   * The period the first FINAL batch covers. Driver pay before it is UNKNOWN,
   * not zero — see `DashboardKpis.driverPayCents`.
   *
   * REQUIRED rather than optional, so a caller cannot forget it and get a
   * confident zero. `null` is the explicit "there has never been a FINAL
   * batch", which makes every figure unknown.
   */
  payKnownFrom: Date | null
  /** Which bucket size the series is in, carried through to the charts. */
  grain: Grain
}): Dashboard {
  /** Was Zebra settling by this week? */
  const payKnown = (week: Date) =>
    input.payKnownFrom !== null && week >= input.payKnownFrom
  // THE ACCUMULATOR IS NOT A `WeekPoint`. `WeekPoint.driverPayCents` is
  // nullable because UNKNOWN is one of its values, and a running total cannot
  // start at unknown and be added to. So the sum is kept in a plain shape and
  // the nullability is applied once, at the end, where the question "was Zebra
  // settling that week" is actually asked.
  interface WeekSum {
    weekStart: Date
    grossCents: number
    driverPayCents: number
    loads: number
    miles: number
  }
  const byWeek = new Map<number, WeekSum>()
  for (const week of input.weeks) {
    byWeek.set(week.getTime(), {
      weekStart: week,
      grossCents: 0,
      driverPayCents: 0,
      loads: 0,
      miles: 0,
    })
  }

  const companies = new Map<string, CompanySlice>()
  let grossCents = 0
  let driverPayCents = 0
  let loads = 0
  let miles = 0

  for (const row of input.rows) {
    grossCents += row.grossCents
    driverPayCents += row.driverPayCents
    loads += row.loads
    miles += row.miles

    // A ROW OUTSIDE THE PLOTTED WEEKS STILL COUNTS IN THE TOTALS. It is
    // dropped from the series and not from the KPIs: the window is the window,
    // and quietly excluding freight because it fell either side of a generated
    // Sunday would make the strip disagree with the chart beneath it.
    const point = byWeek.get(row.weekStart.getTime())
    if (point) {
      point.grossCents += row.grossCents
      point.driverPayCents += row.driverPayCents
      point.loads += row.loads
      point.miles += row.miles
    }

    const slice = companies.get(row.companyId) ?? {
      companyId: row.companyId,
      companyName: row.companyName,
      grossCents: 0,
      driverPayCents: 0,
      loads: 0,
    }
    slice.grossCents += row.grossCents
    slice.driverPayCents += row.driverPayCents
    slice.loads += row.loads
    companies.set(row.companyId, slice)
  }

  const weeks = [...byWeek.values()]
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
    .map((point) => {
      // PER WEEK, so a thirteen-week series that spans the boundary shows real
      // figures after it and dashes before — rather than one verdict over the
      // whole chart.
      const known = payKnown(point.weekStart)
      return {
        ...point,
        driverPayCents: known ? point.driverPayCents : null,
        marginCents: known
          ? point.grossCents - (point.driverPayCents ?? 0)
          : null,
      }
    })

  // THE WHOLE PERIOD IS KNOWN ONLY IF ITS EARLIEST WEEK IS. A period that
  // straddles the boundary has a driver-pay figure covering part of itself,
  // and a KPI that reported it would be a true number answering a different
  // question.
  const earliest = input.rows.reduce<Date | null>(
    (soonest, row) =>
      soonest === null || row.weekStart < soonest ? row.weekStart : soonest,
    null,
  )
  const totalsKnown = earliest !== null && payKnown(earliest)

  return {
    kpis: {
      grossCents,
      driverPayCents: totalsKnown ? driverPayCents : null,
      marginCents: totalsKnown ? grossCents - driverPayCents : null,
      loads,
      miles,
      centsPerMile: perMile(grossCents, miles),
    },
    weeks,
    byCompany: [...companies.values()].sort(
      (a, b) => b.grossCents - a.grossCents,
    ),
    byCustomer: [...input.customers],
    perDay: [...input.days],
    payKnownFrom: input.payKnownFrom,
    grain: input.grain,
  }
}

export interface DashboardPeriod {
  /** Inclusive. */
  from: Date
  /** EXCLUSIVE, as every query in this file treats it. */
  to: Date
}

/**
 * Everything the dashboard's money panels need, in THREE queries.
 *
 * `companyId` null is the whole group — the company chip's "All authorities".
 *
 * ── THE THIRTEEN WEEKS ARE NOT THE PERIOD ────────────────────────────────
 *
 * The KPI strip answers for the period somebody PICKED; the series always
 * shows the last thirteen weeks, because a sparkline over a four-day period is
 * four points and tells nobody whether the business is growing. The scan spans
 * whichever window is wider and the assembler separates them again — the KPIs
 * over the period, the series over the weeks.
 *
 * ── `orgId` IS ASSERTED, NOT FILTERED ON ─────────────────────────────────
 *
 * Row-level security is the tenant fence and `runInOrg` has already set
 * `app.current_org_id` before this is called, so adding `organizationId` to the
 * SQL would be a second and weaker expression of the boundary. It is in the
 * signature because the brief asked for it and because a caller with no org id
 * has not opened its transaction properly — which is worth a throw rather than
 * a silent whole-table scan.
 */
/**
 * How many days a window spans, inclusive of its open day.
 *
 * ON THE WINDOW, NOT ON THE PRESET'S NAME. A quarter is 90-odd days and a month
 * is 28 to 31, but "this quarter" on its second day is two days long — and two
 * days deserve daily bars whatever the picker is called. Reading the span rather
 * than the label is what stops "This quarter" drawing one lonely weekly bar on
 * the 2nd of October, which is the shape that started this review.
 */
export function spanDays(period: DashboardPeriod): number {
  return Math.max(
    1,
    Math.round((period.to.getTime() - period.from.getTime()) / 86_400_000),
  )
}

/**
 * Daily or weekly buckets for a window. Owner ruling, 2026-10-02.
 *
 * The ruling names the four presets — week and month give days, quarter and
 * year-to-date give weeks — and the boundary it implies is ABOUT 5 WEEKS: a
 * month is the longest thing drawn daily. So the rule is expressed as the span
 * rather than as a list of preset names, which also answers for a quarter that
 * is two days old.
 */
export function grainFor(period: DashboardPeriod): Grain {
  return spanDays(period) > 35 ? 'week' : 'day'
}

/**
 * Every bucket in the window, oldest first, INCLUDING the empty ones.
 *
 * A bucket with no freight returns no row from SQL, so a series built from rows
 * draws a dense week where there was a sparse one and labels none of it. This
 * generates the axis and the rows are looked up into it — the same argument
 * `recentSundays` was written for, generalised to both grains.
 *
 * WEEKLY BUCKETS ARE SUNDAYS, including the one the period opens inside: a
 * period starting on a Wednesday belongs to the week that opened on the Sunday
 * before it, because that is the bucket SQL will have grouped it into. Starting
 * the axis on the Wednesday would leave that week's row with nowhere to land.
 */
export function bucketsIn(period: DashboardPeriod, grain: Grain): Date[] {
  const out: Date[] = []
  const cursor =
    grain === 'week'
      ? sundayOf(period.from)
      : new Date(
          Date.UTC(
            period.from.getUTCFullYear(),
            period.from.getUTCMonth(),
            period.from.getUTCDate(),
          ),
        )
  // A CAP, because a year-to-date in weeks is 52 and a mistake is thousands.
  while (cursor < period.to && out.length < 400) {
    out.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + (grain === 'week' ? 7 : 1))
  }
  return out
}

export async function dashboardFor(
  tx: TxClient,
  orgId: string,
  companyId: string | null,
  period: DashboardPeriod,
  options: { grain?: Grain } = {},
): Promise<Dashboard> {
  if (orgId.trim() === '') {
    throw new Error('dashboardFor: no organization id. RLS would be unset.')
  }

  // ── ONE WINDOW. OWNER RULING 2026-10-02 ────────────────────────────────
  //
  // This used to widen the scan to thirteen weeks whatever the picker said,
  // return the KPIs for the period and the series for the quarter, and call
  // that honest because each had a heading. On the screen it was not: the bars
  // showed a quarter beside donuts showing the month, and nothing marked which.
  //
  // Now every figure on the page answers for `period`, and the only thing the
  // picker also decides is the BUCKET SIZE — `grainFor` below, overridable only
  // so tests can pin one.
  const grain = options.grain ?? grainFor(period)

  const [rows, customers, days, payKnownFrom] = await Promise.all([
    weekCompanyRows(tx, {
      from: period.from,
      to: period.to,
      companyId,
      grain,
    }),
    customerRows(tx, { from: period.from, to: period.to, companyId }),
    dayRows(tx, { from: period.from, to: period.to, companyId }),
    // THE FOURTH STATEMENT EARNS ITS PLACE: without it every period before
    // Zebra started settling reports a confident margin made of unknown driver
    // pay. Measured on dev, $2,571,007.51 against $184,774.65 actually
    // recorded.
    firstSettledPeriodStart(tx),
  ])

  // EVERY BUCKET IN THE WINDOW, including the ones that earned nothing — a
  // bucket with no freight returns no row, and a series driven only by rows
  // draws a dense week where there was a sparse one.
  const buckets = bucketsIn(period, grain)

  return assembleDashboard({
    rows,
    customers,
    days,
    weeks: buckets,
    payKnownFrom,
    grain,
  })
}

/**
 * The window a preset means, in UTC.
 *
 * ── `to` IS EXCLUSIVE AND IS THE NEXT BOUNDARY, NOT "NOW" ────────────────
 *
 * A period that ended at the current instant would make every figure on the
 * page change between two reads a second apart, and a reader comparing the
 * strip to the chart would see them disagree with no way to tell why. So the
 * window closes at the next day boundary: everything delivered today is in,
 * and the answer is stable for the rest of the day.
 *
 * ── THE WEEK IS A SETTLEMENT WEEK ────────────────────────────────────────
 *
 * Sunday to Sunday (MONEY-DESIGN §0), the same boundary the settlement engine
 * pays in and the same one `sundayOf` computes. A Monday-based week here would
 * put a Sunday load in a different week from the statement that paid it.
 */
/**
 * The four windows a dashboard answers for.
 *
 * HERE AND NOT IN THE PICKER, because the period is a domain vocabulary and
 * not a UI control: the server reads it from the URL, resolves it with
 * periodWindow below, and the component only renders the choice. A lib that
 * imported this from a client component would have the dependency backwards
 * and would drag React into every test of the arithmetic.
 */
export const PERIODS = ['week', 'month', 'quarter', 'ytd'] as const

export type PeriodKey = (typeof PERIODS)[number]

export function isPeriodKey(value: string): value is PeriodKey {
  return (PERIODS as readonly string[]).includes(value)
}

export function periodWindow(
  key: PeriodKey,
  now: Date,
): { from: Date; to: Date } {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  // EXCLUSIVE, so today counts. See the note above.
  const to = new Date(day)
  to.setUTCDate(to.getUTCDate() + 1)

  // ── THE WEEK IS THE WHOLE SETTLEMENT WEEK, SUNDAY TO SUNDAY ──────────
  //
  // Owner's ruling: 'Week -> 7 daily bars'. Closing this window at today+1
  // like the others gave DAYS ELAPSED — one bar on a Sunday, six on a Friday —
  // so the week preset runs to the next Sunday and the axis is always seven.
  //
  // THE DAYS THAT HAVE NOT HAPPENED RENDER AS GAPS, NOT ZEROES. A zero bar for
  // Saturday on a Wednesday claims Saturday earned nothing, which is a claim
  // about a day that does not exist yet — the same error as a zero-height
  // driver-pay bar, drawn one column over. The chart marks them from `now`.
  if (key === 'week') {
    const open = sundayOf(now)
    const close = new Date(open)
    close.setUTCDate(close.getUTCDate() + 7)
    return { from: open, to: close }
  }
  if (key === 'month') {
    return {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      to,
    }
  }
  if (key === 'quarter') {
    const firstMonth = Math.floor(now.getUTCMonth() / 3) * 3
    return {
      from: new Date(Date.UTC(now.getUTCFullYear(), firstMonth, 1)),
      to,
    }
  }
  return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to }
}
