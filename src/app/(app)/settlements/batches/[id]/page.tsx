import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  currentUserCan,
  readCurrentOrg,
  withCurrentOrg,
} from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import {
  batchInputForOrg,
  deletableBatch,
  SETTLEMENT_BATCH_TIMEOUT_MS,
} from '@/lib/settlement-batch'
import { computeBatch } from '@/lib/settlement-week'
import type { StatementVote } from '@/lib/batch-status'
import {
  UNAVAILABLE_REASONS,
  type UnavailableReason,
} from '@/lib/batch-preview'
import {
  readBatchPageHead,
  type BatchPageSettlement,
} from '@/lib/batch-page-head'
import {
  BATCH_STATEMENT_COLUMNS,
  BATCH_STATEMENT_COLUMNS_HIDDEN,
  BATCH_TABS,
  batchEditable,
  batchTabCounts,
  batchTabOf,
  batchTotals,
  datatruckWeekNumber,
  excludedDrivers,
  statementsForTab,
} from '@/lib/batch-statements'
import { BATCH_CHARGE_TYPES } from '@/lib/batch-charges'
import { gridColumnsFromRow } from '@/lib/grid-columns'
import { applyList, sumCents, type RawParams } from '@/lib/list-view'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, type Column } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import {
  gridView,
  keepColumns,
  pagedFooterLabel,
} from '../../../_grid/grid-page'
import { ColumnsChooser } from '../../../_grid/ColumnsChooser'
import { BatchTripsGrid } from '../../../payroll/batches/BatchTripsGrid'
import { BatchActions } from './BatchActions'
import { BatchTicks } from './BatchTicks'
import { BatchStatementsBulk } from './BatchStatementsBulk'
import { AddDriver } from './AddDriver'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { batchWord, statementWord, type PayWord } from '@/lib/pay-status'
import type { MessageKey } from '@/lib/i18n'

// THE BATCH SCREEN (§6.2.10 part 2b; part 7 step 3, v11.32).
//
// ── WHAT IT SERVES ───────────────────────────────────────────────────────
//
// Datatruck's order, which is Uktam's (owner's brief 2026-11-18): the
// statements lead, with All / Unposted / Posted / Paid tabs and ten columns,
// beside a right rail of General and Totals. Every figure is a stored
// `Settlement` column or a sum of them (`batch-statements.ts`); nothing is
// priced here. The engine is not touched: Post all unposted is
// `finaliseBatch`, Add trip is part 2b's tick grid behind a panel, Add driver
// and Add deduction refresh the draft through their own verbs.
//
// THE BLOCKERS AND HELD LINES STAY, above and below the table. They are the
// engine's own refusals about somebody's wages, and Datatruck's lack of them
// is not a reason to hide them.

/** §6.2.1 — how many load numbers one reason lists before it says "and N more". */
const LIST_CAP = 40
const OPEN_UP_TO = 12

const REASON_LABEL: Record<UnavailableReason, MessageKey> = {
  inTransit: 'preview.reason.inTransit',
  noDeliveryDate: 'preview.reason.noDeliveryDate',
  outsideRange: 'preview.reason.outsideRange',
  beforeCutover: 'preview.reason.beforeCutover',
  alreadyInBatch: 'preview.reason.alreadyInBatch',
  noDriver: 'preview.reason.noDriver',
  noRule: 'preview.reason.noRule',
}

const REASON_HINT: Record<UnavailableReason, MessageKey> = {
  inTransit: 'preview.hint.inTransit',
  noDeliveryDate: 'preview.hint.noDeliveryDate',
  outsideRange: 'preview.hint.outsideRange',
  beforeCutover: 'preview.hint.beforeCutover',
  alreadyInBatch: 'preview.hint.alreadyInBatch',
  noDriver: 'preview.hint.noDriver',
  noRule: 'preview.hint.noRule',
}

const TAB_LABEL: Record<(typeof BATCH_TABS)[number], MessageKey> = {
  all: 'batch.tab.all',
  unposted: 'batch.tab.unposted',
  posted: 'batch.tab.posted',
  paid: 'batch.tab.paid',
}

