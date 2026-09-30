import {
  withCurrentOrg,
  ForbiddenError,
  UnauthenticatedError,
} from '@/lib/auth-context'
import { can } from '@/lib/permissions'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import {
  applyList,
  csvDay,
  csvMoney,
  readListParams,
  toCsv,
  type RawParams,
} from '@/lib/list-view'
import {
  balanceShape,
  batchShape,
  invoiceShape,
  oneTimeShape,
  paymentShape,
  readBalances,
  readBatches,
  readInvoices,
  readOneTimeCharges,
  readPayments,
  readScheduled,
  readStatements,
  scheduledShape,
  statementShape,
} from '@/lib/accounting-grids'
import { isGridId, type GridId } from '@/lib/grid-columns'
import type { Action, Resource } from '@/lib/permissions'

// GET /accounting/export?grid=<id>&<the same filters the screen has>
//
// §7.1.5 — EVERY PAGE OF THE FILTERED SET, NOT THE PAGE ON SCREEN.
//
// The button sits beside a footer reading "1–50 of 340", so exporting 50 is the
// most plausible possible wrong answer. `page` and `per` are read and DISCARDED
// here, deliberately and visibly, rather than not being parsed at all — a reader
// of this file should see that the omission is a decision.
//
// ── ONE READER AND ONE FILTER, SHARED WITH THE SCREEN ─────────────────────
//
// Every row and every predicate comes from `accounting-grids.ts`, which the pages
// also use. This handler owns no query of its own. Two queries that are supposed
// to agree about money are two queries that will not — and a CSV that disagrees
// with the screen it was exported from is the worst version of that, because the
// file is what gets sent to somebody else.
//
// ── CODES, NOT LABELS (§12) ───────────────────────────────────────────────
//
// No translator is loaded here at all, which is the mechanism rather than the
// intention: a status, an invoice number and an authority id export as
// themselves. The file is read by a machine downstream, and by an accountant
// pasting it into something that does not speak Russian.
//
// ── THE PERMISSION IS THE GRID'S OWN ──────────────────────────────────────
//
// A CSV is the same data as the screen, so it is the same permission — and an
// export endpoint that checked something weaker would be the CSS-hiding bug with
// a download attached. `driver.pay` for anything naming a driver's money,
// `invoice`/`payment` for theirs.

/**
 * Grids this endpoint cannot address, excluded from the type and not merely
 * checked for.
 *
 * THE PREDICATE IS THE POINT. Returning 400 at runtime would leave the switch
 * below still nominally handling `settlements.trips`, so TypeScript would stop
 * requiring a case for it AND stop requiring one for the next grid somebody
 * adds — the exhaustiveness that made this decision surface at all would be
 * the thing the fix destroyed. Narrowing keeps it.
 */
type ExportableGrid = Exclude<GridId, 'settlements.trips'>

const NOT_EXPORTABLE = new Set<GridId>(['settlements.trips'])

const isExportable = (grid: GridId): grid is ExportableGrid =>
  !NOT_EXPORTABLE.has(grid)

const GUARD: Record<GridId, { action: Action; resource: Resource }> = {
  'invoices.invoices': { action: 'read', resource: 'invoice' },
  'invoices.ready': { action: 'create', resource: 'invoice' },
  'invoices.direct': { action: 'read', resource: 'invoice' },
  'payments.payments': { action: 'read', resource: 'payment' },
  'payments.unapplied': { action: 'read', resource: 'payment' },
  'payroll.batches': { action: 'read', resource: 'settlement' },
  // Document-scoped; see NOT_EXPORTABLE below. The entry exists because the
  // map is exhaustive on purpose, and that exhaustiveness is what made adding
  // the grid id surface this decision instead of burying it.
  'settlements.trips': { action: 'read', resource: 'driver.pay' },
  'payroll.statements': { action: 'read', resource: 'driver.pay' },
  'payroll.balances': { action: 'read', resource: 'driver.pay' },
  'payroll.oneTime': { action: 'read', resource: 'driver.pay' },
  'payroll.scheduled': { action: 'read', resource: 'driver.pay' },
  'charges.scheduled': { action: 'read', resource: 'driver.pay' },
  'charges.oneTime': { action: 'read', resource: 'driver.pay' },
  'reports.driver': { action: 'read', resource: 'driver.pay' },
}

