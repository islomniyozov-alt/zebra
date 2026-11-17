import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { listedAuthorities } from '@/lib/companies'
import {
  dayFromParam,
  isBatchPeriod,
  lastFullSettlementWeek,
} from '@/lib/settlement-week'
import {
  previewBatch,
  UNAVAILABLE_REASONS,
  type UnavailableReason,
} from '@/lib/batch-preview'
import { applyList, type RawParams } from '@/lib/list-view'
import {
  batchOverlapWhere,
  SETTLEMENT_BATCH_TIMEOUT_MS,
} from '@/lib/settlement-batch'
import { EmptyState } from '@/components/ui/EmptyState'
import { BatchTripsGrid } from '../BatchTripsGrid'
import { FilterBar } from '@/components/ui/FilterBar'
import { PageHeader } from '../../../_grid/PageHeader'
import { AuthorityFilter } from '../../../_grid/AuthorityFilter'
import { gridView, pagedFooterLabel } from '../../../_grid/grid-page'
import { CreateBatch } from './CreateBatch'
import type { MessageKey } from '@/lib/i18n'

// PAYROLL → BATCHES → CREATE BATCH (owner's ruling, 2026-09-29; §6.2.10 part 7
// step 2, owner's rulings 2026-11-17).
//
// Authority and a date range, the freight that would go in, and everything
// that would not — grouped by why.
//
// ── THE AUTHORITY IS REQUIRED, AND IT SCOPES THE BATCH (part 7, R2) ───────
//
// Datatruck opens one batch per paying company and so does Zebra now: the
// authority chosen here is the batch's `companyId`. With none chosen the grid
// still shows every authority's freight, the line above it says an authority
// is needed, and Create is off.
//
// ── THE RANGE IS WHAT OPENS (part 7, R1) ─────────────────────────────────
//
// From and To are free, pre-filled with the last FULL settlement week. What
// the screen shows is what Create opens — no snapping to a week. A range that
// overlaps a live batch for the same authority is named above the grid and
// Create is off, because weekly charges are taken once per statement and two
// overlapping batches would take them twice (the overlap ruling).

const PATH = '/payroll/batches/new'

/** §6.2.1 — how many load numbers one reason lists before it says "and N more". */
const LIST_CAP = 40

/** Groups at or below this open themselves; longer ones start shut. */
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

const day = (value: Date) => value.toISOString().slice(0, 10)

