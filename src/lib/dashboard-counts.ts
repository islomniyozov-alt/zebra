import { Prisma } from '@/generated/prisma/client'
import { companyScopeFilter } from '@/lib/tenancy'
import {
  dqfChecklist,
  dqfFactsForDrivers,
  dqfIncompleteCount,
  isQualifiable,
} from '@/lib/dqf'

/** Plain transaction client, as the other reporting modules declare it. */
type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// THE NEEDS-YOU COUNTS, IN ONE STATEMENT.
//
// Owner's ruling, 2026-10-01, ruling 3. Each row was its own `count` — nine
// round trips to us-east-2 on the first screen of the day, serialised by Prisma
// on the transaction's single connection however they were written. Phase 5 §7
// flag 31 is the history: this screen once expired a transaction in production
// at 6034ms and showed an owner a 500.
//
// ── EIGHT OF THE NINE. COMPLIANCE KEEPS ITS OWN, AND HERE IS WHY ─────────
//
// The ruling says nine. It is eight, and that is a flag rather than an
// oversight.
//
// `complianceCount` does not run a count. It calls `complianceQueue`, which
// BUILDS ROWS — reading each authority's own `complianceWarnDays` to decide
// the horizon, and folding in the carrier-level policies a truck INHERITS
// rather than holds. Reproducing that in SQL would be a second expression of
// the compliance horizon, over DOT data, to save one round trip. Flag 88 is
// about exactly that trade and the answer there was a test; here the safer
// answer is not to make the copy.
//
// So the page is not the ruling's six, and the extra statements are compliance.
// Reported rather than quietly rounded down.
//
// THIS COMMENT USED TO SAY "4 + 1 + 1 + 1 = SEVEN" AND SEVEN WAS NEVER TRUE.
// `complianceCount` does not run one statement either — `complianceQueue`
// builds its rows out of THREE reads, so `actionQueue` is four and the page was
// NINE the day this said seven. The seven was arithmetic over the reads as
// written, which is the baseline-you-supplied failure AGENTS.md names; part
// 3's budget was then derived from it. `scripts/measure-dashboard-page.ts`
// asks the driver instead, and the answer at w13 on dev is FOURTEEN across six
// concurrent transactions for a money role and NINE for a dispatcher, the
// largest of them four. Phase 5 §7 flag 43.
//
// ── ONE STATEMENT, AND THE LOAD TABLE SCANNED ONCE ──────────────────────
//
// Five of the eight are Load predicates, so they are `COUNT(*) FILTER` over a
// single scan rather than five scans. The other three are scalar subqueries in
// the same SELECT — still one statement, still one round trip.
//
// ── THE SQL IS A SECOND EXPRESSION AND THE TEST IS THE MITIGATION ───────
//
// The ruling asks that each filter be "the same predicate function its screen
// uses". IT CANNOT LITERALLY BE: the screens hold Prisma `where` objects and
// this holds SQL. Two expressions of one rule is flag 88, and the mitigation is
// the one `by-company.ts` already uses — `tests/integration/dashboard.test.ts`
// runs BOTH over the same seeded rows and requires the same number, ONE CASE
// PER ROW, NAMED. A filter that drifts from its predicate fails by the row's
// own name rather than as a total that is quietly short.
// ---------------------------------------------------------------------------

/** The eight rows this statement answers for. `compliance` is not among them. */
export const COUNTED_ROWS = [
  'podMissing',
  'noRate',
  'readyToInvoice',
  'unassignedFinished',
  'unassigned',
  'overdue',
  'unapplied',
  'draftSettlements',
] as const

export type CountedRow = (typeof COUNTED_ROWS)[number]

export interface NeedsYouCounts {
  counts: Record<CountedRow, number>
  /**
   * The two rows whose point is an amount, summed from the same scan that
   * counted them — so the figure and the number beside it cannot disagree.
   */
  amounts: { unassignedFinished: number; unapplied: number }
}

/**
 * Closed history, as SQL. The billing axis, not an `externalId` — owner's
 * ruling 1, and `billing-status.ts` argues it: a load legitimately reopened
 * stops being closed and starts counting again, which a row's origin can never
 * express.
 *
 * ONE FRAGMENT, spread into every Load filter below, exactly as
 * `NOT_CLOSED_HISTORY` is spread into every Prisma predicate.
 */
