import type { Prisma } from '@/generated/prisma/client'
import { NOT_CLOSED_HISTORY } from './billing-status'
import { batchInputForOrg } from './settlement-batch'
import { computeBatch, type Week } from './settlement-week'
import { filingStatesForCompanies } from './factoring-filing'
import {
  PACKET_PIECE_LABEL,
  type RequiredPacketDocument,
} from './factoring-packet'

// ---------------------------------------------------------------------------
// THE TUESDAY SCREEN'S READ — ONE PAGE FOR THE WHOLE OPERATION.
//
// MONEY-DESIGN item 6, reshaped by Islom's ruling of 2026-09-11: the sister
// companies are ONE operation and settlement is org-wide. So this stopped
// being a list of per-company blocks and became one page — one period header,
// one Ready total with its reason, one held list and one blocked list with a
// company COLUMN, one Open batch.
//
// WHAT STAYED PER AUTHORITY, AND WHY. Two things are facts about a company
// rather than about the week, and both would be nonsense summed: whether the
// Amazon remittance for the period has arrived (each authority is paid
// separately), and the factoring position (an invoice carries one authority's
// MC and goes outside). They are lists ON the page, not sections OF it.
//
// ── IT READS. IT DOES NOT DECIDE ─────────────────────────────────────────
//
// Every figure comes from a definition that already exists and is already
// tested: `SETTLEABLE_LOAD`, `computeBatch`, `packetReadiness`. A screen that
// counted settleable loads with its own `where` clause would disagree with the
// batch the morning somebody changed one of them, and the screen is what
// people trust.
//
// ── ONE QUERY PER SECTION ────────────────────────────────────────────────
//
// MEASURED, NOT ASSUMED, AND THE FIRST VERSION FAILED. Written as a loop over
// companies it cost 16.2 SECONDS against 14,464 loads, five times a 5s
// transaction budget. Going org-wide removes the loop from the engine read
// altogether, which is the ruling paying for itself.
//
// ── AND IT NEVER RENDERS A PDF ───────────────────────────────────────────
//
// `filingStatesForCompanies` is the light read: rows and `packetReadiness`, no
// `packetPlanFor`, no R2. A summary page that rendered a packet per load to
// find out whether it was ready would fetch from a bucket to answer a question
// the rows already answer — and R2 refuses to run inside a transaction, so it
// would take the screen down rather than merely slow it.
// ---------------------------------------------------------------------------

type TxClient = Prisma.TransactionClient

export type BatchState = 'none' | 'DRAFT' | 'FINAL' | 'PAID'

/** The one thing a person may do next, given where the batch is. */
export type BatchAction = 'open' | 'continue' | 'markPaid' | 'none'

export interface RemittanceState {
  companyId: string
  companyName: string
  found: boolean
  invoiceNumber: string | null
  totalCents: number | null
  importedAt: Date | null
}

export interface HeldRow {
  loadId: string
  loadNumber: string
  companyId: string
  companyName: string
  driverName: string
  reason: 'short' | 'over' | 'no_remittance'
  remittedCents: number | null
  bookedCents: number
}

export interface BlockedDriver {
  driverId: string
  driverName: string
  companyId: string
  companyName: string
}

export interface WernerState {
  companyId: string
  companyName: string
  filedUnpaid: number
  /** The oldest unpaid filing, from `filedAt` — written by the action alone. */
  oldestFiledAt: Date | null
  readyToFile: number
  notReady: number
  /** The piece missing most often, named — never "3 of 4 documents". */
  commonestMissing: string | null
}

export interface RecentBatch {
  id: string
  batchNumber: string | null
  periodStart: Date
  periodEnd: Date
  status: string
  netCents: number
  statements: number
}

/**
 * Why the ready set is empty, when it is. Null when it is not empty.
 *
 * A ZERO IS A MEASUREMENT AND AN ABSENCE IS NOT ONE. "$0.00" tells somebody
 * that nothing settles and leaves them to find out why; these say which of the
 * four reasons it is, all of which lead somewhere different.
 */
