import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { listSettlements, type SettlementRow } from '@/lib/settlements'
import { lastFullWeekAcross } from '@/lib/settings'
import { formatCents } from '@/lib/money'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { GeneratePanel } from './GeneratePanel'
import type { SettlementStatus } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// §5 step 6 — the Friday screen.

const TONE: Record<SettlementStatus, StatusTone> = {
  DRAFT: 'neutral',
  APPROVED: 'progress',
  PAID: 'success',
  VOID: 'muted',
}

const ERROR_KEYS: MessageKey[] = [
  'settlements.error.driverNotFound',
  'settlements.error.noLoads',
  'settlements.error.badPeriod',
  'settlements.error.noRule',
  'settlements.error.customUnsupported',
  'settlements.error.ruleIncomplete',
  'settlements.error.noMiles',
]

export default async function SettlementsPage() {
  if (!(await currentUserCan('read', 'settlement'))) notFound()

  const { t, locale } = await getLocaleContext()
  const mayGenerate = await currentUserCan('create', 'settlement')

  const data = await withCurrentOrg(
    'read',
    'settlement',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)
      const [settlements, drivers] = await Promise.all([
        listSettlements(tx, scope),
        mayGenerate
          ? tx.driver.findMany({
              // Every status except INACTIVE — AVAILABLE, DISPATCHED,
              // ON_ROUTE, OFF_DUTY and VACATION are all people who may have
              // run freight in the period being settled.
              where: {
                deletedAt: null,
                status: { not: 'INACTIVE' },
                ...scope,
              },
              orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
              select: { id: true, firstName: true, lastName: true },
            })
          : Promise.resolve([]),
      ])
      // THE BOUNDARY, READ FROM THE AUTHORITY. Phase 3 hard-coded Sunday;
      // Phase 4 step 6 gave it a column. Scoped, so a dispatcher settling for
      // one carrier is not offered the other carrier's week.
      const boundaries = await tx.companySettings.findMany({
        where: { ...scope, company: { isActive: true } },
        select: { settlementWeekEndsOn: true },
      })

      return {
        settlements,
        drivers,
        endsOn: boundaries.map((row) => row.settlementWeekEndsOn),
      }
    },
  )

  const day = (value: Date) => value.toISOString().slice(0, 10)
  const week = lastFullWeekAcross(new Date(), data.endsOn)
  const translate = Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))

  const columns: Column<SettlementRow>[] = [
    {
      key: 'number',
      header: t('settlements.number'),
      render: (row) => (
        <span className="font-mono">{row.settlementNumber}</span>
      ),
    },
    {
      key: 'driver',
      header: t('settlements.driver'),
      truncate: true,
      render: (row) => row.driverName,
    },
    {
      key: 'period',
      header: t('settlements.period'),
      render: (row) => (
        <span className="font-mono text-xs">
          {day(row.periodStart)} → {day(row.periodEnd)}
        </span>
      ),
    },
    {
      key: 'gross',
      header: t('settlements.gross'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums">
          {formatCents(row.grossCents, locale)}
        </span>
      ),
    },
    {
      key: 'deductions',
      header: t('settlements.deductions'),
      align: 'end',
      render: (row) =>
        row.deductionsCents === 0 ? (
          <span className="text-ink-3">—</span>
        ) : (
          // Shown NEGATIVE, because that is what it does to the net beside it.
          <span className="font-mono tabular-nums">
            {formatCents(-row.deductionsCents, locale)}
          </span>
        ),
    },
    {
      key: 'net',
      header: t('settlements.net'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums font-medium">
          {formatCents(row.netCents, locale)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('settlements.status'),
      render: (row) => (
        <StatusBadge
          tone={TONE[row.status]}
          label={t(`settlementStatus.${row.status}` as MessageKey)}
        />
      ),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('settlements.title')}
        </h1>
      </div>

      {mayGenerate ? (
        <GeneratePanel
          drivers={[
            { value: '', label: '—' },
            ...data.drivers.map((driver) => ({
              value: driver.id,
              label: `${driver.lastName}, ${driver.firstName}`,
            })),
          ]}
          defaultStart={week.start}
          defaultEnd={week.end}
          translate={translate}
          labels={{
            heading: t('settlements.generate'),
            hint: t('settlements.generateHint'),
            driver: t('settlements.driver'),
            from: t('settlements.from'),
            to: t('settlements.to'),
            generate: t('settlements.generate'),
          }}
        />
      ) : null}

      <Table
        caption={t('settlements.title')}
        columns={columns}
        rows={data.settlements}
        rowKey={(row) => row.id}
        rowHref={(row) => `/settlements/${row.id}`}
        stripeTone={(row) => TONE[row.status]}
        empty={
          <EmptyState
            title={t('settlements.empty.title')}
            body={t('settlements.empty.body')}
          />
        }
      />
    </>
  )
}
