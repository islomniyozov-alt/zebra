import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { formatCents } from '@/lib/money'
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_SUBJECTS,
  maintenanceList,
  type MaintenanceSubject,
  type WorkOrderRow,
} from '@/lib/maintenance'
import { FilterBar } from '@/components/ui/FilterBar'
import { Table, type Column } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import type { MaintenanceCategory } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// PHASE 4 §5 STEP 3 — maintenance across the fleet.
//
// Every work order in the scope, newest service first. The asset panels answer
// "what has THIS truck cost"; this answers "what did we spend in the shop and
// on what", which is the question that gets asked once a month and has never
// had a screen.
//
// THE COST COLUMN DOES NOT EXIST FOR A DISPATCHER. Not blanked, not dashed —
// `maintenanceList` is called with `maySeeCost` and never selects a cost into
// the payload, and the column is not added to the table, so the total row is
// not rendered either. A dispatcher sees that truck 104 was in for brakes on
// the 3rd, which is the fact that changes what they do.

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await currentUserCan('read', 'maintenance'))) notFound()

  const params = await searchParams
  const { t, locale } = await getLocaleContext()

  // `truck.financials` — money that appears on a FLEET screen. The resource
  // Phase 3's sweep introduced for exactly this shape, held by OWNER, ADMIN,
  // MANAGER and ACCOUNTING and not by a DISPATCHER. Flagged in
  // PHASE-4-BRIEF.md §6: if maintenance spend ever needs a different audience
  // from a truck's purchase price, this is where it splits.
  const maySeeCost = await currentUserCan('read', 'truck.financials')

  const subjectParam =
    typeof params['subject'] === 'string'
      ? (params['subject'] as MaintenanceSubject)
      : undefined
  const categoryParam =
    typeof params['category'] === 'string'
      ? (params['category'] as MaintenanceCategory)
      : undefined

  const { rows, totalCents, counts } = await withCurrentOrg(
    'read',
    'maintenance',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)

      // The filtered list, plus the UNFILTERED set the chip counts come from.
      // Counting from the filtered list makes every chip report the number of
      // rows already on screen — the one number a chip must not say.
      const [filtered, all] = await Promise.all([
        maintenanceList(
          tx,
          scope,
          {
            ...(subjectParam ? { subject: subjectParam } : {}),
            ...(categoryParam ? { category: categoryParam } : {}),
          },
          maySeeCost,
        ),
        maintenanceList(tx, scope, {}, maySeeCost),
      ])

      // Each chip's count honours the OTHER filter and ignores its own group,
      // so clicking one lands on exactly the number it promised.
      const bySubject = (subject: MaintenanceSubject) =>
        all.rows.filter(
          (row) =>
            row.subject === subject &&
            (!categoryParam || row.category === categoryParam),
        ).length
      const byCategory = (category: MaintenanceCategory) =>
        all.rows.filter(
          (row) =>
            row.category === category &&
            (!subjectParam || row.subject === subjectParam),
        ).length

      return {
        rows: filtered.rows,
        // The total of what is ON SCREEN, so it can be checked by adding the
        // column up. Undefined where costs are not visible.
        totalCents: filtered.totals?.costCents,
        counts: {
          subject: Object.fromEntries(
            MAINTENANCE_SUBJECTS.map((s) => [s, bySubject(s)]),
          ) as Record<string, number>,
          category: Object.fromEntries(
            MAINTENANCE_CATEGORIES.map((c) => [c, byCategory(c)]),
          ) as Record<string, number>,
        },
      }
    },
  )

  const isFiltered = Boolean(subjectParam || categoryParam)
  const day = (value: Date) => value.toISOString().slice(0, 10)

  const href = (row: WorkOrderRow) =>
    row.subject === 'trailer'
      ? `/trailers/${row.subjectId}`
      : `/trucks/${row.subjectId}`

  const columns: Column<WorkOrderRow>[] = [
    {
      key: 'serviced',
      header: t('maint.column.serviced'),
      render: (row) => <span className="font-mono">{day(row.servicedAt)}</span>,
    },
    {
      key: 'subject',
      header: t('maint.column.subject'),
      render: (row) => (
        // Straight to the asset, because the next thing anybody does with a
        // work order is look at what else that truck has been in for.
        <Link
          href={href(row)}
          className="z-identifier font-medium text-ink hover:text-accent"
        >
          {row.subjectLabel}
        </Link>
      ),
    },
    {
      key: 'category',
      header: t('maint.column.category'),
      render: (row) => t(`maintCategory.${row.category}` as MessageKey),
    },
    {
      key: 'description',
      header: t('maint.column.description'),
      truncate: true,
      render: (row) => row.description ?? '—',
    },
    {
      key: 'vendor',
      header: t('maint.column.vendor'),
      truncate: true,
      render: (row) => row.vendorName ?? '—',
    },
    {
      key: 'odometer',
      header: t('maint.column.odometer'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums">
          {row.odometer === null ? '—' : row.odometer.toLocaleString(locale)}
        </span>
      ),
    },
    {
      key: 'receipts',
      header: t('maint.column.receipts'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums text-ink-3">
          {row.documentCount === 0 ? '—' : row.documentCount}
        </span>
      ),
    },
    // THE COLUMN IS NOT ADDED AT ALL where the role cannot see money. Adding it
    // and rendering a dash would tell a dispatcher precisely how many numbers
    // they are not being shown, which is the leak in a different coat.
    ...(maySeeCost
      ? [
          {
            key: 'cost',
            header: t('maint.column.cost'),
            align: 'end' as const,
            render: (row: WorkOrderRow) => (
              <span className="font-mono tabular-nums">
                {formatCents(row.costCents ?? 0, locale)}
              </span>
            ),
          },
        ]
      : []),
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('maint.title')}</h1>
        <div className="flex items-baseline gap-z4">
          {totalCents === undefined ? null : (
            <p className="text-sm text-ink-3">
              {t('maint.spend')}{' '}
              <span className="font-mono tabular-nums font-medium text-ink">
                {formatCents(totalCents, locale)}
              </span>
            </p>
          )}
          <p className="max-w-[46ch] text-sm text-ink-3">{t('maint.hint')}</p>
        </div>
      </div>

      <FilterBar
        clearLabel={t('loads.filter.clear')}
        moreLabel={t('loads.filter.more')}
        groups={[
          {
            param: 'subject',
            label: t('maint.subject'),
            choices: MAINTENANCE_SUBJECTS.map((subject) => ({
              value: subject,
              label: t(`safety.subject.${subject}` as MessageKey),
              count: counts.subject[subject] ?? 0,
            })),
          },
          {
            param: 'category',
            label: t('maint.category'),
            choices: MAINTENANCE_CATEGORIES.map((category) => ({
              value: category,
              label: t(`maintCategory.${category}` as MessageKey),
              count: counts.category[category] ?? 0,
            })),
          },
        ]}
      />

      <Table
        caption={t('maint.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={
          // Two different sentences, because "nothing has been recorded" and
          // "nothing matches this filter" send a person to different places.
          isFiltered ? (
            <EmptyState
              title={t('maint.filtered.title')}
              body={t('maint.filtered.body')}
            />
          ) : (
            <EmptyState
              title={t('maint.empty.title')}
              body={t('maint.empty.body')}
            />
          )
        }
      />
    </>
  )
}
