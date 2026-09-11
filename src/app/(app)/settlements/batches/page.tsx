import Link from 'next/link'
import { withCurrentOrg, currentUserCan } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { NewBatchForm } from './NewBatchForm'

// MONEY-DESIGN item 3 — the minimum screen this item needs, and no more.
// `Money -> This week` is item 6 and is deliberately not built here.

export default async function BatchesPage() {
  const { t, locale } = await getLocaleContext()
  const mayCreate = await currentUserCan('create', 'settlement')

  const { batches, companies } = await withCurrentOrg(
    'read',
    'settlement',
    async (tx) => ({
      batches: await tx.settlementBatch.findMany({
        where: { deletedAt: null },
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        take: 30,
        select: {
          id: true,
          batchNumber: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          company: { select: { name: true } },
          settlements: { select: { netCents: true } },
        },
      }),
      companies: await tx.company.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    }),
  )

  const day = (value: Date) => value.toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-z5 p-z5">
      <h1 className="text-lg font-medium text-ink">{t('batch.title')}</h1>

      {mayCreate ? (
        <NewBatchForm
          companies={companies}
          labels={{
            heading: t('batch.new'),
            company: t('batch.company'),
            week: t('batch.week'),
            weekHint: t('batch.weekHint'),
            statementDate: t('batch.statementDate'),
            checkDate: t('batch.checkDate'),
            create: t('batch.create'),
          }}
        />
      ) : null}

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-ink-2">
            <tr>
              <th className="p-z3 text-start">{t('batch.statement')}</th>
              <th className="p-z3 text-start">{t('batch.company')}</th>
              <th className="p-z3 text-start">{t('batch.week')}</th>
              <th className="p-z3 text-end">{t('batch.net')}</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch.id} className="border-t border-border">
                <td className="p-z3">
                  <Link
                    href={`/settlements/batches/${batch.id}`}
                    className="font-mono hover:text-accent"
                  >
                    {batch.batchNumber ?? batch.status}
                  </Link>
                </td>
                <td className="p-z3">{batch.company.name}</td>
                <td className="p-z3 font-mono text-xs">
                  {day(batch.periodStart)} — {day(batch.periodEnd)}
                </td>
                <td className="p-z3 text-end font-mono">
                  {formatCents(
                    batch.settlements.reduce((sum, s) => sum + s.netCents, 0),
                    locale,
                  )}
                </td>
              </tr>
            ))}
            {batches.length === 0 ? (
              <tr>
                <td className="p-z4 text-ink-3" colSpan={4}>
                  {t('batch.none')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
