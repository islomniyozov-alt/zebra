import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import {
  batchInputForOrg,
  SETTLEMENT_BATCH_TIMEOUT_MS,
} from '@/lib/settlement-batch'
import { computeBatch } from '@/lib/settlement-week'
import {
  previewBatch,
  UNAVAILABLE_REASONS,
  type UnavailableReason,
} from '@/lib/batch-preview'
import { applyList, type RawParams } from '@/lib/list-view'
import { EmptyState } from '@/components/ui/EmptyState'
import { gridView, pagedFooterLabel } from '../../../_grid/grid-page'
import { BatchTripsGrid } from '../../../payroll/batches/BatchTripsGrid'
import { BatchActions } from './BatchActions'
import { BatchTicks } from './BatchTicks'
import type { MessageKey } from '@/lib/i18n'

// THE BATCH SCREEN (§6.2.10 part 2b, production walk 2026-10-07).
//
// ── WHAT THIS ROUTE SERVED, AND WHY ──────────────────────────────────────
//
// MONEY-DESIGN item 3's draft list: each driver's totals, the HELD LINES BY
// NAME, the BLOCKERS BY NAME — with a Statement column that linked to the PDF
// after FINAL and said "Refresh draft" before it. §6.2.10 part 1 built the trip
// grid on the open-a-batch screen and part 2 persisted the ticks, and no part
// named the route a batch lives at afterwards. So opening a batch left the
// office on the picker, and every link to a batch landed here, on the previous
// screen.
//
// ── WHAT IT SERVES NOW ───────────────────────────────────────────────────
//
// The part 1 grid for THIS batch — its week, its scope, the same nine columns
// through the same reader — with the ticks read from the persisted exclusions.
// Save writes the delta through the two exclusion verbs. The item 3 facts stay
// below, and the Statement column links to the statement in every status.