export type NothingReadyReason =
  /** Every delivery in the period was settled in Datatruck before the cutover. */
  | 'closed_history'
  /** Freight is here, but no driver can be paid for it until a rule exists. */
  | 'blocked'
  /** Freight is here and every line of it is waiting on a confirmation. */
  | 'held'
  /** Nothing was delivered in this period at all. */
  | 'no_freight'

/** One authority, for the filter. Not a section — see the header. */
export interface CompanyRef {
  id: string
  name: string
}

export interface ThisWeek {
  period: Week
  payDay: Date
  /** THE batch for the period. One, by ruling. */
  batch: { id: string | null; state: BatchState; action: BatchAction }
  companies: CompanyRef[]
  ready: { loads: number; drivers: number; grossCents: number }
  /** Set only when `ready.loads` is zero. Never a reason for a non-empty set. */
  nothingReady: NothingReadyReason | null
  held: HeldRow[]
  heldSumCents: number
  blocked: BlockedDriver[]
  /** Per authority: each is paid separately, so these cannot be summed. */
  remittances: RemittanceState[]
  /** Per authority: an invoice carries one MC and goes outside. */
  factoring: WernerState[]
  recent: RecentBatch[]
  /** How long each section took, in ms. Reported, not guessed at. */
  timings: Record<string, number>
}

const ACTION_FOR: Record<BatchState, BatchAction> = {
  none: 'open',
  DRAFT: 'continue',
  FINAL: 'markPaid',
  PAID: 'none',
}

const RECENT_BATCHES = 4

