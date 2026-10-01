import { Prisma } from '@/generated/prisma/client'

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
// So the page is 4 + 1 + 1 + 1 = SEVEN, not the ruling's six, and the extra
// one is compliance. Reported rather than quietly rounded down.
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
