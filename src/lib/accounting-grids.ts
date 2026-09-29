import type { Prisma } from '@/generated/prisma/client'
import { companyScopeFilter } from './tenancy'
import { listPayments, type PaymentRow } from './payments'
import { listCharges, type ChargeRow } from './driver-deductions'
import { agingBucketFor, type AgingBucket } from './factoring'
import type { ListShape } from './list-view'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// THE ROWS AND THE FILTER, ONCE, FOR BOTH THE SCREEN AND THE EXPORT.
//
// ── WHY THIS MODULE EXISTS ────────────────────────────────────────────────
//
// §7.1.5: "One definition of the rows and one of the filter, shared with the
// screen. The export re-runs the same reader and the same `applyList`; it does not
// carry its own query. Two queries that are supposed to agree about money are two
// queries that will not."
//
// The route handler at `/accounting/export` and the five pages both come here.
// What the pages keep for themselves is RENDERING — a `Column`'s `render` is JSX
// and needs a locale and a translator, neither of which belongs in a CSV.
//
// ── THE SHAPE IS SHARED, NOT COPIED ───────────────────────────────────────
//
// The `ListShape` is the filter: search fields, which date the range bounds,
// which column sorts by what. A page and an export holding separate shapes would
// agree until somebody added a searchable field to one of them, and then the CSV
// would contain rows the screen said were excluded — or leave out rows it showed.
// ---------------------------------------------------------------------------

/** The scope both a page and the export derive the same way. */
export type Scope = ReturnType<typeof companyScopeFilter>

// ── INVOICES ───────────────────────────────────────────────────────────────

export interface InvoiceGridRow {
  id: string
  invoiceNumber: string
  customerName: string
  companyId: string
  companyName: string
  issued: Date | null
  due: Date | null
  totalCents: number
  balanceCents: number
  status: string
  /** Null when nothing is outstanding — a paid invoice has no age. */
  bucket: AgingBucket | null
}

export async function readInvoices(
  tx: TxClient,
  scope: Scope,
  now: Date,
): Promise<InvoiceGridRow[]> {
  const rows = await tx.invoice.findMany({
    where: { deletedAt: null, ...scope },
    orderBy: { createdAt: 'desc' },
    take: 2000,
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      totalCents: true,
      balanceCents: true,
      status: true,
      companyId: true,
      company: { select: { name: true } },
      customer: { select: { name: true } },
    },
  })

  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )

  return rows.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customer.name,
    companyId: invoice.companyId,
    companyName: invoice.company.name,
    issued: invoice.issueDate,
    due: invoice.dueDate,
    totalCents: invoice.totalCents,
    balanceCents: invoice.balanceCents,
    status: invoice.status,
    // AGE IS A FACT ABOUT AN OUTSTANDING BALANCE. A paid invoice settled late is
    // not "90 days past due" — it is closed, and a bucket on it would put it in a
    // chip whose total is money somebody is chasing.
    bucket:
      invoice.balanceCents > 0 && invoice.dueDate !== null
        ? agingBucketFor(
            Math.floor((midnight - invoice.dueDate.getTime()) / 86_400_000),
          )
        : null,
  }))
}

export const invoiceShape: ListShape<InvoiceGridRow> = {
  searchText: (row) =>
    `${row.invoiceNumber} ${row.customerName} ${row.companyName}`,
  dateOf: (row) => row.issued,
  companyIdOf: (row) => row.companyId,
  sorts: {
    invoiceNumber: (row) => row.invoiceNumber,
    customer: (row) => row.customerName,
    issued: (row) => row.issued?.getTime() ?? null,
    due: (row) => row.due?.getTime() ?? null,
    total: (row) => row.totalCents,
    balance: (row) => row.balanceCents,
    status: (row) => row.status,
  },
  defaultSort: 'issued',
  defaultDir: 'desc',
}

// ── PAYMENTS ───────────────────────────────────────────────────────────────

export async function readPayments(
  tx: TxClient,
  scope: Scope,
): Promise<PaymentRow[]> {
  return listPayments(tx, scope)
}

