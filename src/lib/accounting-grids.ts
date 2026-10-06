import { Prisma, type OwnershipType } from '@/generated/prisma/client'
import { companyScopeFilter } from './tenancy'
import { listPayments, type PaymentRow } from './payments'
import { listCharges, type ChargeRow } from './driver-deductions'
import type { StandingChargeListRow } from './standing-charges'
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
  /**
   * SOLD, not ours to collect. The Factored tab is this field (§6.2).
   *
   * It is carried on the row rather than queried per tab because the aging
   * chips and the totals have to be able to EXCLUDE it: a factored invoice is
   * not a receivable, and counting one in "over 90 days" is chasing money
   * somebody else already paid us for.
   */
  isFactored: boolean
  /** Null when nothing is outstanding — a paid invoice has no age. */
  bucket: AgingBucket | null
  /**
   * PAST ITS DUE DATE AT ALL — one day counts.
   *
   * NOT `bucket !== 'current'`, which is the trap: `agingBucketFor` calls the
   * first THIRTY days "current", so a bucket test would call an invoice eight
   * days late on-time. §6.2.8's Overdue figure sums everything past due, and
   * this is the row-level form of the same predicate so the strip and the list
   * it links to cannot disagree.
   */
  isOverdue: boolean
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
      isFactored: true,
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
    isFactored: invoice.isFactored,
    // AGE IS A FACT ABOUT AN OUTSTANDING BALANCE. A paid invoice settled late is
    // not "90 days past due" — it is closed, and a bucket on it would put it in a
    // chip whose total is money somebody is chasing.
    bucket:
      invoice.balanceCents > 0 && invoice.dueDate !== null
        ? agingBucketFor(
            Math.floor((midnight - invoice.dueDate.getTime()) / 86_400_000),
          )
        : null,
    // WHOLE DAYS FROM THE SAME MIDNIGHT, so this does not depend on the time of
    // day somebody opened the screen — and matches the `::date` subtraction the
    // strip's SQL does.
    isOverdue:
      invoice.balanceCents > 0 &&
      invoice.dueDate !== null &&
      Math.floor((midnight - invoice.dueDate.getTime()) / 86_400_000) > 0,
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
  // ── THE STATUS FILTER (§6.2, 2026-09-30) ────────────────────────────────
  //
  // A funnel that writes the same query parameter the filter bar renders as a
  // chip, which is what §6.2.1 settled: two handles on one filter, and a
  // filtered grid stays a link somebody can send.
  //
  // KEYED ON THE STORED VALUE, not the translated label. An accountant
  // filtering in Russian and pasting the URL to somebody reading English must
  // land on the same rows (§7.1.5's reasoning about codes, applied to a
  // filter).
  columnFilters: {
    status: (row) => row.status,
    // ── THE STATE THE SUMMARY STRIP LINKS BY (§6.2.8) ─────────────────────
    //
    // Each figure on the strip is a link, and the link has to open the rows the
    // figure summed or the tie-to-the-cent claim is decoration.
    //
    // AN OVERDUE ROW ANSWERS TO BOTH 'open' AND 'overdue', which it does by
    // returning both words: `applyList` matches a column filter with
    // `includes`, so one row can belong to a state and to its subset. That is
    // deliberate rather than clever — Overdue IS part of Open (§6.2.8), and a
    // single-valued state would make `?state=open` exclude the overdue rows and
    // under-report the figure it was linked from.
    //
    // 'settled' IS NOT ON THE STRIP and exists so the three states partition the
    // list: a paid or written-off invoice is neither open nor factored.
    // 'unissued' COMES FIRST AND IS NOT ON THE STRIP. A DRAFT has been shown to
    // nobody and a VOID was withdrawn, so neither is money anybody owes — the
    // strip's own predicate excludes both, and a state function that called them
    // open made `?state=open` list a draft under a figure that did not count it.
    // Found by the agreement test, by exactly the draft's 111,111.
    state: (row) =>
      row.status === 'DRAFT' || row.status === 'VOID'
        ? 'unissued'
        : row.isFactored
          ? 'factored'
          : row.balanceCents <= 0 || row.status === 'WRITTEN_OFF'
            ? 'settled'
            : row.isOverdue
              ? 'open overdue'
              : 'open',
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
  /** NET: what the cheques were written for. The column headed Amount. */
  amountCents: number
  /**
   * GROSS and DEDUCTIONS, for §6.2.9's three money columns.
   *
   * THEY ARE NOT AN EQUATION WITH `amountCents`:
   * net = gross − deductions + reimbursements + other pay, so a reader
   * subtracting two of these columns will be out by whatever was added back.
   * The doc says so where somebody would check, and the columns are not placed
   * side by side inviting the subtraction.
   */
  grossCents: number
  deductionsCents: number
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
  // ── TWO GROUPED READS, AND THE MEASUREMENT THAT SHAPED THEM ────────────
  //
  // Owner's ruling, 2026-09-29: item 7's shape — group in SQL, as
  // `grossByCompany` does.
  //
  // THE FIRST THING THE MEASUREMENT SAID WAS THAT THE PREMISE WAS WRONG. The
  // previous version was ALREADY one statement: `relationJoins` collapses a
  // nested include into one lateral join, so there was never an N+1 to remove.
  // What it did was carry every settlement and all 827 of its load lines across
  // the wire to add them up in the worker and produce fourteen rows.
  //
  // THE SECOND THING IT SAID WAS THAT THREE STATEMENTS ARE SLOWER THAN ONE
  // HERE. Measured on dev, four batches and 141 settlements, best of three:
  //
  //   ONE   relation-join read, 827 lines transferred   265ms   1 statement
  //   THREE grouped reads, 14 rows transferred          761ms   3 statements
  //   TWO   grouped reads, 14 rows transferred          514ms   2 statements
  //
  // Three round trips cost 761ms and two cost 514ms — about 250ms each, which
  // is the link, and it is why the payload saving does not show yet.
  //
  // At roughly 250ms to us-east-2 the ROUND TRIP is the cost and the payload is
  // not, on a dataset this size. So the batch rows and their totals are folded
  // into one grouped statement rather than three, which is the shape that is
  // both item 7's and the cheapest available.
  //
  // AND AT 514ms IT IS STILL SLOWER THAN THE 265ms SINGLE READ. It is kept
  // because the
  // thing that grows is load lines — 827 now, and a year of weeks is tens of
  // thousands — while this transfers `batches × authorities` whatever happens.
  // The crossover is soon and the old shape has no ceiling. That is a judgement
  // about the future, so it is written here as one rather than dressed up as a
  // speed-up: on today's data this change costs about 250ms.
  const rows = await tx.$queryRaw<
    {
      id: string
      batch_number: string | null
      status: string
      created_at: Date
      check_date: Date
      statement_date: Date
      period_start: Date
      period_end: Date
      notes: string | null
      statements: bigint
      amount: bigint
      gross: bigint
      deductions: bigint
    }[]
  >`
    SELECT
      b."id"                                   AS id,
      b."batchNumber"                          AS batch_number,
      b."status"::text                         AS status,
      b."createdAt"                            AS created_at,
      b."checkDate"                            AS check_date,
      b."statementDate"                        AS statement_date,
      b."periodStart"                          AS period_start,
      b."periodEnd"                            AS period_end,
      b."notes"                                AS notes,
      COUNT(st."id")::bigint                   AS statements,
      COALESCE(SUM(st."netCents"), 0)::bigint  AS amount,
      -- NO EXTRA QUERY: the same grouped read, two more sums. §6.2.9.
      COALESCE(SUM(st."grossCents"), 0)::bigint AS gross,
      COALESCE(SUM(st."deductionsCents"), 0)::bigint AS deductions
    FROM "SettlementBatch" b
    LEFT JOIN "Settlement" st
      ON st."batchId" = b."id" AND st."deletedAt" IS NULL
    WHERE b."deletedAt" IS NULL
    GROUP BY b."id"
    ORDER BY b."periodStart" DESC
    LIMIT 500
  `
  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)

  // ── THE BREAKDOWN, GROUPED IN POSTGRES ─────────────────────────────────
  //
  // `COUNT(DISTINCT st."id")` is the part worth reading twice: a driver counts
  // ONCE per authority they pulled for, however many of that authority's loads
  // they ran. The hand-rolled version needed a second pass over the same lines
  // to avoid counting a driver once per LOAD; here the database does it, and
  // getting it wrong would have inflated every authority's statement count.
  const breakdownRows = await tx.$queryRaw<
    {
      batch_id: string
      company_id: string
      company_name: string
      statements: bigint
      amount: bigint
    }[]
  >`
    SELECT
      st."batchId"                    AS batch_id,
      l."companyId"                   AS company_id,
      c."name"                        AS company_name,
      COUNT(DISTINCT st."id")::bigint AS statements,
      SUM(line."amountCents")::bigint AS amount
    FROM "SettlementLoadLine" line
    JOIN "Settlement" st ON st."id" = line."settlementId"
    JOIN "Load" l        ON l."id"  = line."loadId"
    JOIN "Company" c     ON c."id"  = l."companyId"
    WHERE st."batchId" IN (${Prisma.join(ids)})
      AND st."deletedAt" IS NULL
    GROUP BY st."batchId", l."companyId", c."name"
    ORDER BY c."name"
  `

  // THE COMPANY SCOPE NARROWS THE BREAKDOWN, NOT THE BATCH. A batch is org-wide
  // by ruling, so hiding one because a scoped user cannot see one of its
  // authorities would hide the week itself. What narrows is which authorities'
  // rows they see under it — and the batch total stays the batch total, which
  // is §7.4.2's rule about an actionable figure.
  const allowed =
    'companyId' in scope && scope.companyId ? new Set(scope.companyId.in) : null

  const breakdownOf = new Map<string, BatchCompanyRow[]>()
  for (const row of breakdownRows) {
    if (allowed && !allowed.has(row.company_id)) continue
    const list = breakdownOf.get(row.batch_id) ?? []
    list.push({
      companyId: row.company_id,
      companyName: row.company_name,
      statements: Number(row.statements),
      amountCents: Number(row.amount),
    })
    breakdownOf.set(row.batch_id, list)
  }

  return rows.map((row) => ({
    id: row.id,
    batchNumber: row.batch_number,
    status: row.status,
    createdAt: row.created_at,
    checkDate: row.check_date,
    statementDate: row.statement_date,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    statements: Number(row.statements),
    amountCents: Number(row.amount),
    grossCents: Number(row.gross),
    deductionsCents: Number(row.deductions),
    // Always null: the row's answer is "all authorities" and the names are on
    // `breakdown`. See the field's own note.
    payCompanyName: null,
    notes: row.notes,
    breakdown: breakdownOf.get(row.id) ?? [],
  }))
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
  /** §6.2.10 part 6 — the driver's CURRENT type; the frozen copy is migration 66. */
  driverType: OwnershipType
  unitNumber: string | null
  periodStart: Date
  periodEnd: Date
  grossCents: number
  deductionsCents: number
  otherPayCents: number
  netCents: number
  /** `SB-000001`, or null for a settlement that belongs to no run. */
  batchNumber: string | null
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
      driver: {
        select: { firstName: true, lastName: true, employmentType: true },
      },
      // THE SETTLEMENT'S OWN PERIOD, not the batch's. They agree where both
      // exist — `generateSettlement` and `openBatch` both set it from the week —
      // and only this one is present for an unbatched row.
      periodStart: true,
      periodEnd: true,
      status: true,
      // THE NUMBER, NOT JUST THE ID. The batch filter narrows on what a
      // reader knows the run by — `SB-000001` — and an id in a filter chip
      // is something nobody can type or recognise.
      batch: { select: { id: true, status: true, batchNumber: true } },
    },
  })

  // ── DEDUCTIONS: EVERY NET-REDUCING LINE, COMPUTED (§6.2.6) ───────────
  //
  // NOT `Settlement.deductionsCents`, which two paths write with OPPOSITE
  // SIGNS. The batch engine sums `SettlementDeductionLine.totalCents` and
  // those are negative; `refreshTotals` sums `-amountCents` from
  // `SettlementLine` and those are positive. Dev holds both — one settlement
  // at -45000 beside two at +45000 — so a column rendering that field shows
  // `-$450.00` beside `$450.00` for the same kind of charge, and its footer
  // sums them AGAINST each other.
  //
  // THE TWO TABLES NEVER BOTH CARRY ROWS for one settlement — a settlement's
  // charges live in one or the other depending on which path made it, 0 of
  // 142 on dev have both — so summing across both cannot double-count. That
  // was checked before this was written, because a fix that double-counted
  // would be worse than the sign bug it replaced.
  //
  // TWO GROUPED QUERIES, NOT A JOIN PER ROW. The grid takes 2000
  // settlements; reading their lines individually is the N+1 this codebase
  // has been bitten by before.
  const ids = rows.map((row) => row.id)
  const [lineSums, chargeSums] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          tx.settlementLine.groupBy({
            by: ['settlementId'],
            where: { settlementId: { in: ids }, amountCents: { lt: 0 } },
            _sum: { amountCents: true },
          }),
          tx.settlementDeductionLine.groupBy({
            by: ['settlementId'],
            where: { settlementId: { in: ids }, totalCents: { lt: 0 } },
            _sum: { totalCents: true },
          }),
        ])

  const reducing = new Map<string, number>()
  for (const group of lineSums) {
    reducing.set(
      group.settlementId,
      (reducing.get(group.settlementId) ?? 0) - (group._sum.amountCents ?? 0),
    )
  }
  for (const group of chargeSums) {
    reducing.set(
      group.settlementId,
      (reducing.get(group.settlementId) ?? 0) - (group._sum.totalCents ?? 0),
    )
  }

  return rows.map((row) => ({
    id: row.id,
    settlementNumber: row.settlementNumber,
    driverId: row.driverId,
    driverName: `${row.driver.firstName} ${row.driver.lastName}`,
    driverType: row.driver.employmentType,
    unitNumber: row.unitNumber,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    grossCents: row.earningsCents,
    // A POSITIVE MAGNITUDE UNDER A COLUMN HEADED DEDUCTIONS. The heading
    // carries the direction; a minus sign as well would read as a credit.
    deductionsCents: reducing.get(row.id) ?? 0,
    otherPayCents: row.otherPayCents,
    netCents: row.netCents,
    status: row.batch?.status ?? row.status,
    batchId: row.batch?.id ?? null,
    batchNumber: row.batch?.batchNumber ?? null,
  }))
}

