import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { weekTrouble } from '@/lib/payroll'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import type { Week } from '@/lib/settlement-week'
import type { MessageKey } from '@/lib/i18n'

interface Props {
  period: Week
  batchId: string | null
  batchStatus: string | null
}

/**
 * Who cannot be paid this week, streamed in behind the grid.
 *
 * ── ITS OWN COMPONENT SO IT CAN HAVE ITS OWN `<Suspense>` ────────────────
 *
 * Owner's ruling, 2026-09-29. The strip cost 8,493ms and nine statements on
 * every load of the Batches tab, against 408ms for the grid it sat above —
 * so the page waited nine seconds to render four rows that were ready in one.
 *
 * NOTHING IS HIDDEN BY STREAMING IT. The same facts arrive, in the same place,
 * a moment later; what changes is that the grid no longer waits for them. §11
 * forbids motion that moves content being read, and this appends BELOW the
 * strip's own reserved line rather than pushing the grid around.
 *
 * WHERE A BATCH EXISTS THIS IS TWO QUERIES, NOT NINE — `weekTrouble` reads the
 * answer the last refresh WROTE instead of recomputing it. The expensive path
 * is the one where no batch exists, which is also the one where nothing is
 * stored to read.
 */
export async function WeekStrip({ period, batchId, batchStatus }: Props) {
  const { t, locale } = await getLocaleContext()

  const trouble = await withCurrentOrg(
    'read',
    'settlement',
    (tx, session) =>
      weekTrouble(tx, {
        organizationId: session.organizationId,
        period,
        batchId,
        batchStatus,
      }),
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  if (trouble.blockers.length === 0 && trouble.heldCount <= 0) return null

  return (
    <section className="border-b border-border bg-danger-soft px-gutter py-z3">
      <div className="flex flex-wrap items-baseline gap-z3">
        <h2 className="text-sm font-medium text-danger">
          {t('batch.blockers')}
        </h2>
        {/* HELD IS UNKNOWN ON THE STORED PATH, and says so rather than showing
         * a zero. A held line is one the engine declined to price and nothing
         * is written for it, so its absence from the rows looks identical to
         * there being none — §8's rule that empty and zero are different
         * facts, applied to a figure this screen cannot honestly produce. */}
        {trouble.heldCount > 0 ? (
          <span className="text-xs text-warning">
            {t('payroll.heldSum')} {formatCents(trouble.heldSumCents, locale)}
          </span>
        ) : null}
        {trouble.fromStored ? (
          <span className="text-xs text-ink-3">{t('payroll.fromStored')}</span>
        ) : null}
      </div>
      <ul className="mt-z1 flex flex-wrap gap-x-z5 gap-y-z1 text-xs text-ink">
        {trouble.blockers.map((row) => (
          <li key={row.driverId}>
            <span className="font-medium">{row.driverName}</span> —{' '}
            {t(row.reason as MessageKey)}
          </li>
        ))}
      </ul>
    </section>
  )
}
