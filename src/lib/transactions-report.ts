import { Prisma } from '@/generated/prisma/client'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// EVERY PAY LINE IN A WINDOW, BY DRIVER (§6.2.10 part 4).
//
// ── A UNION OF THE THREE LINE TABLES, NOT A FOURTH COPY ───────────────────
//
// A statement prints three kinds of row and stores them in three tables:
// `SettlementLoadLine` (what a trip paid), `SettlementLine` (every other typed
// line — accessorial pay, bonus, reimbursement, the typed deductions) and
// `SettlementDeductionLine` (the deductions the statement printed, with the
// charge they came from). This report reads all three as they are and lays them
// end to end. It writes nothing and derives nothing new: a row here IS a row on
// a statement somebody can open.
//
// ── THE OFFICE'S FOUR WORDS, MAPPED ONCE ──────────────────────────────────
//
// Datatruck's transactions report says trip pay / deduction / advance /
// adjustment. The schema has no "adjustment"; it has BONUS and REIMBURSEMENT,
// which are the two things an office adds to a statement by hand. The table in
// §6.2.10 part 4 is the mapping, and this file is its only implementation.
//
// ── SIGNS ARE THE LEDGER'S ────────────────────────────────────────────────
//
// Deductions are stored negative and stay negative here. §6.2.7's donut flips
// them because four negative slices are unreadable; a transactions list is read
// DOWN to a net, so the foot of this report sums to what the statements netted
// — which is the agreement test.
//
// ── THE DEDUCTION CATEGORY COMES FROM §6.2.7's OWN CASE ───────────────────
//
// Source beating label — a line whose rule id is a StandingCharge is the
// organization's own charge whatever it prints under — in the same SQL as that
// report, so two screens cannot categorise one line two ways.
// ---------------------------------------------------------------------------

export type TransactionKind = 'tripPay' | 'advance' | 'deduction' | 'adjustment'
export type DeductionCategory = 'standing' | 'fuelTolls' | 'advances' | 'other'

export interface TransactionRow {
  /** One of three tables, so a row can be traced to the statement line it is. */
  source: 'load' | 'line' | 'deduction'
  lineId: string
  settlementId: string
  settlementNumber: string
  batchId: string | null
  driverId: string
  driverName: string
  companyId: string
  companyName: string
  /** The statement's period end — the date the week was settled to. */
  periodEnd: Date
  kind: TransactionKind
  /** Only on a deduction; §6.2.7's category. */
  category: DeductionCategory | null
  /** The load this line paid for, when it paid for one. */
  loadNumber: string | null
  description: string
  /** Signed as stored. Deductions are negative. */
  amountCents: number
}

export interface TransactionsWindow {
  from: Date
  to: Date
  /** One authority, or null for every authority in scope. */
  companyId: string | null
  /** One driver, or null for all. */
  driverId?: string | null
}

/**
 * The rows, newest period first, then by statement and the statement's own
 * line order — which is the order the statement prints them in.
 *
 * VOID STATEMENTS CONTRIBUTE NOTHING. A struck statement's lines are history of
 * a document that no longer counts, and a ledger that listed them would net to
 * the wrong number.
 */
