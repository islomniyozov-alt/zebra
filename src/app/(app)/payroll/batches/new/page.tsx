import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { formatCents } from '@/lib/money'
import { isSettlementWeek, payWeekFor, weekOf } from '@/lib/settlement-week'
import {
  previewBatch,
  UNAVAILABLE_REASONS,
  type PreviewTrip,
  type UnavailableReason,
} from '@/lib/batch-preview'
import { applyList, sumCents, type RawParams } from '@/lib/list-view'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import { Table, type Column } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { PageHeader } from '../../../_grid/PageHeader'
import { CompanyChips } from '../../../_grid/CompanyChips'
import { gridView, pagedFooterLabel } from '../../../_grid/grid-page'
import { CreateBatch } from './CreateBatch'
import type { MessageKey } from '@/lib/i18n'

// PAYROLL → BATCHES → OPEN A BATCH (owner's ruling, 2026-09-29).
//
// Authority and a date range, the freight that would go in, and everything
// that would not — grouped by why.
//
// ── THE AUTHORITY NARROWS THE GRID AND NOT THE BATCH ──────────────────────
//
// Datatruck opens one batch per paying company; Zebra settles the organization
// in one run (Islom, 2026-09-11), so the authority chip here is a reading aid
// and the batch it creates covers every authority. THE SCREEN SAYS SO, because
// picking "RAM Haulage" and pressing Create and getting a batch with Dolphins
// freight in it would otherwise be a surprise about money.
//
// ── THE RANGE PREVIEWS; THE WEEK IS WHAT OPENS ────────────────────────────
//
// A batch is a settlement week by construction — `openBatch` refuses anything
// else as `not_a_week`. So the range is the window this screen LOOKS at, and
// Create opens the week the range starts in, named on the button. A range
// spanning two weeks is allowed to be previewed and refused at Create, rather
// than silently opening the first of them.

const PATH = '/payroll/batches/new'

/** §6.2.1 — how many load numbers one reason lists before it says "and N more". */
const LIST_CAP = 40

/** Groups at or below this open themselves; longer ones start shut. */
const OPEN_UP_TO = 12

const REASON_LABEL: Record<UnavailableReason, MessageKey> = {
  inTransit: 'preview.reason.inTransit',
  outsideRange: 'preview.reason.outsideRange',
  alreadyInBatch: 'preview.reason.alreadyInBatch',
  noDriver: 'preview.reason.noDriver',
  noRule: 'preview.reason.noRule',
}

const REASON_HINT: Record<UnavailableReason, MessageKey> = {
  inTransit: 'preview.hint.inTransit',
  outsideRange: 'preview.hint.outsideRange',
  alreadyInBatch: 'preview.hint.alreadyInBatch',
  noDriver: 'preview.hint.noDriver',
  noRule: 'preview.hint.noRule',
}

const day = (value: Date) => value.toISOString().slice(0, 10)

