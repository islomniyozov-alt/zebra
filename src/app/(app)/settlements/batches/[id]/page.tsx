import { notFound } from 'next/navigation'
import { withCurrentOrg, currentUserCan } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { batchInputFor } from '@/lib/settlement-batch'
import { computeBatch } from '@/lib/settlement-week'
import { BatchActions } from './BatchActions'
import type { MessageKey } from '@/lib/i18n'

// MONEY-DESIGN item 3 — the draft list.
//
// ── WHAT THIS SCREEN IS FOR ──────────────────────────────────────────────
//
// Three things, and they are the three the ruling names: each driver's totals,
// the HELD LINES BY NAME, and the BLOCKERS BY NAME. A draft that showed only
// the totals would be a draft that looked finished while a load was silently
// out of it and a driver silently unpaid.
//
// The held lines and blockers are recomputed for display rather than stored,
// because they are facts about what is MISSING — and a stored absence goes
// stale the moment somebody supplies the thing.

export default async function BatchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { t, locale } = await getLocaleContext()
  const mayWrite = await currentUserCan('update', 'settlement')

  const data = await withCurrentOrg('read', 'settlement', async (tx) => {
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
            unitNumber: true,
            payTariffLabel: true,
            payoutDate: true,
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

    // A DRAFT'S HELD LINES AND BLOCKERS COME FROM THE ENGINE, not the rows —
    // see the header. A FINAL batch has neither by definition: it could not
    // have been finalised with a blocker, and its held lines are simply the
    // loads that are still waiting, which belong to next week's draft.
    if (batch.status !== 'DRAFT') {
      return { batch, held: [], blockers: [], negative: [] }
    }

    const { drivers } = await batchInputFor(tx, {
      organizationId: batch.organizationId,
      companyId: batch.companyId,
      period: { start: batch.periodStart, end: batch.periodEnd },
      statementDate: batch.statementDate,
      checkDate: batch.checkDate,
    })
    const computed = computeBatch({
      companyId: batch.companyId,
      period: { start: batch.periodStart, end: batch.periodEnd },
      statementDate: batch.statementDate,
      checkDate: batch.checkDate,
      drivers,
    })
    return {
      batch,
      held: computed.held,
      blockers: computed.blockers,
      negative: computed.negative,
    }
  })

  if (!data) notFound()
  const { batch, held, blockers, negative } = data
  const day = (value: Date | null) =>
    value === null ? '—' : value.toISOString().slice(0, 10)

  const heldReason = (kind: string): MessageKey =>
    kind === 'no_remittance'
      ? 'batch.held.noRemittance'
      : kind === 'over'
        ? 'batch.held.over'
        : 'batch.held.short'

  return (
    <div className="flex flex-col gap-z5 p-z5">
      <header className="flex flex-wrap items-baseline gap-z3">
        <h1 className="font-mono text-lg font-medium text-ink">
          {batch.batchNumber ?? batch.status}
        </h1>
        <p className="text-sm text-ink-2">{batch.company.name}</p>
        <p className="font-mono text-xs text-ink-3">
          {day(batch.periodStart)} — {day(batch.periodEnd)}
        </p>
        <p className="text-xs text-ink-3">
          {t('batch.statementDate')} {day(batch.statementDate)} ·{' '}
          {t('batch.checkDate')} {day(batch.checkDate)}
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

      {/* BLOCKERS FIRST, and by name. A driver with settleable freight and no
       * pay rule is a person who would otherwise be paid nothing and appear on
       * no list — so this sits above the totals, not below them. */}
      {blockers.length > 0 ? (
        <section className="rounded-card border border-danger bg-surface p-z4">
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
                  {batch.status === 'DRAFT' ? (
                    <span className="text-ink-3">{t('batch.refresh')}</span>
                  ) : (
                    <a
                      className="underline underline-offset-2 hover:text-accent"
                      href={`/api/settlements/statement/${settlement.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {settlement.settlementNumber}
                    </a>
                  )}
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
