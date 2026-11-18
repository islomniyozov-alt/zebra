import { Prisma } from '@/generated/prisma/client'
import type { TenantReader } from './tenancy'
import { asDate } from './sql-json'
import { keyFor, type StoredColumnRow } from './grid-columns'
import {
  carryOverFloorFrom,
  carryOverFloorSql,
  type CarryOverFloorRow,
} from './payroll-cutover'
import {
  previewFrom,
  previewLoadsFrom,
  previewLoadsSql,
  type BatchPreview,
  type PreviewLoadSqlRow,
} from './batch-preview'

// ---------------------------------------------------------------------------
// /settlements/batches/[id] — THE PAGE'S OWN READS IN ONE STATEMENT (§6.2.10
// part 2b v11.08; owner's ruling 2026-11-15: "page's own reads only to one
// call; batchInputForOrg stays as it is, no second spelling").
//
// Measured on dev before: a FINAL batch 6 statements (page 340 ms as the
// owner), a DRAFT 20 (1,011 ms) — the batch with its statements, the
// preview's window and the batch's exclusions, each its own read inside one
// transaction, and on an open batch the engine's input after them. Here the
// first three are ONE SELECT with a named CTE each, sent through a
// `TenantReader`, and no transaction. The window is classified by
// `previewFrom`, the picker's own function.
//
// THE ENGINE'S INPUT IS NOT HERE. An open batch's held lines and blockers are
// computed from `batchInputForOrg`, the money engine's reader, in a
// transaction of its own on the page; a second SQL spelling of the input the
// statements are written from was refused.
//
// The enforcer of the second spellings is named:
// `tests/integration/batch-page-head.test.ts` holds the batch, its statements
// and the preview equal to the Prisma reads and `previewBatch` they replaced.
// ---------------------------------------------------------------------------

export interface BatchPageSettlement {
  id: string
  settlementNumber: string
  status: string
  unitNumber: string | null
  /** The frozen driver type (migration 66), null on statements before it. */
  driverType: string | null
  /** The payee as stored on the statement; the screen falls back to the driver. */
  payToName: string | null
  /** "90% from gross" — the rule as the statement froze it. */
  payTariffLabel: string | null
  grossCents: number
  earningsCents: number
  deductionsCents: number
  otherPayCents: number
  reimbursementsCents: number
  advancesCents: number
  netCents: number
  driver: { firstName: string; lastName: string }
  /** How many trips the statement carries. */
  lines: number
}

export interface BatchPageHead {
  batch: {
    id: string
    batchNumber: string | null
    status: string
    periodStart: Date
    periodEnd: Date
    statementDate: Date
    checkDate: Date
    organizationId: string
    companyId: string | null
    company: { name: string } | null
    /** The batch's audit CREATE row's user (R4); null when none is named. */
    createdBy: string | null
    settlements: BatchPageSettlement[]
  }
  preview: BatchPreview
  /** The reader's stored column choice for `settlements.batch` (step 3). */
  columnsRow: StoredColumnRow | null
}

type Stamp = string | Date

interface HeadRow {
  batch: {
    id: string
    batchNumber: string | null
    status: string
    periodStart: Stamp
    periodEnd: Stamp
    statementDate: Stamp
    checkDate: Stamp
    organizationId: string
    companyId: string | null
    company_name: string | null
    created_by: string | null
  } | null
  settlements: (Omit<BatchPageSettlement, 'driver'> & {
    firstName: string
    lastName: string
  })[]
  loads: PreviewLoadSqlRow[]
  exclusions: string[]
  /** `carryOverFloorSql`'s row (owner's ruling 2026-11-17). */
  floor: CarryOverFloorRow | null
  columns: StoredColumnRow | null
}

const stamp = (value: Stamp): Date => asDate(value) ?? new Date(NaN)