export const paymentShape: ListShape<PaymentRow> = {
  searchText: (row) =>
    `${row.referenceNumber ?? ''} ${row.customerName} ${row.companyName}`,
  dateOf: (row) => row.receivedAt,
  companyIdOf: (row) => row.companyId,
  sorts: {
    received: (row) => row.receivedAt.getTime(),
    method: (row) => row.method,
    reference: (row) => row.referenceNumber,
    payer: (row) => row.customerName,
    authority: (row) => row.companyName,
    amount: (row) => row.amountCents,
    unapplied: (row) => row.unappliedCents,
    appliedTo: (row) => row.appliedToCount,
  },
  defaultSort: 'received',
  defaultDir: 'desc',
}

// ── PAYROLL → BATCHES ──────────────────────────────────────────────────────

export interface BatchCompanyRow {
  companyId: string
  companyName: string
  statements: number
  amountCents: number
}

export interface BatchGridRow {
  id: string
  batchNumber: string | null
  status: string
  createdAt: Date
  checkDate: Date
  statementDate: Date
  periodStart: Date
  periodEnd: Date
  statements: number
  amountCents: number
  /**
   * WHICH AUTHORITY CUTS THE CHEQUES — AND FOR ZEBRA THE ANSWER IS ALL OF THEM.
   *
   * Datatruck carries a real company here because a batch there belongs to one
   * payer: `SB-000448` is Dolphin's and `SB-000447` is RAM's, both covering
   * Sep 13-19. Zebra settles the organization in one run (Islom, 2026-09-11),
   * so the honest value is "all authorities" and the per-company split is the
   * breakdown directly beneath the row.
   *
   * THIS FIELD IS THE BREAKDOWN'S HEADLINE, NOT A MISSING COLUMN. It read
   * `not recorded` for a few hours, which described `schema.prisma` rather than
   * the money, and invited a migration that the shape does not need. Owner's
   * ruling, 2026-09-28: no `payCompanyId`.
   */
  payCompanyName: null
  notes: string | null
  /**
   * Settle together, report apart (Islom, 2026-09-11). The batch is the
   * organization's and its money is not, so each batch carries its authorities.
   */
  breakdown: BatchCompanyRow[]
}