export async function thisWeekFor(
  tx: TxClient,
  input: { period: Week; payDay: Date },
): Promise<ThisWeek> {
  const openedAt = Date.now()
  const timings: Record<string, number> = {}
  const timed = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const started = Date.now()
    const value = await run()
    timings[name] = (timings[name] ?? 0) + (Date.now() - started)
    return value
  }

  const report = (result: ThisWeek): ThisWeek => {
    console.log(
      '[zebra.money.thisWeek]',
      JSON.stringify({
        periodStart: input.period.start.toISOString().slice(0, 10),
        companies: result.companies.length,
        totalMs: Date.now() - openedAt,
        sections: timings,
      }),
    )
    return result
  }

  const companies = await timed('companies', () =>
    tx.company.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, organizationId: true },
    }),
  )

  if (companies.length === 0) {
    // LOGGED ON THIS PATH TOO. An organization that silently stops having
    // companies otherwise looks exactly like a fast page.
    return report({
      period: input.period,
      payDay: input.payDay,
      batch: { id: null, state: 'none', action: 'open' },
      companies: [],
      ready: { loads: 0, drivers: 0, grossCents: 0 },
      nothingReady: 'no_freight',
      held: [],
      heldSumCents: 0,
      blocked: [],
      remittances: [],
      factoring: [],
      recent: [],
      timings,
    })
  }

  const companyIds = companies.map((company) => company.id)
  const nameOf = new Map(companies.map((company) => [company.id, company.name]))
  const organizationId = companies[0]!.organizationId
  const periodEndOfDay = new Date(input.period.end.getTime() + 86_399_999)

  // ── §1 THE batch for this period. One, by ruling. ──────────────────────
  const batch = await timed('batch', () =>
    tx.settlementBatch.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        periodStart: input.period.start,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    }),
  )
  const state: BatchState = batch ? (batch.status as BatchState) : 'none'

  // ── §2 the engine, once, for the whole organization ────────────────────
  //
  // `computeBatch` is the same function the draft runs through, so the screen
  // cannot say "ready: 12" about a batch that would produce eleven.
  const computed = await timed('engine', async () => {
    const drivers = await batchInputForOrg(
      tx,
      {
        organizationId,
        period: input.period,
        statementDate: input.payDay,
        checkDate: input.payDay,
      },
      // ── NO NET-PAY READS. THIS SCREEN NEVER SHOWS NET ─────────────────
      //
      // Recurring deductions, the escrow balance, the opening balance and the
      // year's prior settlements turn gross into net — and this page displays
      // Ready (loads, drivers, GROSS), held lines and blocked drivers, and
      // reads `netCents` nowhere. Four round trips for figures that never
      // reach the screen, out of a page that had grown to twenty-three.
      //
      // THE HELD AND BLOCKED LISTS ARE UNAFFECTED: a held line is a load whose
      // remittance disagrees with its booked rate, and a blocked driver is one
      // with no pay rule. Neither is a deduction.
      { netPay: false },
    )
    return computeBatch({
      period: input.period,
      statementDate: input.payDay,
      checkDate: input.payDay,
      drivers,
    })
  })

  // ── §3 which authorities carry direct-settled freight ──────────────────
  //
  // CLOSED HISTORY DOES NOT COUNT. Without this a retired authority gets a
  // remittance row and a no-remittance warning forever: production carries two,
  // Midwest Global with 2,108 direct-settled loads and zero that are not closed
  // history, and American Soldier with 424 and zero. A warning nobody can clear
  // teaches the person reading this screen that the yellow box means nothing.
  const directMix = await timed('mix', () =>
    tx.load.groupBy({
      by: ['companyId'],
      where: {
        companyId: { in: companyIds },
        deletedAt: null,
        customer: { settlesDirectly: true },
        ...NOT_CLOSED_HISTORY,
      },
      _count: { _all: true },
    }),
  )

  // ── §3b why the ready set is empty, when it is ─────────────────────────
  const closedInPeriod = await timed('closed', () =>
    tx.load.count({
      where: {
        companyId: { in: companyIds },
        deletedAt: null,
        billingStatus: 'CLOSED_IN_DATATRUCK',
        stops: {
          some: {
            type: 'DELIVERY',
            scheduledAt: { gte: input.period.start, lte: periodEndOfDay },
          },
        },
      },
    }),
  )

  // ── §4 the remittance for this period, per authority ───────────────────
  //
  // ASKED BY THE PERIOD IT DECLARES, with the old question as the fallback.
  // `periodStart` is parsed from what Amazon prints; the second arm asks what
  // the payment actually paid for, which is how this worked before the column
  // existed. Both arms, because every payment already in the database has no
  // period and every hand-entered one never will.
  const payments = await timed('remittance', () =>
    tx.payment.findMany({
      where: {
        companyId: { in: companyIds },
        deletedAt: null,
        remittanceKey: { not: null },
        OR: [
          { periodStart: input.period.start },
          {
            periodStart: null,
            loadApplications: {
              some: {
                load: {
                  stops: {
                    some: {
                      type: 'DELIVERY',
                      scheduledAt: {
                        gte: input.period.start,
                        lte: periodEndOfDay,
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
      // `nulls: 'last'` IS LOAD-BEARING. Postgres sorts NULLs FIRST on a DESC
      // ordering, so the plain version did the opposite of what it claimed: a
      // hand-entered payment with no period beat the one that declared it.
      orderBy: [
        { periodStart: { sort: 'desc', nulls: 'last' } },
        { receivedAt: 'desc' },
      ],
      select: {
        companyId: true,
        remittanceKey: true,
        amountCents: true,
        createdAt: true,
      },
    }),
  )
  const paymentOf = new Map<string, (typeof payments)[number]>()
  for (const payment of payments) {
    if (!paymentOf.has(payment.companyId)) {
      paymentOf.set(payment.companyId, payment)
    }
  }

  // ── §5 the factoring position, per authority, from the light read ──────
  const filing = await timed('werner', () =>
    filingStatesForCompanies(tx, companyIds),
  )

  // ── §6 the last four batches. Org-wide now, so four is four. ───────────
  const recentRows = await timed('recent', () =>
    tx.settlementBatch.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      take: RECENT_BATCHES,
      select: {
        id: true,
        batchNumber: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        settlements: { select: { netCents: true } },
      },
    }),
  )

  // ── assemble ───────────────────────────────────────────────────────────
  const held: HeldRow[] = computed.held.map((row) => ({
    loadId: row.line.loadId,
    loadNumber: row.line.loadNumber,
    companyId: row.line.companyId,
    companyName: row.line.companyName,
    driverName: row.driverName,
    reason: row.line.reason.kind,
    remittedCents:
      row.line.reason.kind === 'no_remittance'
        ? null
        : row.line.reason.remittedCents,
    bookedCents: row.line.rateCents,
  }))

  const blocked: BlockedDriver[] = computed.blockers
    .filter((row) => row.blocker.kind === 'no_pay_rule')
    .map((row) => ({
      driverId: row.driverId,
      driverName: row.driverName,
      companyId: row.companyId,
      companyName: nameOf.get(row.companyId) ?? '',
    }))

  const settling = computed.settlements.filter(
    (settlement) => settlement.lines.length > 0,
  )
  const readyLoads = settling.reduce(
    (sum, settlement) => sum + settlement.lines.length,
    0,
  )

  return report({
    period: input.period,
    payDay: input.payDay,
    batch: { id: batch?.id ?? null, state, action: ACTION_FOR[state] },
    companies: companies.map((company) => ({
      id: company.id,
      name: company.name,
    })),
    ready: {
      loads: readyLoads,
      drivers: settling.length,
      grossCents: settling.reduce(
        (sum, settlement) => sum + settlement.grossCents,
        0,
      ),
    },
    // ORDERED BY WHAT A PERSON WOULD DO ABOUT IT. A blocked driver is
    // somebody's afternoon; a held line is a phone call; closed history is
    // nothing at all, and is the commonest answer during the cutover.
    nothingReady:
      readyLoads > 0
        ? null
        : blocked.length > 0
          ? 'blocked'
          : held.length > 0
            ? 'held'
            : closedInPeriod > 0
              ? 'closed_history'
              : 'no_freight',
    held,
    heldSumCents: held.reduce((sum, row) => sum + row.bookedCents, 0),
    blocked,
    remittances: directMix.map((row) => {
      const payment = paymentOf.get(row.companyId)
      return {
        companyId: row.companyId,
        companyName: nameOf.get(row.companyId) ?? '',
        found: payment !== undefined,
        invoiceNumber: payment?.remittanceKey ?? null,
        totalCents: payment?.amountCents ?? null,
        importedAt: payment?.createdAt ?? null,
      }
    }),
    factoring: [...filing]
      // NO ROW WHERE THERE IS NO BROKER FREIGHT. `states` IS that freight —
      // the filing read selects exactly the loads that are not direct-settled
      // — so an empty list is the answer and no extra count is needed.
      .filter(([, states]) => states.length > 0)
      .map(([companyId, states]) => {
        const filed = states.filter(
          (row) => row.billingStatus === 'FILED_WITH_FACTOR',
        )
        const missingCounts = new Map<RequiredPacketDocument, number>()
        let notReady = 0
        let readyToFile = 0
        let oldestFiledAt: Date | null = null
        for (const row of states) {
          if (row.billingStatus === 'FILED_WITH_FACTOR') {
            const at = row.filedAt
            // A LOAD FILED BEFORE `filedAt` EXISTED HAS NONE, and is skipped
            // rather than dated now: backfilling from `updatedAt` would
            // manufacture a history that reads like a record.
            if (at && (!oldestFiledAt || at < oldestFiledAt)) oldestFiledAt = at
            continue
          }
          if (row.canFile) {
            readyToFile++
            continue
          }
          notReady++
          for (const piece of row.readiness.missing) {
            missingCounts.set(piece, (missingCounts.get(piece) ?? 0) + 1)
          }
        }
        const commonest = [...missingCounts.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0]
        return {
          companyId,
          companyName: nameOf.get(companyId) ?? '',
          filedUnpaid: filed.length,
          oldestFiledAt,
          readyToFile,
          notReady,
          commonestMissing: commonest ? PACKET_PIECE_LABEL[commonest[0]] : null,
        }
      }),
    recent: recentRows.map((row) => ({
      id: row.id,
      batchNumber: row.batchNumber,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      status: row.status,
      netCents: row.settlements.reduce((sum, s) => sum + s.netCents, 0),
      statements: row.settlements.length,
    })),
    timings,
  })
}