export async function readBatchPageHead(
  reader: TenantReader,
  batchId: string,
  /** Whose column choice to read — the signed-in user. */
  userId: string,
): Promise<BatchPageHead | null> {
  const rows = await reader.read<HeadRow>(Prisma.sql`
    WITH b AS (
      SELECT b.id, b."batchNumber", b.status::text AS status,
             b."periodStart", b."periodEnd", b."statementDate", b."checkDate",
             b."organizationId", b."companyId", c.name AS company_name,
             -- WHO OPENED IT (part 7, R4): the audit CREATE row, read as the
             -- Batches list reads it (accounting-grids.ts).
             (SELECT u."name" FROM "AuditLog" a
                JOIN "User" u ON u."id" = a."userId"
               WHERE a."organizationId" = b."organizationId"
                 AND a."entityType" = 'SettlementBatch'
                 AND a."entityId" = b."id"
                 AND a."action" = 'CREATE'
               ORDER BY a."createdAt", a."id"
               LIMIT 1) AS created_by
        FROM "SettlementBatch" b
        LEFT JOIN "Company" c ON c.id = b."companyId"
       WHERE b.id = ${batchId} AND b."deletedAt" IS NULL
    ),
    settlements AS (
      SELECT s.id, s."settlementNumber", s.status::text AS status,
             s."unitNumber", s."driverType"::text AS "driverType",
             s."payToName", s."payTariffLabel", s."grossCents",
             s."earningsCents", s."deductionsCents", s."otherPayCents",
             s."reimbursementsCents", s."advancesCents", s."netCents",
             s."createdAt",
             d."firstName", d."lastName",
             (SELECT count(*)::int FROM "SettlementLoadLine" ll
               WHERE ll."settlementId" = s.id) AS lines
        FROM "Settlement" s
        JOIN "Driver" d ON d.id = s."driverId"
       WHERE s."batchId" = (SELECT id FROM b)
    ),
    loads AS (${previewLoadsSql({
      from: Prisma.sql`(SELECT "periodStart" FROM b)`,
      to: Prisma.sql`(SELECT "periodEnd" FROM b)`,
      companyId: Prisma.sql`(SELECT "companyId" FROM b)`,
      // This batch's own lined trips count as catch-up (2026-11-17), as
      // `previewBatch`'s `catchUpWhere(forBatchId)` reads them.
      forBatchId: Prisma.sql`(SELECT id FROM b)`,
    })}),
    exclusions AS (
      SELECT e."loadId" FROM "SettlementBatchExclusion" e
       WHERE e."batchId" = (SELECT id FROM b)
    ),
    -- THE CARRY-OVER FLOOR, the text \`readCarryOverFloor\` sends, for the
    -- batch's own scope (owner's ruling 2026-11-17).
    floor AS (${carryOverFloorSql(Prisma.sql`(SELECT "companyId" FROM b)`)}),
    -- THE COLUMN CHOICE (step 3), one more CTE, as the statement page reads
    -- its own (settlement-page-head.ts).
    columns AS (
      SELECT p."value", p."organizationId" FROM "UserPreference" p
       WHERE p."userId" = ${userId}
         AND p."key" = ${keyFor('settlements.batch')}
       LIMIT 1
    )
    SELECT (SELECT row_to_json(b) FROM b) AS batch,
           (SELECT COALESCE(json_agg(x ORDER BY x."createdAt", x.id), '[]'::json)
              FROM settlements x) AS settlements,
           (SELECT COALESCE(json_agg(x ORDER BY x."loadNumber"), '[]'::json)
              FROM loads x) AS loads,
           (SELECT COALESCE(json_agg(x."loadId" ORDER BY x."loadId"), '[]'::json)
              FROM exclusions x) AS exclusions,
           (SELECT row_to_json(x) FROM floor x) AS floor,
           (SELECT row_to_json(x) FROM columns x) AS columns`)

  const row = rows[0]
  if (!row?.batch) return null
  const raw = row.batch
  const batch = {
    id: raw.id,
    batchNumber: raw.batchNumber,
    status: raw.status,
    periodStart: stamp(raw.periodStart),
    periodEnd: stamp(raw.periodEnd),
    statementDate: stamp(raw.statementDate),
    checkDate: stamp(raw.checkDate),
    organizationId: raw.organizationId,
    companyId: raw.companyId,
    company: raw.company_name === null ? null : { name: raw.company_name },
    createdBy: raw.created_by,
    settlements: row.settlements.map((s) => ({
      id: s.id,
      settlementNumber: s.settlementNumber,
      status: s.status,
      unitNumber: s.unitNumber,
      driverType: s.driverType,
      payToName: s.payToName,
      payTariffLabel: s.payTariffLabel,
      grossCents: s.grossCents,
      earningsCents: s.earningsCents,
      deductionsCents: s.deductionsCents,
      otherPayCents: s.otherPayCents,
      reimbursementsCents: s.reimbursementsCents,
      advancesCents: s.advancesCents,
      netCents: s.netCents,
      driver: { firstName: s.firstName, lastName: s.lastName },
      lines: s.lines,
    })),
  }
  const preview = previewFrom(
    previewLoadsFrom(row.loads),
    new Set(row.exclusions),
    {
      from: batch.periodStart,
      to: batch.periodEnd,
      forBatchId: batch.id,
      floor: carryOverFloorFrom(row.floor, new Date()),
    },
  )
  return { batch, preview, columnsRow: row.columns ?? null }
}
