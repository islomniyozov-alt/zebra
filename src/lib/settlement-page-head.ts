import { Prisma } from '@/generated/prisma/client'
import type {
  DriverType,
  PaymentMethod,
  SettlementBatchStatus,
  SettlementLineType,
  SettlementStatus,
} from '@/generated/prisma/client'
import type { TenantReader } from './tenancy'
import { asDate, asNumber } from './sql-json'
import { keyFor, type StoredColumnRow } from './grid-columns'
import type { FuelAndTolls, StatementNeighbours } from './statement-workbench'

// ---------------------------------------------------------------------------
// /settlements/[id] — THE PAGE'S OWN READS IN ONE STATEMENT (§6.2.2 v11.09;
// owner's ruling 2026-11-15: "page's own reads only to one call;
// batchInputForOrg stays as it is, no second spelling").
//
// Before, the statement page opened a transaction for the settlement and then
// four more side by side — fuel and tolls, the trips grid's column memory,
// the four neighbours, and on a draft the addable trips. Here the first four
// are ONE SELECT with a named CTE each, sent through a `TenantReader`, and no
// transaction.
//
// THE ADDABLE TRIPS ARE NOT HERE. `addableTrips` reads through
// `batchInputForOrg`, the money engine's reader, and stays in a transaction
// of its own on a draft the role may edit.
//
// EACH CTE IS A SECOND SPELLING of a read other code still makes
// (`fuelAndTollsFor`, `statementNeighbours`, `readGridColumns`, and the page's
// own `settlement.findUnique`), so the enforcer is named:
// `tests/integration/settlement-page-head.test.ts` holds every field equal to
// those reads, on a statement with a row on both sides of every filter.
// ---------------------------------------------------------------------------

export const SETTLEMENT_TRIPS_GRID = 'settlements.trips' as const

export interface SettlementPageSettlement {
  id: string
  settlementNumber: string
  periodStart: Date
  periodEnd: Date
  status: SettlementStatus
  grossCents: number
  earningsCents: number
  deductionsCents: number
  reimbursementsCents: number
  advancesCents: number
  otherPayCents: number
  netCents: number
  milesHundredths: number
  approvedAt: Date | null
  paidAt: Date | null
  paymentMethod: PaymentMethod | null
  paymentReference: string | null
  unitNumber: string | null
  payTariffLabel: string | null
  driverType: DriverType | null
  payoutDate: Date | null
  batchId: string | null
  /** The statement's notes, for the Attachments & notes tab (step 4). */
  notes: string | null
  company: { name: string }
  driver: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    driverType: DriverType
  }
  _count: { documents: number }
  batch: {
    id: string
    batchNumber: string | null
    status: SettlementBatchStatus
    statementDate: Date
    checkDate: Date
  } | null
  loadLines: {
    id: string
    loadId: string
    loadNumber: string
    companyName: string
    puPlace: string
    delPlace: string
    puDate: Date
    delDate: Date
    grossCents: number
    milesHundredths: number
    amountCents: number
    referenceNumber: string | null
    load: { referenceNumber: string | null; operationalStatus: string }
  }[]
  lines: {
    id: string
    type: SettlementLineType
    description: string
    amountCents: number
    payRuleSnapshot: Prisma.JsonValue
    load: { id: string; loadNumber: string } | null
  }[]
}

/**
 * What the seven tabs show that the header did not already read (TMS
 * §6.2.10 part 7 step 4): the batch's own deduction lines, and the fuel and
 * toll rows the Fuel & tolls figure sums.
 */
export interface SettlementTabRows {
  /** A batch statement's deductions and other pay (`SettlementDeductionLine`). */
  deductionLines: {
    id: string
    type: string
    description: string
    quantity: number
    rateCents: number
    totalCents: number
    recurringDeductionId: string | null
  }[]
  /** The driver's fuel in the period — the rows `fuel_count` counts. */
  fuelRows: {
    id: string
    purchasedAt: Date
    vendorName: string | null
    city: string | null
    state: string | null
    /** `Decimal(10,3)` as its text, three places. */
    gallons: string
    totalCents: number
    settlementId: string | null
  }[]
  /** The driver's toll expenses in the period — the rows `toll_count` counts. */
  tollRows: {
    id: string
    incurredAt: Date
    vendorName: string | null
    amountCents: number
    isDriverDeduction: boolean
  }[]
}

export interface SettlementPageHead {
  settlement: SettlementPageSettlement
  fuel: FuelAndTolls
  columnsRow: StoredColumnRow | null
  neighbours: StatementNeighbours
  tabs: SettlementTabRows
}