export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<RawParams>
}) {
  const { id } = await params
  const raw = await searchParams
  const { t, locale } = await getLocaleContext()
  // A ROLE WITHOUT `read settlement` IS REFUSED HERE, AS A 404 (GAPS code
  // row 12, closed 2026-10-10). Without this the check inside `withCurrentOrg`
  // threw `ForbiddenError` and a dispatcher met a server error; the statement
  // page has always asked first, and the two-role sweep found the one that did
  // not.
  if (!(await currentUserCan('read', 'settlement'))) notFound()
  const mayWrite = await currentUserCan('update', 'settlement')
  const mayDelete = await currentUserCan('delete', 'settlement')
  const path = `/settlements/batches/${id}`

  // THE PAGE'S OWN READS IN ONE CALL (§6.2.10 part 2c v11.08; step 3 adds
  // columns, never a round trip): the batch, its statements, the preview's
  // window, the ticks and the reader's column choice, through the tenant
  // reader and no transaction.
  const head = await readCurrentOrg('read', 'settlement', (reader, session) =>
    readBatchPageHead(reader, id, session.userId),
  )
  if (!head) notFound()
  const { batch, preview } = head

  // THE ITEM 3 FACTS, ON AN OPEN BATCH: recomputed for display rather than
  // stored, because they are facts about what is MISSING, and a stored absence
  // goes stale the moment somebody supplies the thing. Over the same
  // exclusions the grid shows unticked, so the two cannot disagree. The
  // engine's input is the engine's own reader, in a transaction of its own —
  // no second spelling of it (owner's ruling 2026-11-15).
  const open = batchEditable(batch.status)
  const { held, blockers, negative } = open
    ? await withCurrentOrg(
        'read',
        'settlement',
        async (tx) => {
          const drivers = await batchInputForOrg(tx, {
            organizationId: batch.organizationId,
            period: { start: batch.periodStart, end: batch.periodEnd },
            statementDate: batch.statementDate,
            checkDate: batch.checkDate,
            companyId: batch.companyId,
            excludeLoadIds: preview.available
              .filter((trip) => trip.excluded)
              .map((trip) => trip.loadId),
          })
          return computeBatch({
            period: { start: batch.periodStart, end: batch.periodEnd },
            statementDate: batch.statementDate,
            checkDate: batch.checkDate,
            drivers,
          })
        },
        { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
      )
    : { held: [], blockers: [], negative: [] }

  const day = (value: Date | null) =>
    value === null ? '—' : value.toISOString().slice(0, 10)
  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )

  const heldReason = (kind: string): MessageKey =>
    kind === 'no_remittance'
      ? 'batch.held.noRemittance'
      : kind === 'over'
        ? 'batch.held.over'
        : 'batch.held.short'

  /** The office's word for a status, or the raw value where none is known. */
  const wordFor = (word: PayWord | null, raw: string) =>
    word ? t(word.label) : raw

  // ── THE STATEMENTS, THE TABS AND THE RAIL (step 3) ───────────────────
  const tab = batchTabOf(raw.tab)
  const counts = batchTabCounts(batch.settlements)
  const shown = statementsForTab(batch.settlements, tab)
  const totals = batchTotals(batch.settlements)
  const visible = gridColumnsFromRow(
    'settlements.batch',
    BATCH_STATEMENT_COLUMNS,
    BATCH_STATEMENT_COLUMNS_HIDDEN,
    head.columnsRow,
  ).visible
  const driverName = (row: BatchPageSettlement) =>
    `${row.driver.firstName} ${row.driver.lastName}`

  const columns: Column<BatchPageSettlement>[] = [
    {
      key: 'statement',
      header: t('batch.statement'),
      // THE STATEMENT, THE WORKBENCH — in every status. A draft is a document
      // somebody is working on, not one that cannot be opened.
      render: (settlement) => (
        <Link
          className="z-identifier font-mono text-xs underline underline-offset-2 hover:text-accent"
          dir="ltr"
          href={`/settlements/${settlement.id}`}
        >
          {settlement.settlementNumber}
        </Link>
      ),
    },
    {
      key: 'driverType',
      header: t('batch.col.driverType'),
      render: (row) =>
        row.driverType === null
          ? '—'
          : t(`drivers.type.${row.driverType}` as MessageKey),
    },
    {
      key: 'truck',
      header: t('batch.col.truck'),
      render: (row) => (
        <span className="z-identifier font-mono text-xs" dir="ltr">
          {row.unitNumber ?? '—'}
        </span>
      ),
    },
    {
      key: 'payee',
      header: t('batch.col.payee'),
      // THE PAYEE AS THE STATEMENT STORED IT, else the driver's own name —
      // the fallback the trip picker uses (`batch-preview.ts`).
      render: (row) => row.payToName?.trim() || driverName(row),
    },
    {
      key: 'status',
      header: t('batch.col.status'),
      render: (row) => (
        <StatusBadge
          tone={statementWord(row.status)?.tone ?? 'neutral'}
          label={wordFor(statementWord(row.status), row.status)}
        />
      ),
    },
    {
      key: 'trips',
      header: t('batch.col.trips'),
      align: 'end',
      render: (row) => <span className="font-mono">{row.lines}</span>,
    },
    {
      key: 'payRule',
      header: t('batch.col.payRule'),
      render: (row) => row.payTariffLabel ?? '—',
    },
    {
      // R12 AS REVERSED: Total pay and Total gross are the same stored figure,
      // printed twice because Datatruck prints both and the office reads both.
      key: 'totalPay',
      header: t('batch.col.totalPay'),
      align: 'end',
      render: (row) => money(row.grossCents),
      foot: (rows) => money(sumCents(rows, (row) => row.grossCents)),
    },
    {
      key: 'totalGross',
      header: t('batch.col.totalGross'),
      align: 'end',
      render: (row) => money(row.grossCents),
      foot: (rows) => money(sumCents(rows, (row) => row.grossCents)),
    },
    {
      key: 'netPay',
      header: t('batch.col.netPay'),
      align: 'end',
      // NEGATIVE NET IS PRINTED AND FLAGGED, never clamped and never carried
      // forward — carry-forward is Islom's decision.
      render: (row) => (
        <span className={row.netCents < 0 ? 'text-danger' : ''}>
          {money(row.netCents)}
        </span>
      ),
      foot: (rows) => money(sumCents(rows, (row) => row.netCents)),
    },
  ]

  // ── PART 2b'S TICK GRID, NOW BEHIND "ADD TRIP" ───────────────────────
  const view = gridView(
    preview.available,
    raw,
    {
      searchText: (row) =>
        `${row.loadNumber} ${row.payeeName ?? ''} ${row.driverName ?? ''} ` +
        `${row.referenceNumber ?? ''} ${row.companyName} ${row.locations ?? ''}`,
      sorts: {
        loadNumber: (row) => row.loadNumber,
        payee: (row) => row.payeeName,
        driverType: (row) => row.driverType,
        status: (row) => row.status,
        dates: (row) => row.pickupAt?.getTime() ?? null,
        gross: (row) => row.grossCents,
        loadPay: (row) => row.loadPayCents,
      },
      defaultSort: 'loadNumber',
    },
    applyList,
  )
  const tickedOnPage = view.paged.rows.filter(
    (row) => !row.excluded && row.loadPayCents !== null,
  ).length
  const totalUnavailable = UNAVAILABLE_REASONS.reduce(
    (sum, reason) => sum + preview.unavailable[reason].length,
    0,
  )

  const grid = (
    <BatchTripsGrid
      rows={view.paged.rows}
      footRows={view.filtered}
      companyId={batch.companyId}
      // A FINAL OR PAID BATCH IS A DOCUMENT: no boxes. The sentence above the
      // grid says so.
      selection={
        open && mayWrite
          ? {
              name: 'trip',
              label: t('batch.trips'),
              alsoPost: 'shown',
              // TICKED UNLESS THIS BATCH EXCLUDED IT — the only place a tick
              // lives (§6.2.10 part 2).
              defaultCheckedFor: (row) => !row.excluded,
            }
          : null
      }
      caption={t('batch.trips')}
      sort={{
        key: view.sort.key,
        dir: view.sort.dir,
        hrefFor: view.sortFor(path),
        label: t('accounting.sortBy'),
      }}
      totalsLabel={pagedFooterLabel(
        t('batch.trips'),
        t('grid.rows'),
        view.paged,
      )}
      empty={
        <EmptyState
          title={t('preview.emptyAvailable')}
          body={t('preview.emptyAvailableHint')}
        />
      }
      below={
        totalUnavailable > 0 ? (
          <section className="border-t border-border bg-surface-2 px-gutter py-z3">
            <h2 className="text-sm font-medium text-ink">
              {t('preview.unavailable')}{' '}
              <span className="font-mono tabular-nums text-ink-3">
                {totalUnavailable}
              </span>
            </h2>
            <div className="mt-z2 flex flex-col gap-z3">
              {UNAVAILABLE_REASONS.map((reason) => {
                const rows = preview.unavailable[reason]
                if (rows.length === 0) return null
                const listed = rows.slice(0, LIST_CAP)
                const hidden = rows.length - listed.length
                return (
                  <details key={reason} open={rows.length <= OPEN_UP_TO}>
                    <summary className="cursor-pointer">
                      <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-2">
                        {t(REASON_LABEL[reason])}{' '}
                        <span className="font-mono tabular-nums text-ink-3">
                          {rows.length}
                        </span>
                      </span>
                      <span className="block text-xs text-ink-3">
                        {t(REASON_HINT[reason])}
                      </span>
                    </summary>
                    <ul className="mt-z1 flex flex-wrap gap-x-z4 gap-y-z1 text-xs">
                      {listed.map((row) => (
                        <li key={row.loadId}>
                          <span
                            className="z-identifier font-mono text-ink"
                            dir="ltr"
                          >
                            {row.loadNumber}
                          </span>{' '}
                          <span className="text-ink-3">
                            {row.driverName ?? t('preview.reason.noDriver')}
                          </span>
                        </li>
                      ))}
                      {hidden > 0 ? (
                        <li className="text-ink-3">
                          {t('preview.andMore')} {hidden}
                        </li>
                      ) : null}
                    </ul>
                  </details>
                )
              })}
            </div>
          </section>
        ) : null
      }
    />
  )

  const leftOut = excludedDrivers(preview.available).map((driver) => ({
    driverId: driver.driverId,
    driverName: driver.driverName,
    trips: driver.loadIds.length,
  }))

  const table = (
    <Table
      columns={keepColumns(columns, visible)}
      rows={shown}
      rowKey={(row) => row.id}
      rowHref={(row) => `/settlements/${row.id}`}
      {...(mayWrite
        ? { selection: { name: 'statement', label: t('grid.select') } }
        : {})}
      stripeTone={(row) => statementWord(row.status)?.tone ?? 'neutral'}
      isCancelled={(row) => row.status === 'VOID'}
      caption={t('batch.statements')}
      totals={{
        label: `${t('accounting.total')} · ${shown.length} ${t('grid.rows')}`,
      }}
      empty={<EmptyState title={t('batch.none')} body="" />}
    />
  )

  const fact = (label: string, value: ReactNode) => (
    <div className="flex items-baseline justify-between gap-z3">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-end text-sm text-ink">{value}</dd>
    </div>
  )

  // THE PAGE IS THE SCROLL REGION, as every other page under the shell is
  // (§6.1: content is the only scrolling region; layout.tsx is h-screen +
  // overflow-hidden). Without min-h-0 / flex-1 / overflow-y-auto this column
  // grew to its rows and the shell clipped the rest (2026-11-02).
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-z5 overflow-y-auto p-z5">
      <header className="flex flex-wrap items-baseline gap-z3">
        <h1 className="font-mono text-lg font-medium text-ink">
          {batch.batchNumber ?? batch.status}
        </h1>
        <p className="font-mono text-xs text-ink-3">
          {day(batch.periodStart)} — {day(batch.periodEnd)}
        </p>
        {/* THE SCOPE, SAID: a named authority or the whole organization
         * (§6.2.10 part 1). */}
        <p className="text-xs text-ink-3">
          {batch.company?.name ?? t('preview.forOrg')}
        </p>
        {/* THE OFFICE'S WORD (§6.2.10 part 7): Unposted · Partial posted ·
         * Posted · Paid. */}
        <span className="ms-auto">
          <StatusBadge
            tone={batchWord(batch.status)?.tone ?? 'neutral'}
            label={wordFor(batchWord(batch.status), batch.status)}
          />
        </span>
      </header>

      {mayWrite ? (
        <BatchActions
          batchId={batch.id}
          status={batch.status}
          canFinalise={blockers.length === 0}
          canDelete={deletableBatch(
            batch.settlements.map((row) => row.status as StatementVote),
          )}
          mayDelete={mayDelete}
          labels={{
            refresh: t('batch.refresh'),
            finalise: t('batch.finalise'),
            markPaid: t('batch.markPaid'),
            delete: t('batch.delete'),
          }}
        />
      ) : null}

      {blockers.length > 0 ? (
        <section className="rounded-card border border-danger bg-danger-soft p-z4">
          <h2 className="text-md font-medium text-danger">
            {t('batch.blockers')}
          </h2>
          <ul className="mt-z2 flex flex-col gap-z1 text-sm text-ink">
            {blockers.map((row, index) => (
              <li key={`${row.driverId}-${String(index)}`}>
                <span className="font-medium">{row.driverName}</span> —{' '}
                {row.blocker.kind === 'no_pay_rule'
                  ? t('batch.blocker.noPayRule')
                  : t('batch.blocker.ruleUnusable')}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-z5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-z5">
          {/* ── THE STATEMENTS (step 3) ─────────────────────────────────── */}
          <section className="overflow-hidden rounded-card border border-border bg-surface">
            <Tabs
              tabs={BATCH_TABS.map((key) => ({
                key,
                label: t(TAB_LABEL[key]),
                count: counts[key],
              }))}
              active={tab}
              hrefFor={(key) => (key === 'all' ? path : `${path}?tab=${key}`)}
              label={t('grid.tabs')}
              trailing={
                <ColumnsChooser
                  grid="settlements.batch"
                  columns={columns.map((column) => ({
                    key: column.key,
                    header: String(column.header),
                  }))}
                  visible={visible}
                  labels={{
                    open: t('grid.columns'),
                    apply: t('grid.columns.apply'),
                    cancel: t('grid.columns.cancel'),
                    firstLocked: t('grid.columns.firstLocked'),
                  }}
                  errors={{
                    'grid.columns.errorEmpty': t('grid.columns.errorEmpty'),
                    'grid.columns.errorGrid': t('grid.columns.errorGrid'),
                  }}
                />
              }
            />
            {open && mayWrite ? (
              <div className="flex flex-wrap items-center gap-z3 border-b border-border px-gutter py-z2">
                <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-2">
                  {t('batch.addDriver')}
                </span>
                <AddDriver
                  batchId={batch.id}
                  drivers={leftOut}
                  labels={{
                    add: t('batch.addDriver'),
                    hint: t('batch.addDriverHint'),
                    none: t('batch.addDriverNone'),
                  }}
                />
              </div>
            ) : null}
            {mayWrite ? (
              <BatchStatementsBulk
                batchId={batch.id}
                editable={open}
                types={BATCH_CHARGE_TYPES}
                labels={{
                  selected: t('grid.selected'),
                  send: t('batch.send'),
                  sent: t('batch.sent'),
                  addDeduction: t('batch.addDeduction'),
                  type: t('batch.deduction.type'),
                  description: t('batch.deduction.description'),
                  amount: t('batch.deduction.amount'),
                  hint: t('batch.deduction.hint'),
                  charged: t('batch.deductionDone'),
                }}
              >
                {table}
              </BatchStatementsBulk>
            ) : (
              table
            )}
          </section>

          {/* ── ADD TRIP: PART 2b'S TICK GRID, BEHIND A PANEL ─────────────── */}
          <details className="overflow-hidden rounded-card border border-border bg-surface">
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-z3 px-gutter py-z2">
              <span className="text-md font-medium text-ink">
                {open && mayWrite ? t('batch.addTrip') : t('batch.trips')}
              </span>
              <span className="text-xs text-ink-3">
                {open ? t('batch.tripsHint') : t('batch.tripsFinal')}
              </span>
            </summary>
            <div className="border-t border-border">
              {open && mayWrite ? (
                <BatchTicks
                  batchId={batch.id}
                  ticked={tickedOnPage}
                  labels={{
                    save: t('batch.saveTicks'),
                    saving: t('ref.saving'),
                    selectAll: t('preview.selectAll'),
                  }}
                >
                  {grid}
                </BatchTicks>
              ) : (
                grid
              )}
            </div>
          </details>

          {/* HELD LINES, BY NAME. The draft never silently includes or excludes
           * one — §3. Each says which load, whose it is, and why it is waiting. */}
          {held.length > 0 ? (
            <section className="rounded-card border border-border bg-surface p-z4">
              <h2 className="text-md font-medium text-ink">
                {t('batch.held')}
              </h2>
              <p className="mt-z1 text-xs text-ink-3">{t('batch.heldHint')}</p>
              <ul className="mt-z3 flex flex-col gap-z2 text-sm">
                {held.map((row) => (
                  <li key={row.line.loadId} className="flex flex-wrap gap-z2">
                    <span className="font-mono">{row.line.loadNumber}</span>
                    <span className="text-ink-2">{row.driverName}</span>
                    <span className="text-ink-3">
                      {t(heldReason(row.line.reason.kind))}
                    </span>
                    {row.line.reason.kind !== 'no_remittance' ? (
                      <span className="font-mono text-xs text-ink-3">
                        {formatCents(row.line.reason.remittedCents, locale)} /{' '}
                        {formatCents(row.line.rateCents, locale)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {negative.length > 0 ? (
            <p className="text-xs text-danger">
              {t('batch.negative')}:{' '}
              {negative.map((row) => row.driverName).join(', ')}
            </p>
          ) : null}
        </div>

        {/* ── THE RIGHT RAIL: GENERAL AND TOTALS (step 3) ─────────────────
         * Every money figure is the SUM of a stored statement column over the
         * batch's non-void statements (`batchTotals`). */}
        <aside className="flex flex-col gap-z4">
          <section className="rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">
              {t('batch.rail.general')}
            </h2>
            <dl className="mt-z3 flex flex-col gap-z2">
              {fact(t('batch.rail.createdBy'), batch.createdBy ?? '—')}
              {fact(
                t('batch.rail.payBy'),
                batch.company?.name ?? t('preview.forOrg'),
              )}
              {fact(
                t('batch.rail.date'),
                <span className="font-mono" dir="ltr">
                  {day(batch.statementDate)}
                </span>,
              )}
              {fact(
                t('batch.rail.week'),
                <span>
                  <span className="font-mono">
                    {datatruckWeekNumber(batch.periodStart)}
                  </span>{' '}
                  <span className="text-xs text-ink-3">
                    {t('batch.rail.weekProvisional')}
                  </span>
                </span>,
              )}
            </dl>
          </section>
          <section className="rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">
              {t('batch.rail.totals')}
            </h2>
            <dl className="mt-z3 flex flex-col gap-z2">
              {fact(
                t('batch.rail.trips'),
                <span className="font-mono">{totals.trips}</span>,
              )}
              {fact(
                t('batch.rail.statements'),
                <span className="font-mono">{totals.statements}</span>,
              )}
              {fact(
                t('batch.tab.unposted'),
                <span className="font-mono">{totals.unposted}</span>,
              )}
              {fact(
                t('batch.tab.posted'),
                <span className="font-mono">{totals.posted}</span>,
              )}
              {fact(
                t('batch.tab.paid'),
                <span className="font-mono">{totals.paid}</span>,
              )}
              {fact(
                t('batch.rail.period'),
                <span className="font-mono text-xs" dir="ltr">
                  {day(batch.periodStart)} — {day(batch.periodEnd)}
                </span>,
              )}
              {fact(
                t('batch.checkDate'),
                <span className="font-mono" dir="ltr">
                  {day(batch.checkDate)}
                </span>,
              )}
            </dl>
            <dl className="mt-z3 flex flex-col gap-z2 border-t border-border pt-z3">
              {fact(t('batch.rail.gross'), money(totals.grossCents))}
              {fact(t('batch.rail.totalPay'), money(totals.totalPayCents))}
              {fact(t('batch.rail.earnings'), money(totals.earningsCents))}
              {fact(t('batch.rail.otherPay'), money(totals.otherPayCents))}
              {fact(
                t('batch.rail.reimbursements'),
                money(totals.reimbursementsCents),
              )}
              {fact(t('batch.rail.deductions'), money(totals.deductionsCents))}
              {fact(t('batch.rail.advances'), money(totals.advancesCents))}
              {fact(
                t('batch.rail.net'),
                <span className="font-medium">{money(totals.netCents)}</span>,
              )}
            </dl>
            <p className="mt-z3 text-xs text-ink-3">
              {t('batch.rail.voidNote')}
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