/** §6.2.1 — how many load numbers one reason lists before it says "and N more". */
const LIST_CAP = 40
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
  const mayWrite = await currentUserCan('update', 'settlement')
  const path = `/settlements/batches/${id}`

  const data = await withCurrentOrg(
    'read',
    'settlement',
    async (tx) => {
      const batch = await tx.settlementBatch.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          batchNumber: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          statementDate: true,
          checkDate: true,
          organizationId: true,
          companyId: true,
          company: { select: { name: true } },
          settlements: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              settlementNumber: true,
              status: true,
              unitNumber: true,
              earningsCents: true,
              deductionsCents: true,
              otherPayCents: true,
              netCents: true,
              driver: { select: { firstName: true, lastName: true } },
              loadLines: { select: { id: true } },
            },
          },
        },
      })
      if (!batch) return null

      // THE GRID, FOR THIS BATCH: its week, its scope, the ticks from the
      // persisted exclusions (§6.2.10 part 2b).
      const preview = await previewBatch(tx, {
        from: batch.periodStart,
        to: batch.periodEnd,
        companyId: batch.companyId,
        forBatchId: batch.id,
      })

      const open = batch.status === 'DRAFT' || batch.status === 'PARTIAL'
      if (!open) {
        return { batch, preview, held: [], blockers: [], negative: [] }
      }

      // THE ITEM 3 FACTS: recomputed for display rather than stored, because
      // they are facts about what is MISSING, and a stored absence goes stale
      // the moment somebody supplies the thing. Over the same exclusions the
      // grid shows unticked, so the two cannot disagree.
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
      const computed = computeBatch({
        period: { start: batch.periodStart, end: batch.periodEnd },
        statementDate: batch.statementDate,
        checkDate: batch.checkDate,
        drivers,
      })
      return {
        batch,
        preview,
        held: computed.held,
        blockers: computed.blockers,
        negative: computed.negative,
      }
    },
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  if (!data) notFound()
  const { batch, preview, held, blockers, negative } = data
  const open = batch.status === 'DRAFT' || batch.status === 'PARTIAL'
  const day = (value: Date | null) =>
    value === null ? '—' : value.toISOString().slice(0, 10)

  const heldReason = (kind: string): MessageKey =>
    kind === 'no_remittance'
      ? 'batch.held.noRemittance'
      : kind === 'over'
        ? 'batch.held.over'
        : 'batch.held.short'

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

  return (
    <div className="flex flex-col gap-z5 p-z5">
      <header className="flex flex-wrap items-baseline gap-z3">
        <h1 className="font-mono text-lg font-medium text-ink">
          {batch.batchNumber ?? batch.status}
        </h1>
        <p className="font-mono text-xs text-ink-3">
          {day(batch.periodStart)} — {day(batch.periodEnd)}
        </p>
        <p className="text-xs text-ink-3">
          {t('batch.statementDate')} {day(batch.statementDate)} ·{' '}
          {t('batch.checkDate')} {day(batch.checkDate)}
        </p>
        {/* THE SCOPE, SAID: a named authority or the whole organization
         * (§6.2.10 part 1). */}
        <p className="text-xs text-ink-3">
          {batch.company?.name ?? t('preview.forOrg')}
        </p>
        <p className="ms-auto text-xs uppercase tracking-[0.04em] text-ink-2">
          {batch.status}
        </p>
      </header>

      {mayWrite ? (
        <BatchActions
          batchId={batch.id}
          status={batch.status}
          canFinalise={blockers.length === 0}
          labels={{
            refresh: t('batch.refresh'),
            finalise: t('batch.finalise'),
            markPaid: t('batch.markPaid'),
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

      {/* ── THE TRIPS, WITH THEIR TICKS (§6.2.10 part 2b) ────────────────── */}
      <section className="overflow-hidden rounded-card border border-border bg-surface">
        <div className="flex flex-wrap items-baseline gap-z3 border-b border-border px-gutter py-z2">
          <h2 className="text-md font-medium text-ink">{t('batch.trips')}</h2>
          <p className="text-xs text-ink-3">
            {open ? t('batch.tripsHint') : t('batch.tripsFinal')}
          </p>
        </div>
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
      </section>

      {/* ── THE STATEMENTS, EACH A LINK TO ITSELF IN EVERY STATUS ────────── */}
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-ink-2">
            <tr>
              <th className="p-z3 text-start">{t('batch.driver')}</th>
              <th className="p-z3 text-start">{t('batch.statement')}</th>
              <th className="p-z3 text-end">{t('batch.loads')}</th>
              <th className="p-z3 text-end">{t('batch.earnings')}</th>
              <th className="p-z3 text-end">{t('batch.deductions')}</th>
              <th className="p-z3 text-end">{t('batch.net')}</th>
            </tr>
          </thead>
          <tbody>
            {batch.settlements.map((settlement) => (
              <tr key={settlement.id} className="border-t border-border">
                <td className="p-z3">
                  {settlement.driver.firstName} {settlement.driver.lastName}
                  {settlement.unitNumber ? (
                    <span className="ms-z2 font-mono text-xs text-ink-3">
                      {settlement.unitNumber}
                    </span>
                  ) : null}
                </td>
                <td className="p-z3 font-mono text-xs">
                  {/* THE STATEMENT, THE WORKBENCH — in every status. A draft is
                   * a document somebody is working on, not one that cannot be
                   * opened; the PDF is the statement page's own export. */}
                  <Link
                    className="underline underline-offset-2 hover:text-accent"
                    href={`/settlements/${settlement.id}`}
                  >
                    {settlement.settlementNumber}
                  </Link>
                  <span className="ms-z2 text-ink-3">{settlement.status}</span>
                </td>
                <td className="p-z3 text-end font-mono">
                  {settlement.loadLines.length}
                </td>
                <td className="p-z3 text-end font-mono">
                  {formatCents(settlement.earningsCents, locale)}
                </td>
                <td className="p-z3 text-end font-mono">
                  {formatCents(settlement.deductionsCents, locale)}
                </td>
                {/* NEGATIVE NET IS PRINTED AND FLAGGED, never clamped and never
                 * carried forward — carry-forward is Islom's decision. */}
                <td
                  className={`p-z3 text-end font-mono ${settlement.netCents < 0 ? 'text-danger' : ''}`}
                >
                  {formatCents(settlement.netCents, locale)}
                </td>
              </tr>
            ))}
            {batch.settlements.length === 0 ? (
              <tr>
                <td className="p-z4 text-ink-3" colSpan={6}>
                  {t('batch.none')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* HELD LINES, BY NAME. The draft never silently includes or excludes
       * one — §3. Each says which load, whose it is, and why it is waiting. */}
      {held.length > 0 ? (
        <section className="rounded-card border border-border bg-surface p-z4">
          <h2 className="text-md font-medium text-ink">{t('batch.held')}</h2>
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
  )
}
