import type { ReactNode } from 'react'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { operationalLabelKey } from '@/lib/status'
import type { LoadOperationalStatus } from '@/generated/prisma/client'
import type { PreviewTrip } from '@/lib/batch-preview'
import { sumCents } from '@/lib/list-view'
import { Table, type Column, type TableSort } from '@/components/ui/Table'
import type { MessageKey } from '@/lib/i18n'

// THE TRIP GRID, ONCE (§6.2.10 part 2b). The picker renders it for "what would
// go in" and the batch screen for "what is in", so the nine columns cannot drift
// apart between the two. The page owns the data, the sort, the paging and the
// form around the ticks; this owns only the columns and the table.

const day = (value: Date) => value.toISOString().slice(0, 10)

export interface BatchTripsGridProps {
  rows: readonly PreviewTrip[]
  footRows: readonly PreviewTrip[]
  /** The chip's company; null shows each row's authority under the payee. */
  companyId: string | null
  sort: TableSort
  caption: string
  totalsLabel: string
  empty: ReactNode
  below?: ReactNode
  /**
   * The ticks, or none for a read-only grid (a FINAL batch is a document).
   * `defaultCheckedFor` decides the box per row; the picker ticks everything,
   * the batch screen ticks what the batch has not excluded.
   */
  selection: {
    name: string
    label: string
    alsoPost: string
    defaultCheckedFor: (row: PreviewTrip) => boolean
  } | null
}

export async function BatchTripsGrid({
  rows,
  footRows,
  companyId,
  sort,
  caption,
  totalsLabel,
  empty,
  below,
  selection,
}: BatchTripsGridProps) {
  const { t, locale } = await getLocaleContext()

  // The four sentences the settlement screens already use for the four ways a
  // pay rule can fail to produce a figure.
  const PAY_PROBLEM: Record<
    NonNullable<PreviewTrip['payProblem']>,
    MessageKey
  > = {
    no_rule: 'settlements.error.noRule',
    custom_unsupported: 'settlements.error.customUnsupported',
    rule_incomplete: 'settlements.error.ruleIncomplete',
    no_miles: 'settlements.error.noMiles',
  }

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )

  // ── NINE COLUMNS, WHICH IS §7.1's CAP EXACTLY (§6.2.10 part 1) ──────────
  //
  // ID · payee · driver type · load ref · status · load pay · pickup · delivery ·
  // locations. The office's own shape, in the office's own order. The authority
  // rides in the payee cell rather than taking a tenth column.
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
      key: 'payee',
      header: t('preview.payee'),
      truncate: true,
      sortable: true,
      render: (row) => (
        <span className="flex flex-col">
          <span>{row.payeeName ?? <span className="text-ink-3">—</span>}</span>
          {companyId === null ? (
            <span className="text-xs text-ink-3">{row.companyName}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'driverType',
      header: t('preview.driverType'),
      sortable: true,
      render: (row) =>
        row.driverType === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          t(`drivers.type.${row.driverType}` as MessageKey)
        ),
    },
    {
      key: 'ref',
      header: t('loads.column.reference'),
      truncate: true,
      render: (row) =>
        row.referenceNumber === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {row.referenceNumber}
          </span>
        ),
    },
    {
      key: 'status',
      header: t('ref.status'),
      sortable: true,
      render: (row) =>
        t(operationalLabelKey(row.status as LoadOperationalStatus)),
    },
    {
      key: 'gross',
      header: t('settlements.trip.gross'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.grossCents),
      foot: (all) => money(sumCents(all, (row) => row.grossCents)),
    },
    {
      key: 'loadPay',
      header: t('preview.loadPay'),
      align: 'end',
      sortable: true,
      // THE DRIVER'S CUT, OR WHY THERE ISN'T ONE, in words (owner's ruling
      // 2026-10-05) — never a dash that reads as zero.
      render: (row) =>
        row.loadPayCents === null ? (
          <span className="text-xs text-warning">
            {t(PAY_PROBLEM[row.payProblem ?? 'no_rule'])}
          </span>
        ) : (
          money(row.loadPayCents)
        ),
      // THE FOOT SUMS WHAT CAN BE PAID: a null is not a zero.
      foot: (all) => money(sumCents(all, (row) => row.loadPayCents ?? 0)),
    },
    {
      key: 'dates',
      header: `${t('loads.column.pickup')} → ${t('loads.column.delivery')}`,
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.pickupAt ? day(row.pickupAt) : '—'} →{' '}
          {row.deliveredAt ? day(row.deliveredAt) : '—'}
        </span>
      ),
    },
    {
      key: 'locations',
      header: t('preview.locations'),
      truncate: true,
      render: (row) => row.locations ?? <span className="text-ink-3">—</span>,
    },
  ]

  return (
    <Table
      columns={columns}
      rows={rows}
      footRows={footRows}
      rowKey={(row) => row.loadId}
      // NO `rowHref`: a ticked row is a control, and a stretched link over it
      // would make "open the load" and "untick the trip" the same gesture.
      selection={
        selection
          ? {
              name: selection.name,
              label: selection.label,
              defaultCheckedFor: selection.defaultCheckedFor,
              // EVERY OFFERED ROW POSTS ITS ID, ticked or not, so the action
              // computes shown minus ticked without re-reading the window.
              alsoPost: selection.alsoPost,
              // A TRIP NOBODY CAN PRICE IS NOT OFFERED (owner's ruling): shown
              // with the reason in words, posting nothing, so it is neither in
              // the batch nor recorded as a decision to leave it out.
              offerFor: (row) => row.loadPayCents !== null,
            }
          : undefined
      }
      caption={caption}
      sort={sort}
      totals={{ label: totalsLabel }}
      empty={empty}
      below={below}
    />
  )
}