export default async function OpenBatchPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('create', 'settlement'))) notFound()

  const raw = await searchParams
  const { t, locale } = await getLocaleContext()

  // THE WEEK THAT IS DUE IS THE DEFAULT RANGE — the period that ended two
  // Saturdays ago (MONEY-DESIGN §0), not the one that just closed.
  const due = payWeekFor(new Date())
  const asDay = (value: unknown, fallback: Date) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00.000Z`)
      : fallback
  const from = asDay(raw.from, due.period.start)
  const to = asDay(raw.to, due.period.end)

  const week = weekOf(from)
  // THE RANGE HAS TO BE ONE WEEK for Create to be offered. Snapped to its
  // Sunday, so "the week of the 16th" works; refused where the two ends fall in
  // different weeks, because that is two batches and the button makes one.
  const sameWeek =
    isSettlementWeek(week) &&
    weekOf(to).start.getTime() === week.start.getTime()

  const companyId = typeof raw.company === 'string' ? raw.company : null

  const data = await withCurrentOrg(
    'create',
    'settlement',
    async (tx, session) => {
      const [preview, companies, existing] = await Promise.all([
        previewBatch(tx, { from, to, companyId }),
        tx.company.findMany({
          where: {
            isActive: true,
            ...companyIdScopeFilter(session.companyScopes),
          },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
        // A BATCH ALREADY COVERING THIS WEEK. `openBatch` refuses with
        // `period_taken` and hands it back, but saying so before the click is
        // the difference between a form and a trap.
        tx.settlementBatch.findFirst({
          where: {
            organizationId: session.organizationId,
            deletedAt: null,
            periodStart: week.start,
          },
          select: { id: true, batchNumber: true, status: true },
        }),
      ])
      return { preview, companies, existing }
    },
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )

  const columns: Column<PreviewTrip>[] = [
    {
      key: 'loadNumber',
      header: t('settlements.trip.load'),
      sortable: true,
      render: (row) => (
        <span className="z-identifier font-mono" dir="ltr">
          {row.loadNumber}
        </span>
      ),
    },
    {
      key: 'driver',
      header: t('payroll.driver'),
      truncate: true,
      sortable: true,
      render: (row) => row.driverName ?? <span className="text-ink-3">—</span>,
    },
    {
      key: 'authority',
      header: t('accounting.company'),
      truncate: true,
      sortable: true,
      render: (row) => row.companyName,
    },
    {
      key: 'pod',
      header: t('preview.pod'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.podAt ? day(row.podAt) : '—'}
        </span>
      ),
    },
    {
      key: 'gross',
      header: t('settlements.trip.gross'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.grossCents),
      foot: (rows) => money(sumCents(rows, (row) => row.grossCents)),
    },
  ]

  const view = gridView(
    data.preview.available,
    raw,
    {
      searchText: (row) =>
        `${row.loadNumber} ${row.driverName ?? ''} ${row.companyName}`,
      sorts: {
        loadNumber: (row) => row.loadNumber,
        driver: (row) => row.driverName,
        authority: (row) => row.companyName,
        pod: (row) => row.podAt?.getTime() ?? null,
        gross: (row) => row.grossCents,
      },
      defaultSort: 'loadNumber',
    },
    applyList,
  )

  const totalUnavailable = UNAVAILABLE_REASONS.reduce(
    (sum, reason) => sum + data.preview.unavailable[reason].length,
    0,
  )

  return (
    <>
      <PageHeader
        title={t('preview.title')}
        breadcrumb={[t('nav.group.payroll'), t('preview.title')]}
        action={
          <CreateBatch
            week={day(week.start)}
            disabled={!sameWeek || data.existing !== null}
            label={t('preview.create')}
            weekLabel={`${day(week.start)} — ${day(week.end)}`}
          />
        }
      />

      <FilterBar
        groups={[]}
        search={{
          param: 'q',
          label: t('accounting.search'),
          placeholder: t('settlements.trip.load'),
        }}
        range={{
          label: t('preview.pod'),
          fromLabel: t('accounting.from'),
          toLabel: t('accounting.to'),
        }}
        clearLabel={t('filter.clear')}
        moreLabel={t('filter.more')}
      />

      <CompanyChips
        companies={data.companies}
        label={t('accounting.company')}
        allLabel={t('accounting.allCompanies')}
      />

      {/* ── WHAT CREATE WOULD ACTUALLY DO ─────────────────────────────────
       * Said before the button is pressed, because the two facts that
       * surprise people are that the batch is org-wide and that it covers a
       * WEEK rather than the range typed above. */}
      <div className="flex flex-wrap items-baseline gap-z3 border-b border-border bg-surface-2 px-gutter py-z2 text-xs text-ink-2">
        <span>
          {t('preview.willOpen')}{' '}
          <span className="font-mono text-ink" dir="ltr">
            {day(week.start)} — {day(week.end)}
          </span>
        </span>
        <span>{t('preview.orgWide')}</span>
        <span className="font-mono tabular-nums">
          {t('preview.considered')} {data.preview.considered}
        </span>
        {!sameWeek ? (
          <span className="text-danger">{t('preview.twoWeeks')}</span>
        ) : null}
        {data.existing ? (
          <span className="text-warning">
            {t('preview.exists')}{' '}
            <span className="font-mono" dir="ltr">
              {data.existing.batchNumber ?? data.existing.id.slice(0, 8)}
            </span>
          </span>
        ) : null}
      </div>

      <Table
        columns={columns}
        rows={view.paged.rows}
        footRows={view.filtered}
        rowKey={(row) => row.loadId}
        rowHref={(row) => `/loads/${row.loadId}`}
        caption={t('preview.available')}
        sort={{
          key: view.sort.key,
          dir: view.sort.dir,
          hrefFor: view.sortFor(PATH),
          label: t('accounting.sortBy'),
        }}
        totals={{
          label: pagedFooterLabel(
            t('preview.available'),
            t('grid.rows'),
            view.paged,
          ),
        }}
        empty={
          <EmptyState
            title={t('preview.emptyAvailable')}
            body={t('preview.emptyAvailableHint')}
          />
        }
        below={
          <>
            {/* ── AND EVERYTHING THAT WOULD NOT GO IN ───────────────────────────
             *
             * Grouped by reason, each with a sentence saying what to do about it.
             * §10: an empty state is an invitation, and so is this — "no rule" is
             * not a fact about a load, it is a task on a driver page.
             *
             * AN EMPTY GROUP IS OMITTED (§4). Five headings with four zeroes under
             * them would bury the one that matters. */}
            {totalUnavailable > 0 ? (
              <section className="border-t border-border bg-surface-2 px-gutter py-z3">
                <h2 className="text-sm font-medium text-ink">
                  {t('preview.unavailable')}{' '}
                  <span className="font-mono tabular-nums text-ink-3">
                    {totalUnavailable}
                  </span>
                </h2>
                <div className="mt-z2 flex flex-col gap-z3">
                  {UNAVAILABLE_REASONS.map((reason) => {
                    const rows = data.preview.unavailable[reason]
                    if (rows.length === 0) return null
                    // ── THE COUNT AND THE SENTENCE NEVER COLLAPSE. THE ROWS DO ──
                    //
                    // §6.2.1. A dev shot of a two-week range rendered
                    // `Already on a statement 189` as a flat wall of load numbers
                    // eight rows deep, and buried `No pay rule 3` — the only
                    // actionable thing on the page — below the fold under it.
                    //
                    // OPEN WHEN SHORT, SHUT WHEN LONG, and the heading says the
                    // number either way. A group somebody can take in at a glance
                    // should not need a click; one that would push the page over a
                    // screen should not cost one.
                    const shown = rows.slice(0, LIST_CAP)
                    const hidden = rows.length - shown.length
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
                          {shown.map((row) => (
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
                          {/* THE REMAINDER IS COUNTED, NOT TRAILED OFF. `…` would
                           * leave the reader unable to tell forty from four
                           * hundred, and the whole point of this section is the
                           * size of what is being left out. */}
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
            ) : null}
          </>
        }
      />
    </>
  )
}