export const statementShape: ListShape<StatementGridRow> = {
  searchText: (row) =>
    `${row.driverName} ${row.unitNumber ?? ''} ${row.settlementNumber ?? ''}`,
  dateOf: (row) => row.periodStart,
  sorts: {
    driver: (row) => row.driverName,
    // SORTABLE, NOT FUNNEL-ABLE (§6.2.10 part 6): the funnel matches the
    // stored value, and `OWNED` is not what anybody types for a company
    // driver. It gets a funnel when the enum gets its name.
    driverType: (row) => row.driverType,
    period: (row) => row.periodStart.getTime(),
    unit: (row) => row.unitNumber,
    gross: (row) => row.grossCents,
    deductions: (row) => row.deductionsCents,
    net: (row) => row.netCents,
    status: (row) => row.status,
    batch: (row) => row.batchNumber,
  },
  // §6.2.6 — funnels that write the same parameter the filter bar renders as
  // a chip, so a narrowed grid stays a link somebody can send.
  columnFilters: {
    status: (row) => row.status,
    batch: (row) => row.batchNumber,
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
 * Payroll → Charges → Standing (§6.2.4, migration 61).
 *
 * ── NO `companyIdOf`, AND THAT IS THE MODEL RATHER THAN AN OMISSION ───────
 *
 * Every other shape in this file carries one, because every other row belongs to
 * an operating authority. A standing charge belongs to the ORGANIZATION and has
 * no `companyId` column at all — it is the group's rule, which is the whole
 * reason it is not on the Scheduled tab. Supplying a company accessor here would
 * mean inventing one, and the company chip would then filter a list by a field
 * nobody set.
 *
 * SORTED BY TYPE, not by a driver there is none of. `Admin Fee` beside `Ifta`
 * beside `Insurance` is how somebody reads this list: it is short, and the
 * question is what the organization charges.
 */
export const standingShape: ListShape<StandingChargeListRow> = {
  searchText: (row) =>
    `${row.type} ${row.description ?? ''} ${row.appliesTo} ${row.notes ?? ''}`,
  dateOf: (row) => row.effectiveFrom,
  sorts: {
    type: (row) => row.type,
    appliesTo: (row) => row.appliesTo,
    amount: (row) => row.amountCents,
    cadence: (row) => row.cadence,
    exempt: (row) => row.exemptCount,
    from: (row) => row.effectiveFrom.getTime(),
    to: (row) => row.effectiveTo?.getTime() ?? null,
  },
  defaultSort: 'type',
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