const csv = (name: string, body: string): Response =>
  new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      // THE FILENAME CARRIES THE DAY, because an accountant ends up with four of
      // these in a Downloads folder and `export.csv (3)` tells them nothing.
      'content-disposition': `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      // Never cached: the rows are live money and a stale CSV is worse than a
      // slow one.
      'cache-control': 'no-store',
    },
  })

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const grid = url.searchParams.get('grid') ?? ''
  if (!isGridId(grid)) {
    return new Response('Unknown grid.', { status: 400 })
  }

  // ── GRIDS THAT BELONG TO ONE DOCUMENT ──────────────────────────────────
  //
  // This endpoint is addressed by GRID PLUS FILTERS and nothing else, which is
  // the whole reason a CSV link is a URL somebody can paste. A statement's
  // trips grid is scoped to one settlement, and there is no settlement in that
  // address — so the honest answer is a refusal that says which, not an empty
  // file or every trip in the organization.
  //
  // It is registered as a grid because §7.1.4's column preference is keyed by
  // grid id and that promise applies here too. Exportability and a column
  // preference are two different properties and this is where they part.
  if (!isExportable(grid)) {
    return new Response(
      'That grid belongs to a single document and is exported from it. ' +
        'Use the statement PDF.',
      { status: 400 },
    )
  }

  const raw: RawParams = Object.fromEntries(url.searchParams.entries())
  const params = readListParams(raw)
  const guard = GUARD[grid]

  try {
    const body = await withCurrentOrg(
      guard.action,
      guard.resource,
      async (tx, session) => {
        // THE GRID'S OWN PERMISSION, CHECKED AGAIN INSIDE. `withCurrentOrg` has
        // already enforced `guard`, and this second read is what stops a future
        // grid being added to `GRID_IDS` without an entry in `GUARD` — the map is
        // exhaustive by type, so that cannot compile, and this is the runtime half.
        if (!can(session, guard.action, guard.resource)) return null

        const scope = companyScopeFilter(session.companyScopes)
        void companyIdScopeFilter

        switch (grid) {
          case 'invoices.invoices':
          case 'invoices.ready':
          case 'invoices.direct': {
            const rows = applyList(
              await readInvoices(tx, scope, new Date()),
              params,
              invoiceShape,
            )
            return toCsv(
              [
                'invoice_number',
                'customer',
                'authority',
                'issued',
                'due',
                'total',
                'balance',
                'status',
                'age_bucket',
              ],
              rows.map((row) => [
                row.invoiceNumber,
                row.customerName,
                row.companyName,
                csvDay(row.issued),
                csvDay(row.due),
                csvMoney(row.totalCents),
                csvMoney(row.balanceCents),
                row.status,
                row.bucket ?? '',
              ]),
            )
          }

          case 'payments.payments':
          case 'payments.unapplied': {
            const rows = applyList(
              await readPayments(tx, scope),
              params,
              paymentShape,
            )
            return toCsv(
              [
                'received',
                'method',
                'reference',
                'payer',
                'authority',
                'amount',
                'unapplied',
                'applied_to_count',
              ],
              rows.map((row) => [
                csvDay(row.receivedAt),
                row.method,
                row.referenceNumber ?? '',
                row.customerName,
                row.companyName,
                csvMoney(row.amountCents),
                csvMoney(row.unappliedCents),
                row.appliedToCount,
              ]),
            )
          }

          case 'payroll.batches': {
            const rows = applyList(
              await readBatches(tx, scope),
              params,
              batchShape,
            )
            // THE BREAKDOWN IS FLATTENED INTO ITS OWN ROWS, with a `scope` column
            // saying which is which. A CSV has no indentation, so a per-company
            // row that looked like a batch row would double every total somebody
            // summed in a spreadsheet.
            const out: (string | number)[][] = []
            for (const row of rows) {
              out.push([
                'batch',
                row.batchNumber ?? row.id,
                row.status,
                csvDay(row.createdAt),
                csvDay(row.checkDate),
                csvDay(row.periodStart),
                csvDay(row.periodEnd),
                row.statements,
                csvMoney(row.amountCents),
                '',
                row.notes ?? '',
              ])
              for (const company of row.breakdown) {
                out.push([
                  'authority',
                  row.batchNumber ?? row.id,
                  row.status,
                  '',
                  '',
                  csvDay(row.periodStart),
                  csvDay(row.periodEnd),
                  company.statements,
                  csvMoney(company.amountCents),
                  company.companyName,
                  '',
                ])
              }
            }
            return toCsv(
              [
                'scope',
                'batch',
                'status',
                'created',
                'check_date',
                'period_start',
                'period_end',
                'statements',
                'amount',
                'authority',
                'notes',
              ],
              out,
            )
          }

          case 'payroll.statements': {
            const rows = applyList(
              await readStatements(tx, scope),
              params,
              statementShape,
            )
            return toCsv(
              [
                'statement',
                'driver',
                'unit',
                'period_start',
                'period_end',
                'gross',
                'deductions',
                'other_pay',
                'net',
                'status',
              ],
              rows.map((row) => [
                row.settlementNumber ?? row.id,
                row.driverName,
                row.unitNumber ?? '',
                csvDay(row.periodStart),
                csvDay(row.periodEnd),
                csvMoney(row.grossCents),
                csvMoney(row.deductionsCents),
                csvMoney(row.otherPayCents),
                csvMoney(row.netCents),
                row.status,
              ]),
            )
          }

          case 'payroll.balances': {
            const year = Number(raw.year) || new Date().getUTCFullYear()
            const rows = applyList(
              await readBalances(tx, scope, year),
              params,
              balanceShape,
            )
            return toCsv(
              [
                'driver',
                'year',
                'opening_net',
                'gross',
                'deductions',
                'net',
                'ytd_net',
                'escrow_held',
                'weeks',
              ],
              rows.map((row) => [
                row.driverName,
                row.year,
                csvMoney(row.openingNetCents),
                csvMoney(row.grossCents),
                csvMoney(row.deductionsCents),
                csvMoney(row.netCents),
                csvMoney(row.ytdNetCents),
                csvMoney(row.escrowHeldCents),
                row.weeks,
              ]),
            )
          }

          case 'payroll.oneTime':
          case 'charges.oneTime': {
            const rows = applyList(
              await readOneTimeCharges(tx, scope),
              params,
              oneTimeShape,
            )
            return toCsv(
              [
                'driver',
                'type',
                'description',
                'amount',
                'applies_on',
                'load',
                'settled_at',
              ],
              rows.map((row) => [
                row.driverName,
                row.type,
                row.description,
                csvMoney(row.amountCents),
                csvDay(row.appliesOn),
                row.loadNumber ?? '',
                csvDay(row.settledAt),
              ]),
            )
          }

          case 'payroll.scheduled':
          case 'charges.scheduled': {
            const rows = applyList(
              await readScheduled(tx, scope),
              params,
              scheduledShape,
            )
            return toCsv(
              [
                'driver',
                'authority',
                'type',
                'description',
                'weekly_amount',
                'cadence',
                'month_total',
                'target',
                'effective_from',
                'effective_to',
                'in_force_today',
              ],
              rows.map((row) => [
                row.driverName,
                row.companyName,
                row.type,
                row.description ?? '',
                csvMoney(row.amountCents),
                row.cadence,
                row.monthlyTotalCents === null
                  ? ''
                  : csvMoney(row.monthlyTotalCents),
                row.targetCents === null ? '' : csvMoney(row.targetCents),
                csvDay(row.effectiveFrom),
                csvDay(row.effectiveTo),
                row.inForceToday ? 'yes' : 'no',
              ]),
            )
          }

          case 'reports.driver': {
            // Reports' by-driver cut is `driverTotals`, which takes a window
            // rather than a row filter — it is exported through the statements
            // reader instead, so the CSV is the rows somebody could see.
            const rows = applyList(
              await readStatements(tx, scope),
              params,
              statementShape,
            )
            return toCsv(
              [
                'driver',
                'period_start',
                'gross',
                'deductions',
                'net',
                'status',
              ],
              rows.map((row) => [
                row.driverName,
                csvDay(row.periodStart),
                csvMoney(row.grossCents),
                csvMoney(row.deductionsCents),
                csvMoney(row.netCents),
                row.status,
              ]),
            )
          }
        }
      },
    )

    if (body === null) {
      return new Response('Your role does not permit this.', { status: 403 })
    }
    return csv(grid.replace('.', '-'), body)
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return new Response('Sign in first.', { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return new Response('Your role does not permit this.', { status: 403 })
    }
    throw error
  }
}
