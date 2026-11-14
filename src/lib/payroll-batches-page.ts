import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { companyScopeFilter } from './tenancy'
import {
  batchBreakdownSql,
  batchRowsSql,
  batchesFrom,
  type BatchBreakdownSqlRow,
  type BatchGridRow,
  type BatchSqlRow,
} from './accounting-grids'
import {
  pipelineFrom,
  pipelineSql,
  type PipelineRow,
  type PipelineStrip,
} from './accounting-reports'
import { keyFor, type GridId, type StoredColumnRow } from './grid-columns'
import type { PayrollWeek } from './payroll'
import type { Week } from './settlement-week'
import { asDate } from './sql-json'

// ---------------------------------------------------------------------------
// /payroll/batches IN ONE STATEMENT (§6.2.9 v11.01; owner's instruction
// 2026-11-14, the slow-pages chain on GAPS 42).
//
// Before: the page's own transaction sent six reads in sequence — the chosen
// week's batch, the weeks already opened, the batch rows, their breakdown,
// the pipeline strip and the column preference — each a round trip, inside
// 25 statements a request. So they are ONE SELECT, the dashboard's shape
// (§6.1.1 v10.97):
//
//   WITH week AS (…), opened AS (…), columns AS (…),
//        batches AS (…), breakdown AS (…), pipeline AS (…)
//   SELECT <one column per read, its rows as JSON>
//
// `batches`, `breakdown` and `pipeline` ARE THE TEXTS THEIR OWN READERS SEND
// (`batchRowsSql` and `batchBreakdownSql` beside `readBatches`, `pipelineSql`
// beside `pipelineStrip`), so the export and the tests read the same SQL; the
// parsers are theirs too and take the JSON transport (`sql-json.ts`). They
// exist only on the Batches tab, as the per-read code had it; on Balances
// their columns are a literal null and their queries do not run.
//
// THE COLUMN PREFERENCE COMES BACK AS ITS ROW, not as columns: deciding the
// visible set, and the one-time legacy rewrite that may WRITE, stay in
// `readGridColumns`, which the page calls with this row.
// ---------------------------------------------------------------------------

export interface PayrollPageInput {
  organizationId: string
  userId: string
  companyScopes: readonly string[]
  /** The week the picker chose. */
  period: Week
  /** The weeks the picker offers; `opened` says which have a batch. */
  offered: readonly Week[]
  /** True on the Batches tab: the grid, its breakdown and the strip. */
  batchesTab: boolean
  /** The grid whose stored column preference to read. */
  grid: GridId
}

export interface PayrollPageReads {
  week: PayrollWeek['batch']
  /** `periodStart` in milliseconds, one per offered week that has a batch. */
  opened: number[]
  batches: BatchGridRow[]
  pipeline: PipelineStrip | null
  columnsRow: StoredColumnRow | null
}

interface WeekSqlRow {
  id: string
  batchNumber: string | null
  status: string
  statementDate: Date | string
  checkDate: Date | string
}

interface OneRow {
  week: WeekSqlRow | null
  opened: { period_start: Date | string }[]
  columns: StoredColumnRow | null
  batches: BatchSqlRow[] | null
  breakdown: BatchBreakdownSqlRow[] | null
  pipeline: PipelineRow[] | null
}

const absent = Prisma.sql`NULL::json`

export async function readPayrollBatchesPage(
  tx: TxClient,
  input: PayrollPageInput,
): Promise<PayrollPageReads> {
  const starts = input.offered.map((period) => period.start)
  const ctes: Prisma.Sql[] = [
    // THE CHOSEN WEEK'S BATCH — `weekBatch`'s read, a live batch for the
    // period's start in this organization.
    Prisma.sql`week AS (
      SELECT b."id", b."batchNumber", b."status"::text AS "status",
             b."statementDate", b."checkDate"
      FROM "SettlementBatch" b
      WHERE b."organizationId" = ${input.organizationId}
        AND b."deletedAt" IS NULL
        AND b."periodStart" = ${input.period.start}
      LIMIT 1
    )`,
    // WHICH OFFERED WEEKS ARE ALREADY OPEN.
    Prisma.sql`opened AS (
      SELECT DISTINCT b."periodStart" AS period_start
      FROM "SettlementBatch" b
      WHERE b."organizationId" = ${input.organizationId}
        AND b."deletedAt" IS NULL
        AND ${
          starts.length > 0
            ? Prisma.sql`b."periodStart" IN (${Prisma.join(starts)})`
            : Prisma.sql`FALSE`
        }
    )`,
    // THE GRID'S STORED COLUMN MEMORY — `readGridColumns`'s read.
    Prisma.sql`columns AS (
      SELECT p."value", p."organizationId"
      FROM "UserPreference" p
      WHERE p."userId" = ${input.userId} AND p."key" = ${keyFor(input.grid)}
      LIMIT 1
    )`,
  ]
  if (input.batchesTab) {
    ctes.push(
      Prisma.sql`batches AS (${batchRowsSql()})`,
      Prisma.sql`breakdown AS (${batchBreakdownSql(
        Prisma.sql`SELECT id FROM batches`,
      )})`,
      Prisma.sql`pipeline AS (${pipelineSql(input.companyScopes)})`,
    )
  }

  const tab = input.batchesTab
  const rows = await tx.$queryRaw<OneRow[]>`
    WITH ${Prisma.join(ctes, ',\n')}
    SELECT
      (SELECT row_to_json(x) FROM week x) AS week,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM opened x) AS opened,
      (SELECT row_to_json(x) FROM columns x) AS columns,
      ${
        tab
          ? Prisma.sql`(SELECT COALESCE(json_agg(x ORDER BY x.period_start DESC, x.id), '[]'::json) FROM batches x)`
          : absent
      } AS batches,
      ${
        tab
          ? Prisma.sql`(SELECT COALESCE(json_agg(x ORDER BY x.company_name, x.company_id), '[]'::json) FROM breakdown x)`
          : absent
      } AS breakdown,
      ${
        tab
          ? Prisma.sql`(SELECT COALESCE(json_agg(x), '[]'::json) FROM pipeline x)`
          : absent
      } AS pipeline
  `
  const row = rows[0]
  if (!row)
    throw new Error('readPayrollBatchesPage: no row from a one-row SELECT.')

  const week = row.week
    ? {
        id: row.week.id,
        batchNumber: row.week.batchNumber,
        status: row.week.status,
        statementDate: asDate(row.week.statementDate) as Date,
        checkDate: asDate(row.week.checkDate) as Date,
      }
    : null

  return {
    week: week as PayrollWeek['batch'],
    opened: row.opened.map((o) => (asDate(o.period_start) as Date).getTime()),
    batches: row.batches
      ? batchesFrom(
          row.batches,
          row.breakdown ?? [],
          companyScopeFilter(input.companyScopes),
        )
      : [],
    pipeline: row.pipeline ? pipelineFrom(row.pipeline) : null,
    columnsRow: row.columns,
  }
}