const NOT_CLOSED = Prisma.sql`l."billingStatus" <> 'CLOSED_IN_DATATRUCK'`

/** Alive and not cancelled. The floor under every Load row. */
const LIVE = Prisma.sql`l."deletedAt" IS NULL AND l."isCancelled" = false`

/**
 * Every Needs-you count except compliance, in one statement.
 *
 * `companyIds` empty means EVERY AUTHORITY — the same meaning
 * `companyScopeFilter` gives an empty scope, and it must be, because the two
 * are compared row for row in the suite. An empty array rendered as
 * `= ANY('{}')` would match nothing and silently empty the whole queue for an
 * unscoped owner, which is the one failure here that looks like good news.
 */
export async function needsYouCounts(
  tx: TxClient,
  companyIds: readonly string[],
  now: Date = new Date(),
): Promise<NeedsYouCounts> {
  const scoped = companyIds.length > 0
  const loadScope = scoped
    ? Prisma.sql`AND l."companyId" = ANY(${[...companyIds]})`
    : Prisma.empty
  const invoiceScope = scoped
    ? Prisma.sql`AND i."companyId" = ANY(${[...companyIds]})`
    : Prisma.empty
  const paymentScope = scoped
    ? Prisma.sql`AND p."companyId" = ANY(${[...companyIds]})`
    : Prisma.empty
  const settlementScope = scoped
    ? Prisma.sql`AND s."companyId" = ANY(${[...companyIds]})`
    : Prisma.empty

  // READY TO INVOICE, as `readyToInvoiceWhere` asks it: POD in, a rate on it,
  // not direct-settled, and on NO live invoice line. `invoiceLines: { none }`
  // is the honest test — `billingStatus` is a cache of it and caches drift —
  // so this is NOT EXISTS over InvoiceLine rather than a status read.
  const notInvoiced = Prisma.sql`
    NOT EXISTS (
      SELECT 1 FROM "InvoiceLine" il WHERE il."loadId" = l."id"
    )
  `

  const rows = await tx.$queryRaw<
    {
      pod_missing: bigint
      no_rate: bigint
      ready_to_invoice: bigint
      unassigned_finished: bigint
      unassigned_finished_cents: bigint
      unassigned: bigint
      overdue: bigint
      unapplied: bigint
      unapplied_cents: bigint
      draft_settlements: bigint
    }[]
  >`
    SELECT
      -- ── FIVE LOAD ROWS, ONE SCAN ────────────────────────────────────
      (SELECT COUNT(*) FILTER (
         WHERE ${NOT_CLOSED} AND l."operationalStatus" = 'DELIVERED'
       )::bigint
       FROM "Load" l WHERE ${LIVE} ${loadScope}) AS pod_missing,

      (SELECT COUNT(*) FILTER (
         WHERE ${NOT_CLOSED}
           AND l."operationalStatus" = 'POD_RECEIVED'
           AND l."totalRevenueCents" <= 0
       )::bigint
       FROM "Load" l WHERE ${LIVE} ${loadScope}) AS no_rate,

      (SELECT COUNT(*) FILTER (
         WHERE ${NOT_CLOSED}
           AND l."operationalStatus" = 'POD_RECEIVED'
           AND l."totalRevenueCents" > 0
           AND l."directSettled" = false
           AND ${notInvoiced}
       )::bigint
       FROM "Load" l WHERE ${LIVE} ${loadScope}) AS ready_to_invoice,

      -- FINISHED AND ATTACHED TO NOBODY. Either half missing is the alarm.
      (SELECT COUNT(*) FILTER (
         WHERE ${NOT_CLOSED}
           AND l."operationalStatus" = 'POD_RECEIVED'
           AND l."totalRevenueCents" > 0
           AND (l."driverId" IS NULL OR l."truckId" IS NULL)
       )::bigint
       FROM "Load" l WHERE ${LIVE} ${loadScope}) AS unassigned_finished,

      -- THE SAME FILTER, SUMMED. One expression of the predicate, two
      -- aggregates over it, so the count and the amount cannot disagree.
      (SELECT COALESCE(SUM(l."totalRevenueCents") FILTER (
         WHERE ${NOT_CLOSED}
           AND l."operationalStatus" = 'POD_RECEIVED'
           AND l."totalRevenueCents" > 0
           AND (l."driverId" IS NULL OR l."truckId" IS NULL)
       ), 0)::bigint
       FROM "Load" l WHERE ${LIVE} ${loadScope}) AS unassigned_finished_cents,

      (SELECT COUNT(*) FILTER (
         WHERE ${NOT_CLOSED}
           AND l."operationalStatus" IN ('AVAILABLE', 'BOOKED')
           AND (l."driverId" IS NULL OR l."truckId" IS NULL)
       )::bigint
       FROM "Load" l WHERE ${LIVE} ${loadScope}) AS unassigned,

      -- ── AND THE THREE THAT ARE NOT LOADS ────────────────────────────
      (SELECT COUNT(*)::bigint FROM "Invoice" i
       WHERE i."deletedAt" IS NULL
         AND i."isFactored" = false
         AND i."balanceCents" > 0
         AND i."status" NOT IN ('DRAFT', 'VOID', 'WRITTEN_OFF')
         AND i."dueDate" < ${now}
         ${invoiceScope}) AS overdue,

      (SELECT COUNT(*)::bigint FROM "Payment" p
       WHERE p."deletedAt" IS NULL AND p."unappliedCents" > 0
         ${paymentScope}) AS unapplied,

      (SELECT COALESCE(SUM(p."unappliedCents"), 0)::bigint FROM "Payment" p
       WHERE p."deletedAt" IS NULL AND p."unappliedCents" > 0
         ${paymentScope}) AS unapplied_cents,

      (SELECT COUNT(*)::bigint FROM "Settlement" s
       WHERE s."deletedAt" IS NULL AND s."status" = 'DRAFT'
         ${settlementScope}) AS draft_settlements
  `

  const row = rows[0]
  if (!row) {
    // A SELECT of scalar subqueries always returns exactly one row, so this is
    // unreachable — and it throws rather than returning zeros, because a queue
    // of noughts is indistinguishable from a quiet morning.
    throw new Error('needsYouCounts: no row from a single-row SELECT.')
  }

  return {
    counts: {
      podMissing: Number(row.pod_missing),
      noRate: Number(row.no_rate),
      readyToInvoice: Number(row.ready_to_invoice),
      unassignedFinished: Number(row.unassigned_finished),
      unassigned: Number(row.unassigned),
      overdue: Number(row.overdue),
      unapplied: Number(row.unapplied),
      draftSettlements: Number(row.draft_settlements),
    },
    amounts: {
      unassignedFinished: Number(row.unassigned_finished_cents),
      unapplied: Number(row.unapplied_cents),
    },
  }
}

