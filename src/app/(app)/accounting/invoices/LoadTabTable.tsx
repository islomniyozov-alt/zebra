import Link from 'next/link'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCents } from '@/lib/money'
import { getLocaleContext } from '@/lib/locale'
import type { MessageKey } from '@/lib/i18n'
import type { LoadListRow } from '@/lib/load-list-rows'
import { renderDateOnly } from '@/lib/stop-time'
import {
  billingLabelKey,
  billingTone,
  operationalLabelKey,
  operationalTone,
} from '@/lib/status'

// BILLING → INVOICE'S LOAD TABS (§6.7, the second pass, owner's brief
// 2026-11-16): POD received, Uninvoiced, Invoiced, Partially paid and Paid,
// which were chips on `/loads`. LOADS, NOT INVOICES — an uninvoiced load has
// no invoice to list — a page of `pageSize`, newest booking first, each row
// opening its load. No foot: a page of a population is not a total of one.

interface Props {
  rows: readonly LoadListRow[]
  /** The tab's count: the pager's total. */
  total: number
  page: number
  pageSize: number
  /** The tab's own words, for the caption and the empty state. */
  labelKey: MessageKey
  showAuthority: boolean
  /** Where page `n` is, every other parameter kept. */
  pageHref: (page: number) => string
}

export async function LoadTabTable({
  rows,
  total,
  page,
  pageSize,
  labelKey,
  showAuthority,
  pageHref,
}: Props) {
  const { t, locale } = await getLocaleContext()
  const columns: Column<LoadListRow>[] = [
    {
      key: 'loadNumber',
      header: t('loads.column.load'),
      render: (row) => <span className="z-identifier">{row.loadNumber}</span>,
    },
    {
      key: 'reference',
      header: t('loads.column.reference'),
      render: (row) =>
        row.reference === null ? (
          '—'
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {row.reference}
          </span>
        ),
    },
    {
      key: 'customer',
      header: t('loads.column.customer'),
      truncate: true,
      render: (row) => row.customerName,
    },
    ...(showAuthority
      ? [
          {
            key: 'authority',
            header: t('loads.column.company'),
            truncate: true,
            render: (row: LoadListRow) => row.companyName,
          },
        ]
      : []),
    {
      key: 'deliveryDate',
      header: t('loads.column.deliveryDate'),
      render: (row) => (
        <span className="font-mono tabular-nums">
          {row.deliveryDay === null
            ? '—'
            : (renderDateOnly(
                new Date(`${row.deliveryDay}T00:00:00Z`),
                locale,
              ) ?? '—')}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('loads.column.status'),
      render: (row) => (
        <StatusBadge
          tone={operationalTone(row.operationalStatus)}
          label={t(operationalLabelKey(row.operationalStatus))}
          variant="filled"
        />
      ),
    },
    {
      key: 'billing',
      header: t('loads.column.billing'),
      render: (row) => (
        <StatusBadge
          tone={billingTone(row.billingStatus)}
          label={t(billingLabelKey(row.billingStatus))}
          variant="outlined"
        />
      ),
    },
    {
      key: 'rate',
      header: t('loads.column.rate'),
      align: 'end',
      // Money: right-aligned, tabular, mono (§8).
      render: (row) => (
        <span className="font-mono tabular-nums">
          {formatCents(row.linehaulCents, locale)}
        </span>
      ),
    },
  ]

  return (
    <>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/loads/${row.id}`}
        stripeTone={(row) => operationalTone(row.operationalStatus)}
        isCancelled={(row) => row.isCancelled}
        caption={t(labelKey)}
        empty={
          <EmptyState title={t(labelKey)} body={t('accounting.emptyHint')} />
        }
      />
      {total > pageSize ? (
        <nav
          aria-label={t('loads.pager.label')}
          className="flex items-center justify-between gap-z3 border-t border-border px-gutter py-z3"
        >
          <p className="text-sm text-ink-2">
            {t('loads.pager.range')
              .replace('{from}', String((page - 1) * pageSize + 1))
              .replace('{to}', String(Math.min(page * pageSize, total)))
              .replace('{total}', total.toLocaleString())}
          </p>
          <div className="flex items-center gap-z4">
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="text-sm font-medium text-accent hover:underline"
              >
                {t('loads.pager.previous')}
              </Link>
            ) : null}
            {page * pageSize < total ? (
              <Link
                href={pageHref(page + 1)}
                className="text-sm font-medium text-accent hover:underline"
              >
                {t('loads.pager.next')}
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  )
}
