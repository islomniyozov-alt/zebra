import type { Prisma } from '@/generated/prisma/client'
import { NOT_CLOSED_HISTORY } from './billing-status'
import { batchInputForCompanies } from './settlement-batch'
import { computeBatch, type Week } from './settlement-week'
import { filingStatesForCompanies } from './factoring-filing'
import {
  PACKET_PIECE_LABEL,
  type RequiredPacketDocument,
} from './factoring-packet'

// ---------------------------------------------------------------------------
// THE TUESDAY SCREEN'S READ.
//
// One page, per company: what is due this Friday, whether it can be settled
// yet, and what is standing in the way. MONEY-DESIGN item 6.
//
// ── IT READS. IT DOES NOT DECIDE ─────────────────────────────────────────
//
// Every figure here comes from a definition that already exists and is already
// tested: `SETTLEABLE_LOAD` for what may settle, `computeBatch` for held lines
// and blocked drivers and the ready set, `packetReadiness` (through
// `filingStatesForCompanies`) for the filing position. Nothing is recomputed
// locally, and that is not tidiness — a screen that counted settleable loads
// with its own `where` clause would disagree with the batch the morning
// somebody changed one of them, and the screen is what people trust.
//
// So there is no money rule in this file. If the page turns out to need one,
// that is a finding to report rather than a thing to add here.
//
// ── ONE QUERY PER SECTION, ACROSS EVERY COMPANY AT ONCE ──────────────────
//
// MEASURED, NOT ASSUMED, AND THE FIRST VERSION FAILED. Written as a loop over
// companies — the obvious shape — it cost 16.2 SECONDS against the 14,464
// loads on dev, five times over a five-second transaction budget, because each
// of six sections ran its queries once per authority. Round trips dominate at
// roughly 200ms, and Prisma serialises them inside an interactive transaction,
// so concurrency was not the fix either.
//
// Every section now reads every company in one query and groups in memory. The
// per-section timings come back with the data so the claim can be checked
// rather than repeated.
//
// ── AND IT NEVER RENDERS A PDF ───────────────────────────────────────────
//
// `filingStatesForCompanies` is the light read: rows and `packetReadiness`, no
// `packetPlanFor`, no `renderInvoicePdf`, no R2. A summary page that rendered a
// packet per load to find out whether it was ready would take a minute to open
// and would fetch from a bucket to answer a question the rows already answer.
// ---------------------------------------------------------------------------

type TxClient = Prisma.TransactionClient

export type BatchState = 'none' | 'DRAFT' | 'FINAL' | 'PAID'

/** The one thing a person may do next, given where the batch is. */
export type BatchAction = 'open' | 'continue' | 'markPaid' | 'none'

export interface RemittanceState {
  found: boolean
  invoiceNumber: string | null
  totalCents: number | null
  importedAt: Date | null
}

export interface HeldRow {
  loadId: string
  loadNumber: string
  driverName: string
  reason: 'short' | 'over' | 'no_remittance'
  remittedCents: number | null
  bookedCents: number
}

export interface BlockedDriver {
  driverId: string
  driverName: string
}

export interface WernerState {
  filedUnpaid: number
  /** The oldest unpaid filing, so a week-old one is visible as a week old. */
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

export interface CompanyWeek {
  companyId: string
  companyName: string
  batch: { id: string | null; state: BatchState; action: BatchAction }
  /** Null for a company with no direct-settled freight at all. */
  remittance: RemittanceState | null
  held: HeldRow[]
  heldSumCents: number
  blocked: BlockedDriver[]
  ready: { loads: number; drivers: number; grossCents: number }
  /** Set only when `ready.loads` is zero. Never a reason for a non-empty set. */
  nothingReady: NothingReadyReason | null
  /** Null for a company whose freight is entirely direct-settled. */
  werner: WernerState | null
  recent: RecentBatch[]
}

export interface ThisWeek {
  period: Week
  payDay: Date
  companies: CompanyWeek[]
  /** How long each section took, in ms. Reported, not guessed at. */
  timings: Record<string, number>
}

const ACTION_FOR: Record<BatchState, BatchAction> = {
  none: 'open',
  DRAFT: 'continue',
  FINAL: 'markPaid',
  PAID: 'none',
}

/** Enough recent batches for four each, with room for an uneven spread. */
const RECENT_PER_COMPANY = 4

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