// ---------------------------------------------------------------------------
// THE THREE PANELS' SCALAR FIGURES, IN THE SAME ONE STATEMENT.
//
// Dashboard part 3. The budget is ten statements for the page and the page was
// MEASURED at nine before this — `complianceCount` is three, not the one I had
// reported — so there was room for one new statement, not three.
//
// Everything here is a COUNT or a SUM, which means it is a scalar subquery, and
// scalar subqueries cost nothing extra in a SELECT that already has eight of
// them. Only "top drivers" returns rows, so only that needs a statement of its
// own.
//
// ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────
//
// THE NEEDS-YOU COMPLIANCE ROW. It asks each authority's own
// `complianceWarnDays` through `complianceQueue`, which builds rows. Folding it
// in would mean re-expressing a DOT horizon in SQL to save a round trip, which
// the owner ruled against on 2026-10-01 and which §6.1.1 now records. The
// 30/60/90 figures below are a DIFFERENT question — three fixed horizons — and
// that is why they can live here without being a second expression of anything.
//
// THE DQF DONUT. `dqfFactsForDrivers` is two statements and the checklist rule
// lives in `dqf.ts`; the same argument applies and it keeps its own reader.
// ---------------------------------------------------------------------------

export interface PanelFigures {
  fleet: {
    trucksPaired: number
    trucksIdle: number
    driversPaired: number
    driversIdle: number
    movingNow: number
  }
  /**
   * Receivables aging. Invoiced, unpaid, NON-FACTORED only.
   *
   * NULL FOR A ROLE WITHOUT `load.financials`, and null because the subqueries
   * were not in the SELECT — §6.1.1's ruling is that Cash's query does not run,
   * not that its answer is discarded.
   */
  aging: {
    d0_30: number
    d31_60: number
    d61_90: number
    d90plus: number
  } | null
  /** Settlement pipeline for the window, by batch status. Null as `aging`. */
  pipeline: {
    draftCents: number
    finalCents: number
    paidCents: number
  } | null
  /** Three fixed horizons. NOT the Needs-you row — see the header. */
  expiring: { d30: number; d60: number; d90: number }
}

