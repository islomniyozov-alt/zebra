import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { listedAuthorities } from '@/lib/companies'
import { isSettlementWeek, payWeekFor, weekOf } from '@/lib/settlement-week'
import {
  previewBatch,
  UNAVAILABLE_REASONS,
  type UnavailableReason,
} from '@/lib/batch-preview'
import { applyList, type RawParams } from '@/lib/list-view'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import { EmptyState } from '@/components/ui/EmptyState'
import { BatchTripsGrid } from '../BatchTripsGrid'
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
  const { t } = await getLocaleContext()

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
        listedAuthorities(tx, session.companyScopes),
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

  // THE NINE COLUMNS LIVE IN `BatchTripsGrid` (§6.2.10 part 2b), shared with the
  // batch screen so "what would go in" and "what is in" cannot drift apart.

  const view = gridView(
    data.preview.available,
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
        // A NULL SORTS AS A NULL, not as zero: `gridView` puts them together at
        // one end, which is where somebody looking for the unpriced rows wants
        // them.
        loadPay: (row) => row.loadPayCents,
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
        // NO CREATE BUTTON HERE ANY MORE. It moved down to sit with the ticks
        // it acts on (§6.2.10 part 1): "Add 34 trips" above a grid of 34 ticked
        // rows is checkable, and the same button in a page header is not.
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
        {/* §6.2.10 — THE CHIP NOW SCOPES THE BATCH, not just the grid, so the
         * sentence names what Create will settle. It used to say "org-wide"
         * unconditionally, which was true then and would be a lie now. */}
        <span>
          {companyId === null
            ? t('preview.forOrg')
            : `${t('preview.forCompany')} ${
                data.companies.find((company) => company.id === companyId)
                  ?.name ?? companyId
              }`}
        </span>
        <span className="font-mono tabular-nums">
          {t('preview.considered')} {data.preview.considered}
        </span>
        {/* "0 AVAILABLE" NEVER STANDS ALONE (§6.2.10 part 1, queue item 20 (7)).
         * The buckets that took the rest, with their counts, in the picker's
         * order — the sum of the groups below, said first, on the same line as
         * the zero. An empty bucket is omitted here as it is below (§4). */}
        <span className="tabular-nums">
          <span className="font-mono text-ink">
            {data.preview.available.length}
          </span>{' '}
          {t('preview.available').toLowerCase()}
          {UNAVAILABLE_REASONS.filter(
            (reason) => data.preview.unavailable[reason].length > 0,
          ).map((reason) => (
            <span key={reason}>
              {' · '}
              <span className="font-mono text-ink">
                {data.preview.unavailable[reason].length}
              </span>{' '}
              {t(REASON_LABEL[reason]).toLowerCase()}
            </span>
          ))}
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

      <CreateBatch
        week={day(week.start)}
        companyId={companyId ?? ''}
        disabled={!sameWeek || data.existing !== null}
        shown={view.paged.rows.length}
        labels={{
          add: t('preview.add'),
          selectAll: t('preview.selectAll'),
          week: `${day(week.start)} — ${day(week.end)}`,
        }}
      >
        <BatchTripsGrid
          rows={view.paged.rows}
          footRows={view.filtered}
          companyId={companyId}
          // TICKED BY DEFAULT — everything settleable is in the batch unless the
          // office takes it out (§6.2.10 part 2). No batch exists yet, so there
          // is nothing excluded to untick.
          selection={{
            name: 'trip',
            label: t('preview.available'),
            alsoPost: 'shown',
            defaultCheckedFor: () => true,
          }}
          caption={t('preview.available')}
          sort={{
            key: view.sort.key,
            dir: view.sort.dir,
            hrefFor: view.sortFor(PATH),
            label: t('accounting.sortBy'),
          }}
          totalsLabel={pagedFooterLabel(
            t('preview.available'),
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
                                  {row.driverName ??
                                    t('preview.reason.noDriver')}
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
      </CreateBatch>
    </>
  )
}