export default async function OpenBatchPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('create', 'settlement'))) notFound()

  const raw = await searchParams
  const { t } = await getLocaleContext()

  // THE LAST FULL SETTLEMENT WEEK IS THE DEFAULT RANGE (part 7, R1) — the
  // Sunday-to-Saturday week before this one, 11/08–11/14 on 11/17 — and the
  // parser is the action's own, so the range seen is the range opened.
  const lastFull = lastFullSettlementWeek(new Date())
  const from = dayFromParam(raw.from) ?? lastFull.start
  const to = dayFromParam(raw.to) ?? lastFull.end
  const validRange = isBatchPeriod({ start: from, end: to })

  const companyId =
    typeof raw.company === 'string' && raw.company !== '' ? raw.company : null

  const data = await withCurrentOrg(
    'create',
    'settlement',
    async (tx, session) => {
      const [preview, companies, existing] = await Promise.all([
        previewBatch(tx, { from, to, companyId }),
        listedAuthorities(tx, session.companyScopes),
        // A BATCH THIS ONE WOULD OVERLAP — the predicate `openBatch` refuses
        // on, so the screen and the create cannot disagree. Saying so before
        // the click is the difference between a form and a trap. Asked only
        // with an authority and a valid range: without them there is no create.
        companyId !== null && validRange
          ? tx.settlementBatch.findFirst({
              where: batchOverlapWhere({
                organizationId: session.organizationId,
                period: { start: from, end: to },
                companyId,
              }),
              select: { id: true, batchNumber: true, status: true },
            })
          : Promise.resolve(null),
      ])
      return { preview, companies, existing }
    },
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  // THE NINE COLUMNS LIVE IN `BatchTripsGrid` (§6.2.10 part 2b), shared with the
  // batch screen so "what would go in" and "what is in" cannot drift apart.

  // TWO GROUPS OF ONE `available` (owner's catch-up ruling 2026-11-17): the
  // range's trips in the paged grid, and those delivered before the range and
  // not yet paid, listed whole under it. Both go into the batch.
  const inRange = data.preview.available.filter((trip) => !trip.earlier)
  const earlier = data.preview.available
    .filter((trip) => trip.earlier)
    .sort((a, b) => a.loadNumber.localeCompare(b.loadNumber))

  const view = gridView(
    inRange,
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
          // THE RANGE BOUNDS THE DELIVERY DATE (MONEY-DESIGN §6, 2026-11-17).
          label: t('preview.deliveryDate'),
          fromLabel: t('accounting.from'),
          toLabel: t('accounting.to'),
          // THE PRE-FILL IS SHOWN, not implied by empty boxes (part 7, R1).
          defaultFrom: day(lastFull.start),
          defaultTo: day(lastFull.end),
        }}
        clearLabel={t('filter.clear')}
        moreLabel={t('filter.more')}
      />

      {/* The bar the chips used to bring with them; the dropdown is inline
       * and the screen owns the row (§6.3, 2026-11-06). */}
      <div className="flex items-center gap-z3 border-b border-border bg-surface px-gutter py-z2">
        <AuthorityFilter
          companies={data.companies}
          label={t('accounting.company')}
          allLabel={t('accounting.allCompanies')}
        />
      </div>

      {/* ── WHAT CREATE WOULD ACTUALLY DO ─────────────────────────────────
       * Said before the button is pressed: the range it opens — exactly the
       * one above, no longer snapped to a week (part 7, R1) — and the
       * authority it settles, or that one is needed (R2). */}
      <div className="flex flex-wrap items-baseline gap-z3 border-b border-border bg-surface-2 px-gutter py-z2 text-xs text-ink-2">
        <span>
          {t('preview.willOpen')}{' '}
          <span className="font-mono text-ink" dir="ltr">
            {day(from)} — {day(to)}
          </span>
        </span>
        <span>
          {companyId === null ? (
            <span className="text-warning">{t('preview.needAuthority')}</span>
          ) : (
            `${t('preview.forCompany')} ${
              data.companies.find((company) => company.id === companyId)
                ?.name ?? companyId
            }`
          )}
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
        {!validRange ? (
          <span className="text-danger">{t('batch.error.badRange')}</span>
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
        from={day(from)}
        to={day(to)}
        companyId={companyId ?? ''}
        // OFF WITHOUT AN AUTHORITY (R2), ON A RANGE THAT IS NOT ONE (R1), AND
        // OVER A BATCH THIS ONE WOULD OVERLAP (the overlap ruling). The action
        // refuses all three again on its own account.
        disabled={companyId === null || !validRange || data.existing !== null}
        shown={view.paged.rows.length + earlier.length}
        labels={{
          add: t('preview.add'),
          selectAll: t('preview.selectAll'),
          period: `${day(from)} — ${day(to)}`,
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
              {/* ── DELIVERED EARLIER, NOT YET PAID (owner's catch-up ruling
               * 2026-11-17, MONEY-DESIGN §6) ────────────────────────────────
               *
               * Every Delivered trip of this authority on no statement, from
               * before the range, however long ago: the batch drafts them, so
               * the screen lists them BY NAME, ticked by default, in the same
               * form — an untick is an exclusion like any other. The range's
               * no-overlap rule does not apply to these; the statement fence
               * keeps each from being paid twice. Omitted when empty (§4). */}
              {earlier.length > 0 ? (
                <section className="border-t border-border">
                  <h2 className="bg-surface-2 px-gutter py-z2 text-sm font-medium text-ink">
                    {t('preview.earlier')}{' '}
                    <span className="font-mono tabular-nums text-ink-3">
                      {earlier.length}
                    </span>
                  </h2>
                  <p className="bg-surface-2 px-gutter pb-z2 text-xs text-ink-3">
                    {t('preview.earlierHint')}
                  </p>
                  <BatchTripsGrid
                    rows={earlier}
                    footRows={earlier}
                    companyId={companyId}
                    selection={{
                      name: 'trip',
                      label: t('preview.earlier'),
                      alsoPost: 'shown',
                      defaultCheckedFor: () => true,
                    }}
                    caption={t('preview.earlier')}
                    sort={{
                      key: 'loadNumber',
                      dir: 'asc',
                      hrefFor: view.sortFor(PATH),
                      label: t('accounting.sortBy'),
                    }}
                    totalsLabel={`${t('preview.earlier')} · ${earlier.length}`}
                    empty={null}
                  />
                </section>
              ) : null}
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