/**
 * Every scalar figure the three panels need, in one statement.
 *
 * `companyIds` empty means EVERY AUTHORITY, the same meaning
 * `companyScopeFilter` gives an empty scope. An empty array rendered as
 * `= ANY('{}')` would match nothing and empty all three panels at once, which
 * is the failure here that looks like good news.
 *
 * ── THE WINDOW APPLIES TO THE PIPELINE AND TO NOTHING ELSE ───────────────
 *
 * A settlement belongs to a period, so "draft / final / paid for this window"
 * is a real question. The fleet is a fact about NOW — "moving now" cannot be
 * asked of last March — and an invoice ages against today whatever window the
 * picker shows. Scoping those to the period would answer a question nobody
 * asked and leave the panels empty on a short window.
 */
export async function panelFigures(
  tx: TxClient,
  companyIds: readonly string[],
  period: { from: Date; to: Date },
  now: Date = new Date(),
  options: { cash: boolean } = { cash: true },
): Promise<PanelFigures> {
  // ── THE CASH HALF IS A PROPERTY OF THE STATEMENT, NOT OF THE RESULT ────
  //
  // §6.1.1 makes Cash money-roles-only and the ruling is that its QUERY DOES
  // NOT RUN. Filtering the returned object would have run seven subqueries over
  // the carrier's receivables to throw the answer away, which satisfies the
  // letter and not the rule.
  //
  // Fleet and compliance are not money and stay in the SELECT for everybody, so
  // a dispatcher still gets both panels in ONE round trip. The alternative —
  // two statements, one per audience — spends an extra round trip on every
  // money role to save one on a dispatcher.
  //
  // `cashColumns` below is where that happens.
  const scoped = companyIds.length > 0
  const ids = [...companyIds]
  const sc = (alias: string) =>
    scoped
      ? Prisma.sql`AND ${Prisma.raw(`"${alias}"."companyId"`)} = ANY(${ids})`
      : Prisma.empty

  // A DRIVER WHO STILL WORKS HERE, and not a referral payee. Owner's ruling
  // 2026-09-24: a commission carried as a Driver row would inflate "how many
  // drivers do we have", which is read for insurance and CSA exposure.
  const liveDriver = Prisma.sql`
    dr."deletedAt" IS NULL AND dr."status" <> 'INACTIVE' AND dr."kind" <> 'PAYEE'
  `

  // THE SEVEN CASH COLUMNS, AS ONE FRAGMENT. They sit in the middle of the
  // SELECT list, so they carry their own trailing comma and vanish together —
  // omitting them one at a time would leave a dangling comma for the first
  // role that could not see money.
  // THE SEVEN CASH COLUMNS, AS ONE FRAGMENT. They sit in the middle of the
  // SELECT list, so they carry their own trailing comma and appear or vanish
  // together — dropping them one at a time would leave a dangling comma for
  // the first role that cannot see money.
  const cashColumns = options.cash
    ? Prisma.sql`
      -- ── CASH: AGING, INVOICED AND UNPAID AND NOT FACTORED ───────────
      --
      -- FACTORED PAPER IS THE FACTOR'S RECEIVABLE, not the carrier's. Including
      -- it would show money the carrier has already been advanced as money it
      -- is waiting for, which is the one number an owner would act on wrongly.
      --
      -- AGED ON THE DUE DATE AND AGAINST TODAY, not against the picker's
      -- window: an invoice is sixty days late today whatever period is on
      -- screen.
      (SELECT COALESCE(SUM(i."balanceCents"), 0)::bigint FROM "Invoice" i
       WHERE i."deletedAt" IS NULL AND i."isFactored" = false
         AND i."balanceCents" > 0
         AND i."status" NOT IN ('DRAFT', 'VOID', 'WRITTEN_OFF')
         ${sc('i')}
         AND i."dueDate" > ${now}::timestamp - interval '30 days') AS d0_30,
      (SELECT COALESCE(SUM(i."balanceCents"), 0)::bigint FROM "Invoice" i
       WHERE i."deletedAt" IS NULL AND i."isFactored" = false
         AND i."balanceCents" > 0
         AND i."status" NOT IN ('DRAFT', 'VOID', 'WRITTEN_OFF')
         ${sc('i')}
         AND i."dueDate" <= ${now}::timestamp - interval '30 days'
         AND i."dueDate" > ${now}::timestamp - interval '60 days') AS d31_60,
      (SELECT COALESCE(SUM(i."balanceCents"), 0)::bigint FROM "Invoice" i
       WHERE i."deletedAt" IS NULL AND i."isFactored" = false
         AND i."balanceCents" > 0
         AND i."status" NOT IN ('DRAFT', 'VOID', 'WRITTEN_OFF')
         ${sc('i')}
         AND i."dueDate" <= ${now}::timestamp - interval '60 days'
         AND i."dueDate" > ${now}::timestamp - interval '90 days') AS d61_90,
      (SELECT COALESCE(SUM(i."balanceCents"), 0)::bigint FROM "Invoice" i
       WHERE i."deletedAt" IS NULL AND i."isFactored" = false
         AND i."balanceCents" > 0
         AND i."status" NOT IN ('DRAFT', 'VOID', 'WRITTEN_OFF')
         ${sc('i')}
         AND i."dueDate" <= ${now}::timestamp - interval '90 days') AS d90plus,

      -- ── CASH: THE SETTLEMENT PIPELINE FOR THE WINDOW ────────────────
      --
      -- NET PAY, by the status of the BATCH rather than of the settlement: the
      -- batch is what moves through draft, final and paid, and a settlement's
      -- own status does not carry "paid". Scoped to the period because a
      -- settlement belongs to one.
      (SELECT COALESCE(SUM(s."netCents"), 0)::bigint FROM "Settlement" s
       JOIN "SettlementBatch" b ON b."id" = s."batchId"
       WHERE s."deletedAt" IS NULL AND b."deletedAt" IS NULL
         AND b."status" = 'DRAFT'
         ${sc('s')}
         AND s."periodStart" >= ${period.from}
         AND s."periodStart" < ${period.to}) AS draft_cents,
      (SELECT COALESCE(SUM(s."netCents"), 0)::bigint FROM "Settlement" s
       JOIN "SettlementBatch" b ON b."id" = s."batchId"
       WHERE s."deletedAt" IS NULL AND b."deletedAt" IS NULL
         AND b."status" = 'FINAL'
         ${sc('s')}
         AND s."periodStart" >= ${period.from}
         AND s."periodStart" < ${period.to}) AS final_cents,
      (SELECT COALESCE(SUM(s."netCents"), 0)::bigint FROM "Settlement" s
       JOIN "SettlementBatch" b ON b."id" = s."batchId"
       WHERE s."deletedAt" IS NULL AND b."deletedAt" IS NULL
         AND b."status" = 'PAID'
         ${sc('s')}
         AND s."periodStart" >= ${period.from}
         AND s."periodStart" < ${period.to}) AS paid_cents,
  `
    : Prisma.empty
  const rows = await tx.$queryRaw<
    {
      trucks_paired: bigint
      trucks_idle: bigint
      drivers_paired: bigint
      drivers_idle: bigint
      moving_now: bigint
      // OPTIONAL BECAUSE THE COLUMNS ARE OPTIONAL. A role without
      // `load.financials` gets a SELECT that never named them, so these are
      // absent rather than zero — and the compiler then insists the return
      // decides which it is.
      d0_30?: bigint
      d31_60?: bigint
      d61_90?: bigint
      d90plus?: bigint
      draft_cents?: bigint
      final_cents?: bigint
      paid_cents?: bigint
      exp_30: bigint
      exp_60: bigint
      exp_90: bigint
    }[]
  >`
    SELECT
      -- ── FLEET: FIVE TILES, TWO SCANS ────────────────────────────────
      --
      -- A truck is paired when a LIVE DRIVER POINTS AT IT. The pairing lives on
      -- Driver.assignedTruckId and only there, so this is the only direction
      -- the schema can answer it from.
      --
      -- NO BACKTICKS IN THESE COMMENTS. This is inside a tagged template, so a
      -- backtick CLOSES IT — the same trap dashboard-kpis.ts documents, walked
      -- into a second time in a new file.
      (SELECT COUNT(*)::bigint FROM "Truck" t
       WHERE t."deletedAt" IS NULL AND t."status" <> 'SOLD'
         ${sc('t')}
         AND EXISTS (
           SELECT 1 FROM "Driver" dr
           WHERE dr."assignedTruckId" = t."id" AND ${liveDriver}
         )) AS trucks_paired,

      -- NOT EXISTS over the SAME filter, so a truck whose only driver has been
      -- retired counts as idle rather than as spoken for.
      (SELECT COUNT(*)::bigint FROM "Truck" t
       WHERE t."deletedAt" IS NULL AND t."status" <> 'SOLD'
         ${sc('t')}
         AND NOT EXISTS (
           SELECT 1 FROM "Driver" dr
           WHERE dr."assignedTruckId" = t."id" AND ${liveDriver}
         )) AS trucks_idle,

      (SELECT COUNT(*)::bigint FROM "Driver" dr
       WHERE ${liveDriver} ${sc('dr')}
         AND dr."assignedTruckId" IS NOT NULL) AS drivers_paired,

      (SELECT COUNT(*)::bigint FROM "Driver" dr
       WHERE ${liveDriver} ${sc('dr')}
         AND dr."assignedTruckId" IS NULL) AS drivers_idle,

      (SELECT COUNT(*)::bigint FROM "Load" l
       WHERE l."deletedAt" IS NULL AND l."isCancelled" = false
         AND l."billingStatus" <> 'CLOSED_IN_DATATRUCK'
         AND l."operationalStatus" IN ('DISPATCHED', 'IN_TRANSIT')
         ${sc('l')}) AS moving_now,

      ${cashColumns}

      -- ── COMPLIANCE: THREE FIXED HORIZONS ────────────────────────────
      --
      -- NOT the Needs-you row. See the module header: that one asks each
      -- authority own complianceWarnDays through complianceQueue, and
      -- these are 30, 60 and 90 days flat.
      --
      -- CUMULATIVE, NOT BANDED. "Expiring within 60 days" INCLUDES the ones
      -- expiring within 30 — that is what the phrase means, and three disjoint
      -- bands would make the 90-day figure read as "a comfortable quarter
      -- away" when it is the only one somebody glances at.
      --
      -- ALREADY EXPIRED COUNTS IN ALL THREE, because an expired medical card is
      -- not less urgent than one expiring on Friday.
      (SELECT COUNT(*)::bigint FROM "ComplianceItem" ci
       WHERE ci."deletedAt" IS NULL ${sc('ci')}
         AND ci."expiresAt" < ${now}::timestamp + interval '30 days') AS exp_30,
      (SELECT COUNT(*)::bigint FROM "ComplianceItem" ci
       WHERE ci."deletedAt" IS NULL ${sc('ci')}
         AND ci."expiresAt" < ${now}::timestamp + interval '60 days') AS exp_60,
      (SELECT COUNT(*)::bigint FROM "ComplianceItem" ci
       WHERE ci."deletedAt" IS NULL ${sc('ci')}
         AND ci."expiresAt" < ${now}::timestamp + interval '90 days') AS exp_90
  `

  const row = rows[0]
  if (!row) {
    throw new Error('panelFigures: no row from a single-row SELECT.')
  }

  return {
    fleet: {
      trucksPaired: Number(row.trucks_paired),
      trucksIdle: Number(row.trucks_idle),
      driversPaired: Number(row.drivers_paired),
      driversIdle: Number(row.drivers_idle),
      movingNow: Number(row.moving_now),
    },
    // NULL WHEN THE COLUMNS WERE NOT ASKED FOR, and the flag decides rather
    // than the data: `Number(undefined)` is `NaN`, and a cash panel rendering
    // "$NaN" would be the most expensive way to discover this.
    aging: options.cash
      ? {
          d0_30: Number(row.d0_30),
          d31_60: Number(row.d31_60),
          d61_90: Number(row.d61_90),
          d90plus: Number(row.d90plus),
        }
      : null,
    pipeline: options.cash
      ? {
          draftCents: Number(row.draft_cents),
          finalCents: Number(row.final_cents),
          paidCents: Number(row.paid_cents),
        }
      : null,
    expiring: {
      d30: Number(row.exp_30),
      d60: Number(row.exp_60),
      d90: Number(row.exp_90),
    },
  }
}