  const companies = await timed('companies', () =>
    tx.company.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, organizationId: true },
    }),
  )
  if (companies.length === 0) {
    // LOGGED ON THIS PATH TOO. A page that costs nothing because it found
    // nothing is a fact worth seeing in the same graph as one that found five
    // authorities — an organization that silently stops having companies looks
    // exactly like a fast page otherwise.
    console.log(
      '[zebra.money.thisWeek]',
      JSON.stringify({
        periodStart: input.period.start.toISOString().slice(0, 10),
        companies: 0,
        totalMs: Date.now() - openedAt,
        sections: timings,
      }),
    )
    return {
      period: input.period,
      payDay: input.payDay,
      companies: [],
      timings,
    }
  }

  const companyIds = companies.map((company) => company.id)
  const organizationId = companies[0]!.organizationId
  const periodEndOfDay = new Date(input.period.end.getTime() + 86_399_999)

  // ── §1 the batch for this period, every company at once ────────────────
  const batches = await timed('batch', () =>
    tx.settlementBatch.findMany({
      where: {
        companyId: { in: companyIds },
        deletedAt: null,
        periodStart: input.period.start,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, companyId: true, status: true },
    }),
  )
  const batchOf = new Map<string, (typeof batches)[number]>()
  for (const batch of batches) {
    if (!batchOf.has(batch.companyId)) batchOf.set(batch.companyId, batch)
  }

  // ── §2 the engine, ONCE, serving held / blocked / ready ─────────────────
  //
  // Three sections from one read rather than three that would each have to
  // re-derive what settleable means. `computeBatch` is the same function the
  // draft runs through, so the screen cannot say "ready: 12" about a batch that
  // would produce eleven.
  const computed = await timed('engine', async () => {
    const byCompany = await batchInputForCompanies(tx, {
      organizationId,
      companyIds,
      period: input.period,
      statementDate: input.payDay,
      checkDate: input.payDay,
    })
    return new Map(
      [...byCompany].map(([companyId, drivers]) => [
        companyId,
        computeBatch({
          companyId,
          period: input.period,
          statementDate: input.payDay,
          checkDate: input.payDay,
          drivers,
        }),
      ]),
    )
  })

  // ── §3 which companies carry direct-settled freight ────────────────────
  //
  // ONE GROUPED COUNT, and only one: whether a company has BROKER freight is
  // already answered by the filing read below, which selects exactly those
  // loads. A second count asking the same question differently would be a
  // second definition as well as a second round trip.
  const directMix = await timed('mix', () =>
    tx.load.groupBy({
      by: ['companyId'],
      where: {
        companyId: { in: companyIds },
        deletedAt: null,
        customer: { settlesDirectly: true },
        // CLOSED HISTORY DOES NOT COUNT AS HAVING AMAZON FREIGHT.
        //
        // Without this, a retired authority gets a remittance row and a
        // no-remittance warning forever. Production on 2026-09-11: Midwest
        // Global carries 2,108 direct-settled loads and ZERO that are not
        // closed history; American Soldier, 424 and zero. Both would have been
        // warned every Tuesday about a file that is never coming, for freight
        // that was settled in Datatruck before Zebra existed.
        //
        // A warning nobody can clear is worse than no warning: it teaches the
        // person reading this screen that the yellow box means nothing.
        ...NOT_CLOSED_HISTORY,
      },
      _count: { _all: true },
    }),
  )
  const directOf = new Map(
    directMix.map((row) => [row.companyId, row._count._all]),
  )

  // ── §3b why the ready set is empty, when it is ─────────────────────────
  //
  // "$0.00" is a measurement and an absence is not one. A week with no
  // settleable freight has a REASON, and the commonest by far on this data is
  // that everything in the period was settled in Datatruck before the cutover
  // — 62 of 62 Dolphins deliveries in the week of Aug 30 are closed history.
  //
  // ONE MORE QUERY, DELIBERATELY. It takes the page from 13 round trips to 14,
  // and buys a sentence somebody can act on instead of a zero they have to
  // investigate.
  const closedInPeriod = await timed('closed', () =>
    tx.load.groupBy({
      by: ['companyId'],
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
      _count: { _all: true },
    }),
  )
  const closedOf = new Map(
    closedInPeriod.map((row) => [row.companyId, row._count._all]),
  )

  // ── §4 the remittance for this period ──────────────────────────────────
  //
  // ASKED BY THE PERIOD IT DECLARES, with the old question as the fallback.
  //
  // `periodStart` is parsed from what Amazon prints in the Payment Summary —
  // "Aug 30 - Sep 5, 2026" — so the first arm asks the remittance what week it
  // is FOR. The second arm asks what it actually paid for, which is how this
  // worked before the column existed: a payment whose applications land on
  // loads delivered in the period.
  //
  // BOTH ARMS, NOT ONE. The label is the better answer and the lookup is the
  // one that always works — every payment entered by hand has no period, and so
  // does a remittance imported before this column existed or whose label
  // `parseWorkPeriod` refused. Dropping the fallback would make this week's
  // remittance invisible for every row already in the database.
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
      // THE DECLARED PERIOD WINS where a company has both kinds. A payment that
      // says which week it is for is a better answer than one inferred from
      // what it touched, so it sorts first and the map below keeps the first.
      //
      // `nulls: 'last'` IS LOAD-BEARING AND WAS MISSING. Postgres sorts NULLs
      // FIRST on a DESC ordering, so the plain version did the exact opposite
      // of what this comment claimed: a hand-entered payment with no period beat
      // the remittance that declared one. Caught by the acceptance.
      orderBy: [
        { periodStart: { sort: 'desc', nulls: 'last' } },
        { receivedAt: 'desc' },
      ],
      select: {
        companyId: true,
        remittanceKey: true,
        amountCents: true,
        createdAt: true,
        periodStart: true,
      },
    }),
  )
  const paymentOf = new Map<string, (typeof payments)[number]>()
  for (const payment of payments) {
    if (!paymentOf.has(payment.companyId))
      paymentOf.set(payment.companyId, payment)
  }

  // ── §5 the factoring position, from the light read ─────────────────────
  const filing = await timed('werner', () =>
    filingStatesForCompanies(tx, companyIds),
  )
  // THE OLDEST FILING COMES BACK WITH THE FILING READ, not from a second query
  // over the same rows. `filedAt` is written by `fileWithFactor` and by nothing
  // else; a load filed before that column existed has none, and is skipped
  // rather than counted as filed today.
  const oldestFiledOf = new Map<string, Date>()
  for (const [companyId, states] of filing) {
    for (const row of states) {
      if (row.billingStatus !== 'FILED_WITH_FACTOR') continue
      const at = row.filedAt
      if (!at) continue
      const current = oldestFiledOf.get(companyId)
      if (!current || at < current) oldestFiledOf.set(companyId, at)
    }
  }

  // ── §6 the last four batches per company ───────────────────────────────
  //
  // ONE QUERY, SLICED IN MEMORY. Postgres has no per-group limit that Prisma
  // exposes, and the alternative was a query per company; the cap is generous
  // enough that a company cannot be crowded out by another's history.
  const recentRows = await timed('recent', () =>
    tx.settlementBatch.findMany({
      where: { companyId: { in: companyIds }, deletedAt: null },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      take: companyIds.length * RECENT_PER_COMPANY * 4,
      select: {
        id: true,
        companyId: true,
        batchNumber: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        settlements: { select: { netCents: true } },
      },
    }),
  )
  const recentOf = new Map<string, RecentBatch[]>()
  for (const row of recentRows) {
    const list = recentOf.get(row.companyId) ?? []
    if (list.length >= RECENT_PER_COMPANY) continue
    list.push({
      id: row.id,
      batchNumber: row.batchNumber,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      status: row.status,
      netCents: row.settlements.reduce((sum, s) => sum + s.netCents, 0),
      statements: row.settlements.length,
    })
    recentOf.set(row.companyId, list)
  }

  // ── assemble ───────────────────────────────────────────────────────────
  const out: CompanyWeek[] = companies.map((company) => {
    const batch = batchOf.get(company.id) ?? null
    const state: BatchState = batch ? (batch.status as BatchState) : 'none'
    const result = computed.get(company.id)

    const held: HeldRow[] = (result?.held ?? []).map((row) => ({
      loadId: row.line.loadId,
      loadNumber: row.line.loadNumber,
      driverName: row.driverName,
      reason: row.line.reason.kind,
      remittedCents:
        row.line.reason.kind === 'no_remittance'
          ? null
          : row.line.reason.remittedCents,
      bookedCents: row.line.rateCents,
    }))

    const settling = (result?.settlements ?? []).filter(
      (settlement) => settlement.lines.length > 0,
    )
    const readyLoads = settling.reduce(
      (sum, settlement) => sum + settlement.lines.length,
      0,
    )
    const blockedHere = (result?.blockers ?? []).filter(
      (row) => row.blocker.kind === 'no_pay_rule',
    )

    const direct = directOf.get(company.id) ?? 0
    const payment = paymentOf.get(company.id)

    const states = filing.get(company.id) ?? []
    const filed = states.filter(
      (row) => row.billingStatus === 'FILED_WITH_FACTOR',
    )
    const missingCounts = new Map<RequiredPacketDocument, number>()
    let notReady = 0
    let readyToFile = 0
    for (const row of states) {
      if (row.billingStatus === 'FILED_WITH_FACTOR') continue
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
      companyId: company.id,
      companyName: company.name,
      batch: { id: batch?.id ?? null, state, action: ACTION_FOR[state] },
      remittance:
        direct === 0
          ? null
          : {
              found: payment !== undefined,
              invoiceNumber: payment?.remittanceKey ?? null,
              totalCents: payment?.amountCents ?? null,
              importedAt: payment?.createdAt ?? null,
            },
      held,
      heldSumCents: held.reduce((sum, row) => sum + row.bookedCents, 0),
      blocked: blockedHere.map((row) => ({
        driverId: row.driverId,
        driverName: row.driverName,
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
          : blockedHere.length > 0
            ? 'blocked'
            : held.length > 0
              ? 'held'
              : (closedOf.get(company.id) ?? 0) > 0
                ? 'closed_history'
                : 'no_freight',
      // NO FACTORING SECTION where the company has no broker freight at all.
      // `states` IS that freight — the filing read selects exactly the loads
      // that are not direct-settled — so an empty list is the answer, and no
      // extra count is needed to ask it.
      werner:
        states.length === 0
          ? null
          : {
              filedUnpaid: filed.length,
              oldestFiledAt: oldestFiledOf.get(company.id) ?? null,
              readyToFile,
              notReady,
              commonestMissing: commonest
                ? PACKET_PIECE_LABEL[commonest[0]]
                : null,
            },
      recent: recentOf.get(company.id) ?? [],
    }
  })

  // ── WHAT IT COST, ON EVERY OPEN, IN PRODUCTION ─────────────────────────
  //
  // Fixed tag and a structured payload, the same shape the audit log uses, so
  // Workers observability can graph it and an alert can be built on it.
  //
  // LOGGED RATHER THAN ASSERTED, and logged from the REAL page rather than from
  // a probe. The measurement that shaped this file was taken from a development
  // machine roughly 200ms from us-east-2; a Worker sits far closer, and the only
  // way to know what this actually costs the people opening it on a Tuesday is
  // to record what it cost them. `loads` and `companies` are here because the
  // number is meaningless without the size of the thing it read.
  console.log(
    '[zebra.money.thisWeek]',
    JSON.stringify({
      periodStart: input.period.start.toISOString().slice(0, 10),
      companies: out.length,
      totalMs: Date.now() - openedAt,
      sections: timings,
    }),
  )

  return { period: input.period, payDay: input.payDay, companies: out, timings }
}