export async function transactionsInWindow(
  tx: TxClient,
  window: TransactionsWindow,
): Promise<TransactionRow[]> {
  const company =
    window.companyId === null
      ? Prisma.empty
      : Prisma.sql`AND s."companyId" = ${window.companyId}`
  const driver =
    window.driverId === null || window.driverId === undefined
      ? Prisma.empty
      : Prisma.sql`AND s."driverId" = ${window.driverId}`

  // ONE STATEMENT FILTER, SPLICED INTO ALL THREE HALVES, so the three cannot
  // disagree about which statements are in the window.
  const statements = Prisma.sql`
    FROM "Settlement" s
    JOIN "Driver" d ON d."id" = s."driverId"
    JOIN "Company" c ON c."id" = s."companyId"
    WHERE s."status" <> 'VOID'
      AND s."periodEnd" >= ${window.from}
      AND s."periodEnd" <= ${window.to}
      ${company}
      ${driver}
  `

  const rows = await tx.$queryRaw<
    Array<{
      source: 'load' | 'line' | 'deduction'
      lineId: string
      settlementId: string
      settlementNumber: string
      batchId: string | null
      driverId: string
      driverName: string
      companyId: string
      companyName: string
      periodEnd: Date
      kind: TransactionKind
      category: DeductionCategory | null
      loadNumber: string | null
      description: string
      amountCents: number
      sortOrder: number
    }>
  >`
    SELECT 'load' AS source, ll."id" AS "lineId", s."id" AS "settlementId",
           s."settlementNumber", s."batchId", s."driverId",
           d."firstName" || ' ' || d."lastName" AS "driverName",
           s."companyId", c."name" AS "companyName", s."periodEnd",
           'tripPay' AS kind, NULL::text AS category,
           ll."loadNumber", ll."loadNumber" AS description,
           ll."amountCents", ll."sortOrder"
      FROM "SettlementLoadLine" ll
      JOIN "Settlement" s ON s."id" = ll."settlementId"
      JOIN "Driver" d ON d."id" = s."driverId"
      JOIN "Company" c ON c."id" = s."companyId"
     WHERE s."status" <> 'VOID'
       AND s."periodEnd" >= ${window.from} AND s."periodEnd" <= ${window.to}
       ${company} ${driver}

    UNION ALL

    SELECT 'line', l."id", s."id", s."settlementNumber", s."batchId", s."driverId",
           d."firstName" || ' ' || d."lastName", s."companyId", c."name", s."periodEnd",
           CASE
             WHEN l."type" IN ('LOAD_PAY', 'ACCESSORIAL_PAY') THEN 'tripPay'
             WHEN l."type" = 'DEDUCTION_ADVANCE' THEN 'advance'
             WHEN l."type" IN ('BONUS', 'REIMBURSEMENT') THEN 'adjustment'
             ELSE 'deduction'
           END,
           NULL::text,
           ld."loadNumber", l."description", l."amountCents", l."sortOrder"
      FROM "SettlementLine" l
      JOIN "Settlement" s ON s."id" = l."settlementId"
      JOIN "Driver" d ON d."id" = s."driverId"
      JOIN "Company" c ON c."id" = s."companyId"
      LEFT JOIN "Load" ld ON ld."id" = l."loadId"
     WHERE s."status" <> 'VOID'
       AND s."periodEnd" >= ${window.from} AND s."periodEnd" <= ${window.to}
       ${company} ${driver}

    UNION ALL

    SELECT 'deduction', dl."id", s."id", s."settlementNumber", s."batchId", s."driverId",
           d."firstName" || ' ' || d."lastName", s."companyId", c."name", s."periodEnd",
           -- THE ENGINE KEEPS ADVANCES AND REIMBURSEMENTS IN THIS TABLE under
           -- their own labels and ADDS them to net (settlement-week.ts: "their
           -- own summary rows on the artefact"). A reimbursement is pay put on
           -- by hand — the office's adjustment — and must not be filed as a
           -- deduction because of which table it sits in.
           CASE
             WHEN dl."type" IN ('Advance', 'Advances') THEN 'advance'
             WHEN dl."type" IN ('Reimbursement', 'Reimbursements', 'Bonus') THEN 'adjustment'
             ELSE 'deduction'
           END,
           -- §6.2.7's category, and ONLY on a deduction: a category on an
           -- advance or a reimbursement would be a word about money that does
           -- not come off the cheque.
           CASE
             WHEN dl."type" IN ('Advance', 'Advances', 'Reimbursement', 'Reimbursements', 'Bonus') THEN NULL
             WHEN EXISTS (SELECT 1 FROM "StandingCharge" sc WHERE sc."id" = dl."recurringDeductionId") THEN 'standing'
             WHEN dl."type" IN ('Fuel', 'Toll', 'Tolls') THEN 'fuelTolls'
             ELSE 'other'
           END,
           NULL::text, dl."description", dl."totalCents", dl."sortOrder"
      FROM "SettlementDeductionLine" dl
      JOIN "Settlement" s ON s."id" = dl."settlementId"
      JOIN "Driver" d ON d."id" = s."driverId"
      JOIN "Company" c ON c."id" = s."companyId"
     WHERE s."status" <> 'VOID'
       AND s."periodEnd" >= ${window.from} AND s."periodEnd" <= ${window.to}
       ${company} ${driver}

    ORDER BY "periodEnd" DESC, "settlementNumber" ASC, "sortOrder" ASC
  `

  // `statements` is kept as the single definition of the window for the
  // agreement reader below; the union above restates it per half because a CTE
  // cannot be parameterised into three SELECTs through Prisma's tagged template
  // without duplicating the bind parameters anyway.
  void statements

  return rows.map(({ sortOrder: _order, ...row }) => row)
}

/**
 * What the statements in the window NETTED, per driver — the other side of the
 * agreement test, read off `Settlement.netCents` rather than re-added from lines.
 */
export async function statementNetByDriver(
  tx: TxClient,
  window: TransactionsWindow,
): Promise<Map<string, number>> {
  const rows = await tx.settlement.groupBy({
    by: ['driverId'],
    where: {
      status: { not: 'VOID' },
      periodEnd: { gte: window.from, lte: window.to },
      ...(window.companyId === null ? {} : { companyId: window.companyId }),
      ...(window.driverId ? { driverId: window.driverId } : {}),
    },
    _sum: { netCents: true },
  })
  return new Map(rows.map((row) => [row.driverId, row._sum.netCents ?? 0]))
}

/** The report's own rows, summed per driver — the side the screen shows. */
export function rowsNetByDriver(
  rows: readonly TransactionRow[],
): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    out.set(row.driverId, (out.get(row.driverId) ?? 0) + row.amountCents)
  }
  return out
}