export interface DriverGrossRow {
  driverId: string
  driverName: string
  grossCents: number
  loads: number
}

/**
 * Top drivers by gross for the window. THE ONE NEW STATEMENT.
 *
 * ── BOTH CREW SEATS ARE CREDITED, WHICH IS THE WHOLE POINT ───────────────
 *
 * §6.1.1 and the settlement engine: a team load pays two drivers, so it credits
 * two. This reads `SettlementLoadLine`, which already carries one row per
 * driver per load — the same table `driverPayByCompany` sums — so the crediting
 * falls out of the schema rather than being arranged here.
 *
 * AND THAT IS THE OPPOSITE OF HOW THE LOAD COUNT WORKS. One load, two drivers
 * paid, two drivers credited, and the per-driver `loads` figure therefore sums
 * to MORE than the window's load count. Reading the two side by side and
 * calling the difference a bug is the mistake this paragraph exists to prevent.
 *
 * FINAL AND PAID ONLY. A draft is recomputed on every refresh, so including it
 * would move a driver up the list because somebody opened a screen.
 */
export async function topDriversByGross(
  tx: TxClient,
  companyIds: readonly string[],
  period: { from: Date; to: Date },
  limit = 10,
): Promise<{ top: DriverGrossRow[]; restCount: number; restCents: number }> {
  const scoped = companyIds.length > 0
  const scope = scoped
    ? Prisma.sql`AND s."companyId" = ANY(${[...companyIds]})`
    : Prisma.empty

  const rows = await tx.$queryRaw<
    {
      driver_id: string
      first_name: string
      last_name: string
      gross: bigint
      loads: bigint
    }[]
  >`
    SELECT
      d."id" AS driver_id,
      d."firstName" AS first_name,
      d."lastName" AS last_name,
      -- GROSS IS THE FREIGHT, NOT THE PAY, and the schema is what settles it.
      --
      -- This summed line."amountCents" for one commit, which is the DRIVER'S
      -- pay for the line. Settlement.grossCents is documented as "what the
      -- percentage was taken OF" and earningsCents as the pay, so the engine
      -- already fixes what the word means on a driver's own statement — and
      -- §6.1.1 asks for "top drivers by gross". Summing pay under that heading
      -- would have put a second meaning for gross on a screen whose KPI strip
      -- uses the first one, eight inches above.
      --
      -- A TEAM LOAD THEREFORE CREDITS ITS FULL GROSS TO BOTH SEATS, so this
      -- column sums ABOVE the window's gross wherever teams ran. That is said
      -- on screen (the team note), because a reader subtracting one from the
      -- other and finding a gap is the predictable misreading.
      SUM(line."grossCents")::bigint AS gross,
      COUNT(DISTINCT line."loadId")::bigint AS loads
    FROM "SettlementLoadLine" line
    JOIN "Settlement" s ON s."id" = line."settlementId"
    JOIN "SettlementBatch" b ON b."id" = s."batchId"
    JOIN "Driver" d ON d."id" = line."driverId"
    WHERE b."status" IN ('FINAL', 'PAID')
      AND b."deletedAt" IS NULL
      AND s."deletedAt" IS NULL
      ${scope}
      AND s."periodStart" >= ${period.from}
      AND s."periodStart" < ${period.to}
    GROUP BY d."id", d."firstName", d."lastName"
    ORDER BY SUM(line."grossCents") DESC
  `

  const all = rows.map((row) => ({
    driverId: row.driver_id,
    driverName: `${row.last_name}, ${row.first_name}`,
    grossCents: Number(row.gross),
    loads: Number(row.loads),
  }))

  // THE REMAINDER IS COUNTED AND SUMMED, not dropped. A list of ten out of
  // ninety that does not say so reads as the whole fleet.
  const top = all.slice(0, limit)
  const rest = all.slice(limit)
  return {
    top,
    restCount: rest.length,
    restCents: rest.reduce((sum, row) => sum + row.grossCents, 0),
  }
}