export async function readBatches(
  tx: TxClient,
  scope: Scope,
): Promise<BatchGridRow[]> {
  const batches = await tx.settlementBatch.findMany({
    where: { deletedAt: null },
    orderBy: { periodStart: 'desc' },
    take: 500,
    select: {
      id: true,
      batchNumber: true,
      status: true,
      createdAt: true,
      checkDate: true,
      statementDate: true,
      periodStart: true,
      periodEnd: true,
      notes: true,
      settlements: {
        select: {
          id: true,
          netCents: true,
          loadLines: {
            select: {
              amountCents: true,
              load: {
                select: {
                  companyId: true,
                  company: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  // THE COMPANY SCOPE APPLIES TO THE BREAKDOWN, NOT TO THE BATCH. A batch is
  // org-wide by ruling, so hiding one because a scoped user cannot see one of its
  // authorities would hide the week itself. What narrows is which authorities'
  // rows they see under it — and the batch total stays the batch total, which is
  // §7.4.2's rule about an actionable figure.
  const allowed =
    'companyId' in scope && scope.companyId ? new Set(scope.companyId.in) : null

  return batches.map((batch) => {
    const perCompany = new Map<string, BatchCompanyRow>()
    let amountCents = 0

    for (const settlement of batch.settlements) {
      amountCents += settlement.netCents
      for (const line of settlement.loadLines) {
        const id = line.load.companyId
        if (allowed && !allowed.has(id)) continue
        const existing = perCompany.get(id)
        if (existing) {
          existing.amountCents += line.amountCents
        } else {
          perCompany.set(id, {
            companyId: id,
            companyName: line.load.company.name,
            statements: 0,
            amountCents: line.amountCents,
          })
        }
      }
      // A DRIVER COUNTS ONCE PER AUTHORITY THEY PULLED FOR, which is why this is
      // a second pass over the same lines: summing `statements` inside the loop
      // above would count a driver once per LOAD.
      const touched = new Set(
        settlement.loadLines
          .map((line) => line.load.companyId)
          .filter((id) => !allowed || allowed.has(id)),
      )
      for (const id of touched) {
        const row = perCompany.get(id)
        if (row) row.statements += 1
      }
    }

    return {
      id: batch.id,
      batchNumber: batch.batchNumber,
      status: batch.status,
      createdAt: batch.createdAt,
      checkDate: batch.checkDate,
      statementDate: batch.statementDate,
      periodStart: batch.periodStart,
      periodEnd: batch.periodEnd,
      statements: batch.settlements.length,
      amountCents,
      // Always null: the row's answer is "all authorities" and the names are on
      // `breakdown`. See the field's own note.
      payCompanyName: null,
      notes: batch.notes,
      breakdown: [...perCompany.values()].sort((left, right) =>
        left.companyName.localeCompare(right.companyName),
      ),
    }
  })
}

export const batchShape: ListShape<BatchGridRow> = {
  searchText: (row) =>
    `${row.batchNumber ?? ''} ${row.status} ${row.payCompanyName ?? ''} ${row.notes ?? ''}`,
  // §7.4.1 — CHECK DATE is what the range bounds here, and the bar says so. It is
  // the date somebody is looking for when they ask about a pay run; `createdAt` is
  // when a row was made, which is a fact about this software rather than the money.
  dateOf: (row) => row.checkDate,
  sorts: {
    batchNumber: (row) => row.batchNumber,
    status: (row) => row.status,
    created: (row) => row.createdAt.getTime(),
    checkDate: (row) => row.checkDate.getTime(),
    period: (row) => row.periodStart.getTime(),
    statements: (row) => row.statements,
    amount: (row) => row.amountCents,
    payCompany: (row) => row.payCompanyName,
  },
  defaultSort: 'period',
  defaultDir: 'desc',
  // WHAT THE FUNNELS MATCH ON. The STORED value, not the rendered one: a status
  // funnel typing "FINAL" has to work in Russian too, and the label is
  // translated while the enum is not (§12).
  columnFilters: {
    batchNumber: (row) => row.batchNumber,
    status: (row) => row.status,
    payCompany: (row) => row.payCompanyName,
    notes: (row) => row.notes,
  },
}

// ── PAYROLL → DRIVER STATEMENTS ────────────────────────────────────────────

export interface StatementGridRow {
  id: string
  settlementNumber: string | null
  driverId: string
  driverName: string
  unitNumber: string | null
  periodStart: Date
  periodEnd: Date
  grossCents: number
  deductionsCents: number
  otherPayCents: number
  netCents: number
  /**
   * THE BATCH'S STATUS WHERE THERE IS A BATCH, AND THE SETTLEMENT'S WHERE THERE
   * IS NOT.
   *
   * `Settlement.batchId` IS NULLABLE, which the compiler pointed out and I had
   * assumed away: settlements generated one driver at a time — the path
   * `/settlements` offered before this redesign — belong to no run. A statement's
   * state is its run's state when it has one, and its own when it does not, and
   * reading `batch.status` unconditionally would have thrown on exactly the rows
   * that predate batching.
   */
  status: string
  /** Null for a settlement that belongs to no run. */
  batchId: string | null
}

export async function readStatements(
  tx: TxClient,
  _scope: Scope,
): Promise<StatementGridRow[]> {
  // NO COMPANY SCOPE ON A STATEMENT, and it is not an oversight. One statement
  // spans every authority a driver pulled for (Islom, 2026-09-11) — there is no
  // company on it to filter by, and picking one of its load lines to stand in for
  // the whole document would put a driver's pay under an authority that owes part
  // of it. The company chip is absent from this grid for the same reason it is
  // absent from Payroll as a whole.
  const rows = await tx.settlement.findMany({
    // A DELETED BATCH HIDES ITS STATEMENTS; a missing one does not. `batch: null`
    // has to pass, or every pre-batch settlement disappears from the only screen
    // that lists them.
    where: {
      deletedAt: null,
      OR: [{ batchId: null }, { batch: { deletedAt: null } }],
    },
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'asc' }],
    take: 2000,
    select: {
      id: true,
      settlementNumber: true,
      unitNumber: true,
      earningsCents: true,
      deductionsCents: true,
      otherPayCents: true,
      netCents: true,
      driverId: true,
      driver: { select: { firstName: true, lastName: true } },
      // THE SETTLEMENT'S OWN PERIOD, not the batch's. They agree where both
      // exist — `generateSettlement` and `openBatch` both set it from the week —
      // and only this one is present for an unbatched row.
      periodStart: true,
      periodEnd: true,
      status: true,
      batch: { select: { id: true, status: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    settlementNumber: row.settlementNumber,
    driverId: row.driverId,
    driverName: `${row.driver.firstName} ${row.driver.lastName}`,
    unitNumber: row.unitNumber,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    grossCents: row.earningsCents,
    deductionsCents: row.deductionsCents,
    otherPayCents: row.otherPayCents,
    netCents: row.netCents,
    status: row.batch?.status ?? row.status,
    batchId: row.batch?.id ?? null,
  }))
}

export const statementShape: ListShape<StatementGridRow> = {
  searchText: (row) =>
    `${row.driverName} ${row.unitNumber ?? ''} ${row.settlementNumber ?? ''}`,
  dateOf: (row) => row.periodStart,
  sorts: {
    driver: (row) => row.driverName,
    period: (row) => row.periodStart.getTime(),
    unit: (row) => row.unitNumber,
    gross: (row) => row.grossCents,
    deductions: (row) => row.deductionsCents,
    net: (row) => row.netCents,
    status: (row) => row.status,
  },
  defaultSort: 'period',
  defaultDir: 'desc',
}

// ── PAYROLL → BALANCES (YTD per driver) ────────────────────────────────────

export interface BalanceGridRow {
  driverId: string
  driverName: string
  year: number
  /** From `DriverOpeningBalance` — what they brought into the year. */
  openingNetCents: number
  /** Settled in Zebra this year. FINAL and PAID only. */
  grossCents: number
  deductionsCents: number
  netCents: number
  weeks: number
  /** Opening + settled. The figure a statement's YTD column prints. */
  ytdNetCents: number
  escrowHeldCents: number
}

export async function readBalances(
  tx: TxClient,
  _scope: Scope,
  year: number,
): Promise<BalanceGridRow[]> {
  const from = new Date(Date.UTC(year, 0, 1))
  const to = new Date(Date.UTC(year + 1, 0, 1))

  const [drivers, opening, escrow] = await Promise.all([
    tx.settlement.groupBy({
      by: ['driverId'],
      where: {
        deletedAt: null,
        batch: {
          deletedAt: null,
          status: { in: ['FINAL', 'PAID'] },
          periodStart: { gte: from, lt: to },
        },
      },
      _sum: {
        earningsCents: true,
        deductionsCents: true,
        netCents: true,
      },
      _count: { _all: true },
    }),
    tx.driverOpeningBalance.findMany({
      where: { year, category: 'NET_PAY' },
      select: { driverId: true, amountCents: true },
    }),
    tx.driverEscrowEntry.groupBy({
      by: ['driverId'],
      _sum: { amountCents: true },
    }),
  ])

  const names = await tx.driver.findMany({
    where: {
      deletedAt: null,
      id: { in: drivers.map((row) => row.driverId) },
    },
    select: { id: true, firstName: true, lastName: true },
  })
  const nameOf = new Map(
    names.map((row) => [row.id, `${row.firstName} ${row.lastName}`]),
  )
  const openingOf = new Map(
    opening.map((row) => [row.driverId, row.amountCents]),
  )
  const escrowOf = new Map(
    escrow.map((row) => [row.driverId, row._sum.amountCents ?? 0]),
  )

  return (
    drivers
      // A DRIVER WITH NO NAME HERE IS A DELETED ONE. Their settlements stay — a
      // FINAL statement is a document somebody was handed — but they are not on a
      // list of who to pay, and a row reading "—" would be a person nobody can act
      // on sitting in a total.
      .filter((row) => nameOf.has(row.driverId))
      .map((row) => {
        const openingNetCents = openingOf.get(row.driverId) ?? 0
        const netCents = row._sum.netCents ?? 0
        return {
          driverId: row.driverId,
          driverName: nameOf.get(row.driverId) ?? '',
          year,
          openingNetCents,
          grossCents: row._sum.earningsCents ?? 0,
          deductionsCents: row._sum.deductionsCents ?? 0,
          netCents,
          weeks: row._count._all,
          ytdNetCents: openingNetCents + netCents,
          escrowHeldCents: escrowOf.get(row.driverId) ?? 0,
        }
      })
  )
}

export const balanceShape: ListShape<BalanceGridRow> = {
  searchText: (row) => row.driverName,
  sorts: {
    driver: (row) => row.driverName,
    weeks: (row) => row.weeks,
    opening: (row) => row.openingNetCents,
    gross: (row) => row.grossCents,
    deductions: (row) => row.deductionsCents,
    net: (row) => row.netCents,
    ytd: (row) => row.ytdNetCents,
    escrow: (row) => row.escrowHeldCents,
  },
  defaultSort: 'driver',
}

// ── ONE-TIME CHARGES ───────────────────────────────────────────────────────

export interface OneTimeGridRow {
  id: string
  driverId: string
  driverName: string
  type: string
  description: string
  /** SIGNED: negative is money off the driver, positive is money to them. */
  amountCents: number
  appliesOn: Date
  loadNumber: string | null
  settledAt: Date | null
}

export async function readOneTimeCharges(
  tx: TxClient,
  scope: Scope,
  window?: { from: Date; to: Date },
): Promise<OneTimeGridRow[]> {
  const rows = await tx.settlementCharge.findMany({
    where: {
      driver: { deletedAt: null, ...scope },
      ...(window ? { appliesOn: { gte: window.from, lte: window.to } } : {}),
    },
    orderBy: { appliesOn: 'desc' },
    take: 2000,
    select: {
      id: true,
      type: true,
      description: true,
      amountCents: true,
      appliesOn: true,
      settledAt: true,
      driverId: true,
      driver: { select: { firstName: true, lastName: true } },
      load: { select: { loadNumber: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    driverId: row.driverId,
    driverName: `${row.driver.firstName} ${row.driver.lastName}`,
    type: row.type,
    description: row.description,
    amountCents: row.amountCents,
    appliesOn: row.appliesOn,
    loadNumber: row.load?.loadNumber ?? null,
    settledAt: row.settledAt,
  }))
}

export const oneTimeShape: ListShape<OneTimeGridRow> = {
  searchText: (row) =>
    `${row.driverName} ${row.type} ${row.description} ${row.loadNumber ?? ''}`,
  dateOf: (row) => row.appliesOn,
  sorts: {
    driver: (row) => row.driverName,
    type: (row) => row.type,
    description: (row) => row.description,
    amount: (row) => row.amountCents,
    appliesOn: (row) => row.appliesOn.getTime(),
    settled: (row) => row.settledAt?.getTime() ?? null,
  },
  defaultSort: 'appliesOn',
  defaultDir: 'desc',
}

// ── SCHEDULED PAYMENTS (recurring deductions) ──────────────────────────────

export async function readScheduled(
  tx: TxClient,
  scope: Scope,
): Promise<ChargeRow[]> {
  return listCharges(tx, scope)
}

export const scheduledShape: ListShape<ChargeRow> = {
  searchText: (row) =>
    `${row.driverName} ${row.type} ${row.description ?? ''} ${row.companyName}`,
  dateOf: (row) => row.effectiveFrom,
  companyIdOf: (row) => row.companyId,
  sorts: {
    driver: (row) => row.driverName,
    type: (row) => row.type,
    amount: (row) => row.amountCents,
    cadence: (row) => row.cadence,
    target: (row) => row.targetCents,
    from: (row) => row.effectiveFrom.getTime(),
    to: (row) => row.effectiveTo?.getTime() ?? null,
  },
  defaultSort: 'driver',
}

/**
 * Which recurring rules touch one week — Payroll's Scheduled payments tab.
 *
 * ── THIS IS THE DIFFERENCE BETWEEN TWO SCREENS ────────────────────────────
 *
 * §6.2 names it: Charges is org-wide and every week, "who is not paying
 * insurance", answerable with no batch. This tab is what comes off THIS run. A
 * rule dormant until November appears on the first and not the second, and
 * without that difference the two grids would be one grid twice.
 *
 * OVERLAP, NOT CONTAINMENT: a rule that starts mid-week or ends mid-week applies
 * to that week, which is what the engine's `ruleInForce` decides for a period.
 */
export function scheduledForWeek(
  rows: readonly ChargeRow[],
  period: { start: Date; end: Date },
): ChargeRow[] {
  return rows.filter(
    (row) =>
      row.effectiveFrom.getTime() <= period.end.getTime() &&
      (row.effectiveTo === null ||
        row.effectiveTo.getTime() >= period.start.getTime()),
  )
}