type Stamp = string | Date
type Json = Record<string, unknown>

interface HeadRow {
  settlement: Json | null
  load_lines: Json[]
  lines: Json[]
  deduction_lines: Json[]
  fuel_rows: Json[]
  toll_rows: Json[]
  fuel: Json | null
  columns: StoredColumnRow | null
  prev_in_batch: { id: string; settlementNumber: string } | null
  next_in_batch: { id: string; settlementNumber: string } | null
  prev_period: { id: string; periodStart: Stamp; periodEnd: Stamp } | null
  next_period: { id: string; periodStart: Stamp; periodEnd: Stamp } | null
}

const date = (value: unknown): Date => asDate(value) ?? new Date(NaN)

export async function readSettlementPageHead(
  reader: TenantReader,
  input: { settlementId: string; userId: string },
): Promise<SettlementPageHead | null> {
  const rows = await reader.read<HeadRow>(Prisma.sql`
    WITH s AS (
      SELECT s.*, c.name AS company_name,
             json_build_object('id', d.id, 'firstName', d."firstName",
               'lastName', d."lastName", 'email', d.email,
               'driverType', d."driverType"::text) AS driver_row,
             (SELECT count(*)::int FROM "Document" doc
               WHERE doc."settlementId" = s.id) AS documents,
             (SELECT json_build_object('id', b.id, 'batchNumber', b."batchNumber",
                       'status', b.status::text, 'statementDate', b."statementDate",
                       'checkDate', b."checkDate")
                FROM "SettlementBatch" b WHERE b.id = s."batchId") AS batch_row
        FROM "Settlement" s
        JOIN "Company" c ON c.id = s."companyId"
        JOIN "Driver" d ON d.id = s."driverId"
       WHERE s.id = ${input.settlementId}
    ),
    load_lines AS (
      SELECT ll.id, ll."loadId", ll."loadNumber", ll."companyName",
             ll."puPlace", ll."delPlace", ll."puDate", ll."delDate",
             ll."grossCents", ll."milesHundredths", ll."amountCents",
             ll."referenceNumber", ll."sortOrder",
             l."referenceNumber" AS load_reference,
             l."operationalStatus"::text AS load_status
        FROM "SettlementLoadLine" ll
        JOIN "Load" l ON l.id = ll."loadId"
       WHERE ll."settlementId" = (SELECT id FROM s)
    ),
    lines AS (
      SELECT sl.id, sl.type::text AS type, sl.description, sl."amountCents",
             sl."payRuleSnapshot", sl."sortOrder",
             l.id AS load_id, l."loadNumber" AS load_number
        FROM "SettlementLine" sl
        LEFT JOIN "Load" l ON l.id = sl."loadId"
       WHERE sl."settlementId" = (SELECT id FROM s)
    ),
    -- THE TABS' ROWS (step 4): the batch's own deduction lines, and the fuel
    -- and toll rows under the same filters the fuel CTE below counts.
    deduction_lines AS (
      SELECT dl.id, dl.type, dl.description, dl.quantity, dl."rateCents",
             dl."totalCents", dl."recurringDeductionId", dl."sortOrder"
        FROM "SettlementDeductionLine" dl
       WHERE dl."settlementId" = (SELECT id FROM s)
    ),
    fuel_rows AS (
      SELECT f.id, f."purchasedAt", f."vendorName", f.city, f.state,
             f.gallons::text AS gallons, f."totalCents", f."settlementId"
        FROM "FuelTransaction" f, s
       WHERE f."driverId" = s."driverId" AND f."deletedAt" IS NULL
         AND f."purchasedAt" >= s."periodStart"
         AND f."purchasedAt" <= s."periodEnd"
    ),
    toll_rows AS (
      SELECT e.id, e."incurredAt", e."vendorName", e."amountCents",
             e."isDriverDeduction"
        FROM "Expense" e, s
       WHERE e."driverId" = s."driverId" AND e."deletedAt" IS NULL
         AND e.category::text = 'TOLLS'
         AND e."incurredAt" >= s."periodStart"
         AND e."incurredAt" <= s."periodEnd"
    ),
    fuel AS (
      SELECT
        (SELECT COALESCE(SUM(f."totalCents"), 0) FROM "FuelTransaction" f
          WHERE f."driverId" = s."driverId" AND f."deletedAt" IS NULL
            AND f."purchasedAt" >= s."periodStart"
            AND f."purchasedAt" <= s."periodEnd") AS fuel_cents,
        (SELECT count(*) FROM "FuelTransaction" f
          WHERE f."driverId" = s."driverId" AND f."deletedAt" IS NULL
            AND f."purchasedAt" >= s."periodStart"
            AND f."purchasedAt" <= s."periodEnd") AS fuel_count,
        (SELECT COALESCE(SUM(e."amountCents"), 0) FROM "Expense" e
          WHERE e."driverId" = s."driverId" AND e."deletedAt" IS NULL
            AND e.category::text = 'TOLLS'
            AND e."incurredAt" >= s."periodStart"
            AND e."incurredAt" <= s."periodEnd") AS toll_cents,
        (SELECT count(*) FROM "Expense" e
          WHERE e."driverId" = s."driverId" AND e."deletedAt" IS NULL
            AND e.category::text = 'TOLLS'
            AND e."incurredAt" >= s."periodStart"
            AND e."incurredAt" <= s."periodEnd") AS toll_count,
        (SELECT COALESCE(SUM(e."amountCents"), 0) FROM "Expense" e
          WHERE e."driverId" = s."driverId" AND e."deletedAt" IS NULL
            AND e.category::text = 'TOLLS' AND e."isDriverDeduction"
            AND e."incurredAt" >= s."periodStart"
            AND e."incurredAt" <= s."periodEnd") AS deducted_cents
        FROM s
    ),
    columns AS (
      SELECT p."value", p."organizationId" FROM "UserPreference" p
       WHERE p."userId" = ${input.userId}
         AND p."key" = ${keyFor(SETTLEMENT_TRIPS_GRID)}
       LIMIT 1
    ),
    prev_in_batch AS (
      SELECT o.id, o."settlementNumber" FROM "Settlement" o, s
       WHERE o."batchId" = s."batchId" AND o."deletedAt" IS NULL
         AND o."settlementNumber" < s."settlementNumber"
       ORDER BY o."settlementNumber" DESC LIMIT 1
    ),
    next_in_batch AS (
      SELECT o.id, o."settlementNumber" FROM "Settlement" o, s
       WHERE o."batchId" = s."batchId" AND o."deletedAt" IS NULL
         AND o."settlementNumber" > s."settlementNumber"
       ORDER BY o."settlementNumber" ASC LIMIT 1
    ),
    prev_period AS (
      SELECT o.id, o."periodStart", o."periodEnd" FROM "Settlement" o, s
       WHERE o."driverId" = s."driverId" AND o."deletedAt" IS NULL
         AND o.id <> s.id AND o."periodStart" < s."periodStart"
       ORDER BY o."periodStart" DESC, o.id LIMIT 1
    ),
    next_period AS (
      SELECT o.id, o."periodStart", o."periodEnd" FROM "Settlement" o, s
       WHERE o."driverId" = s."driverId" AND o."deletedAt" IS NULL
         AND o.id <> s.id AND o."periodStart" > s."periodStart"
       ORDER BY o."periodStart" ASC, o.id LIMIT 1
    )
    SELECT (SELECT row_to_json(x) FROM s x) AS settlement,
           (SELECT COALESCE(json_agg(x ORDER BY x."sortOrder", x.id), '[]'::json)
              FROM load_lines x) AS load_lines,
           (SELECT COALESCE(json_agg(x ORDER BY x."sortOrder", x.id), '[]'::json)
              FROM lines x) AS lines,
           (SELECT COALESCE(json_agg(x ORDER BY x."sortOrder", x.id), '[]'::json)
              FROM deduction_lines x) AS deduction_lines,
           (SELECT COALESCE(json_agg(x ORDER BY x."purchasedAt", x.id), '[]'::json)
              FROM fuel_rows x) AS fuel_rows,
           (SELECT COALESCE(json_agg(x ORDER BY x."incurredAt", x.id), '[]'::json)
              FROM toll_rows x) AS toll_rows,
           (SELECT row_to_json(x) FROM fuel x) AS fuel,
           (SELECT row_to_json(x) FROM columns x) AS columns,
           (SELECT row_to_json(x) FROM prev_in_batch x) AS prev_in_batch,
           (SELECT row_to_json(x) FROM next_in_batch x) AS next_in_batch,
           (SELECT row_to_json(x) FROM prev_period x) AS prev_period,
           (SELECT row_to_json(x) FROM next_period x) AS next_period`)

  const row = rows[0]
  if (!row?.settlement) return null
  const s = row.settlement
  const batch = s.batch_row as Json | null
  const settlement: SettlementPageSettlement = {
    id: s.id as string,
    settlementNumber: s.settlementNumber as string,
    periodStart: date(s.periodStart),
    periodEnd: date(s.periodEnd),
    status: s.status as SettlementStatus,
    grossCents: s.grossCents as number,
    earningsCents: s.earningsCents as number,
    deductionsCents: s.deductionsCents as number,
    reimbursementsCents: s.reimbursementsCents as number,
    advancesCents: s.advancesCents as number,
    otherPayCents: s.otherPayCents as number,
    netCents: s.netCents as number,
    milesHundredths: s.milesHundredths as number,
    approvedAt: asDate(s.approvedAt),
    paidAt: asDate(s.paidAt),
    paymentMethod: (s.paymentMethod as PaymentMethod | null) ?? null,
    paymentReference: (s.paymentReference as string | null) ?? null,
    unitNumber: (s.unitNumber as string | null) ?? null,
    payTariffLabel: (s.payTariffLabel as string | null) ?? null,
    driverType: (s.driverType as DriverType | null) ?? null,
    payoutDate: asDate(s.payoutDate),
    batchId: (s.batchId as string | null) ?? null,
    notes: (s.notes as string | null) ?? null,
    company: { name: s.company_name as string },
    driver: s.driver_row as SettlementPageSettlement['driver'],
    _count: { documents: asNumber(s.documents) },
    batch: batch && {
      id: batch.id as string,
      batchNumber: (batch.batchNumber as string | null) ?? null,
      status: batch.status as SettlementBatchStatus,
      statementDate: date(batch.statementDate),
      checkDate: date(batch.checkDate),
    },
    loadLines: row.load_lines.map((l) => ({
      id: l.id as string,
      loadId: l.loadId as string,
      loadNumber: l.loadNumber as string,
      companyName: l.companyName as string,
      puPlace: l.puPlace as string,
      delPlace: l.delPlace as string,
      puDate: date(l.puDate),
      delDate: date(l.delDate),
      grossCents: l.grossCents as number,
      milesHundredths: l.milesHundredths as number,
      amountCents: l.amountCents as number,
      referenceNumber: (l.referenceNumber as string | null) ?? null,
      load: {
        referenceNumber: (l.load_reference as string | null) ?? null,
        operationalStatus: l.load_status as string,
      },
    })),
    lines: row.lines.map((l) => ({
      id: l.id as string,
      type: l.type as SettlementLineType,
      description: l.description as string,
      amountCents: l.amountCents as number,
      payRuleSnapshot: (l.payRuleSnapshot as Prisma.JsonValue) ?? null,
      load:
        l.load_id === null
          ? null
          : { id: l.load_id as string, loadNumber: l.load_number as string },
    })),
  }
  const fuel = row.fuel ?? {}
  const fuelCents = asNumber(fuel.fuel_cents)
  const tollCents = asNumber(fuel.toll_cents)
  const period = (p: HeadRow['prev_period']) =>
    p && {
      id: p.id,
      periodStart: date(p.periodStart),
      periodEnd: date(p.periodEnd),
    }
  return {
    settlement,
    fuel: {
      fuelCents,
      tollCents,
      totalCents: fuelCents + tollCents,
      fuelCount: asNumber(fuel.fuel_count),
      tollCount: asNumber(fuel.toll_count),
      alreadyDeductedCents: asNumber(fuel.deducted_cents),
    },
    columnsRow: row.columns
      ? { value: row.columns.value, organizationId: row.columns.organizationId }
      : null,
    neighbours: {
      prevInBatch: row.prev_in_batch,
      nextInBatch: row.next_in_batch,
      prevPeriod: period(row.prev_period),
      nextPeriod: period(row.next_period),
    },
    tabs: {
      deductionLines: row.deduction_lines.map((l) => ({
        id: l.id as string,
        type: l.type as string,
        description: l.description as string,
        quantity: l.quantity as number,
        rateCents: l.rateCents as number,
        totalCents: l.totalCents as number,
        recurringDeductionId: (l.recurringDeductionId as string | null) ?? null,
      })),
      fuelRows: row.fuel_rows.map((f) => ({
        id: f.id as string,
        purchasedAt: date(f.purchasedAt),
        vendorName: (f.vendorName as string | null) ?? null,
        city: (f.city as string | null) ?? null,
        state: (f.state as string | null) ?? null,
        gallons: f.gallons as string,
        totalCents: f.totalCents as number,
        settlementId: (f.settlementId as string | null) ?? null,
      })),
      tollRows: row.toll_rows.map((e) => ({
        id: e.id as string,
        incurredAt: date(e.incurredAt),
        vendorName: (e.vendorName as string | null) ?? null,
        amountCents: e.amountCents as number,
        isDriverDeduction: e.isDriverDeduction as boolean,
      })),
    },
  }
}