// ---------------------------------------------------------------------------
// THE DQF SPLIT: how many qualifiable drivers have a complete file.
//
// ── IT IS IN `lib` BECAUSE IT IS A RULE, AND IT COSTS THREE STATEMENTS ───
//
// This loop lived inline in the dashboard page for one commit, which put a
// compliance rule somewhere no test could reach it without standing up
// `withCurrentOrg` — AGENTS.md's domain-logic rule, and the reason it moved
// before anything else in part 3 was measured: the instrument that counts the
// page's statements would otherwise have had to re-express the rule to run it,
// and a second expression of a compliance rule is what flag 88 is about.
//
// THREE STATEMENTS, REPORTED RATHER THAN HIDDEN: a roster read, then
// `dqfFactsForDrivers`' two. The one-statement version would be the checklist
// rewritten in SQL, which the owner ruled against for the Needs-you compliance
// row on 2026-10-01 and which §6.1.1 records. So the authoritative reader is
// called and the cost is a number in the report.
//
// `isQualifiable` IS THE FILTER AND IT IS THE ONLY ONE. The Datatruck import
// brought terminated drivers and referral payees, and a roster figure counting
// them would be reporting on nobody — but the query says nothing about that,
// deliberately. See the note at the `where`: it said the same thing in SQL for
// one commit, and a guard that refused to fire is what found the duplication.
// ---------------------------------------------------------------------------

export interface DqfSplit {
  complete: number
  incomplete: number
}

export async function dqfSplit(
  tx: TxClient,
  companyIds: readonly string[],
  now: Date,
): Promise<DqfSplit> {
  const roster = await tx.driver.findMany({
    where: {
      ...companyScopeFilter(companyIds),
      // ── NO PREDICATE HERE. `isQualifiable` IS THE WHOLE RULE ───────────
      //
      // This query carried `deletedAt: null`, `status: { not: 'INACTIVE' }` and
      // `PERSON_DRIVER` for one commit, which are precisely the three things
      // `isQualifiable` refuses — the same rule written twice, once in SQL and
      // once in TypeScript, over DOT data.
      //
      // IT WAS FOUND BY A BREAK THAT WOULD NOT FIRE. Deleting the
      // `isQualifiable` filter below left the figure unchanged, because the
      // query had already removed everything it would have caught; deleting the
      // query's clauses left it unchanged for the mirror reason. Neither half
      // was observably load-bearing, so the test could not say which one did
      // the work — flag 88's shape exactly, and the guard is what exposed it.
      //
      // The duplication also had a live hazard: if `isQualifiable` ever admits
      // somebody these clauses exclude — an INACTIVE driver whose file still
      // matters at audit — the rows would be gone before the rule was asked.
      //
      // SO THE SCOPE IS THE ONLY FILTER, and the cost is reading the terminated
      // drivers and referral payees before discarding them: 108 extra rows of
      // five columns on dev, against a figure read for DOT exposure.
    },
    // EXACTLY WHAT `isQualifiable` ASKS FOR, plus the hire date the checklist
    // needs. The compiler named the three I had left out.
    select: {
      id: true,
      hireDate: true,
      status: true,
      deletedAt: true,
      kind: true,
    },
  })

  const qualifiable = roster.filter((driver) => isQualifiable(driver))
  const facts = await dqfFactsForDrivers(
    tx,
    qualifiable.map((driver) => driver.id),
  )

  let incomplete = 0
  for (const driver of qualifiable) {
    const entries = dqfChecklist(
      // A DRIVER WITH NO FACTS HAS NO FILE, which is a true statement and
      // counts as incomplete. The fallback carries the driver's OWN hire date
      // rather than null — `DqfFacts` requires it and the checklist dates
      // requirements from it, so a null would make an undated file look
      // timeless.
      facts.get(driver.id) ?? {
        hireDate: driver.hireDate,
        documents: [],
        compliance: [],
      },
      now,
    )
    if (dqfIncompleteCount(entries) > 0) incomplete++
  }

  return { complete: qualifiable.length - incomplete, incomplete }
}
