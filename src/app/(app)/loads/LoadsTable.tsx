'use client'
import type { Warning, WarningName } from '@/lib/warnings'
import { WarningCell } from '@/components/WarningCell'

import { useSearchParams } from 'next/navigation'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { useRouter, usePathname } from 'next/navigation'
import { ColumnsChooser } from '../_grid/ColumnsChooser'
import { keepColumns } from '../_grid/grid-page'
import { billingTone, operationalTone, type StatusTone } from '@/lib/status'
import type {
  LoadBillingStatus,
  LoadOperationalStatus,
} from '@/generated/prisma/client'

// The Loads screen's table. TEN COLUMNS DECLARED — nine when the organization
// holds a single authority (§6.3) — AND NINE SHOWN, behind §7.1.4's chooser.
//
// This comment said "eight, or seven" and was accurate when it was written. The
// warnings column arrived on 2026-09-20, took the count to ten for every
// multi-authority carrier, and §7.1's throw in `Table` turned the screen into a
// 500 that nobody saw until the UAT live check on 2026-10-04. A column count in
// a comment is a count nobody re-runs; `tests/list-columns.test.ts` re-runs this
// one.

export interface LoadRow {
  id: string
  loadNumber: string
  /** Amazon's Trip ID, or whatever the broker calls this freight. */
  reference: string | null
  companyName: string
  customerName: string
  pickup: string
  delivery: string
  truck: string
  operationalStatus: LoadOperationalStatus
  billingStatus: LoadBillingStatus
  /** Pre-formatted in the request's locale. Money never crosses as a number. */
  rate: string
  isCancelled: boolean
  warnings: readonly Warning[]
}

interface LoadsTableProps {
  rows: readonly LoadRow[]
  showCompanyColumn: boolean
  /**
   * The columns this person keeps (§7.1.7). Decided on the server, where the
   * preference row is — `visibleWithinCap` is also what guarantees it is nine or
   * fewer, so this component never hands `Table` a count that throws.
   */
  visible: readonly string[]
  labels: {
    /** The warnings column header, and the two strings inside a cell. */
    warnings: string
    warningCount: string
    warningClear: string
    warningNames: Record<WarningName, string>
    caption: string
    load: string
    reference: string
    company: string
    customer: string
    pickup: string
    delivery: string
    truck: string
    status: string
    billing: string
    rate: string
    emptyTitle: string
    emptyBody: string
    emptyFilteredTitle: string
    emptyFilteredBody: string
    clearFilters: string
    /** §7.1.4's chooser: the button, the two buttons inside it, and the note. */
    columns: string
    columnsApply: string
    columnsCancel: string
    columnsFirstLocked: string
  }
  /** Pre-translated maps. Functions cannot cross to a client component. */
  statusLabels: Record<string, string>
  billingLabels: Record<string, string>
  /** Keyed by the message key the action returns, as `ColumnsChooser` expects. */
  columnErrors: Record<string, string>
}

export function LoadsTable({
  rows,
  showCompanyColumn,
  visible,
  labels,
  statusLabels,
  billingLabels,
  columnErrors,
}: LoadsTableProps) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const filtered = params.size > 0

  const columns: Column<LoadRow>[] = [
    {
      key: 'loadNumber',
      header: labels.load,
      // THE REFERENCE RIDES WITH THE LOAD NUMBER RATHER THAN IN A COLUMN OF
      // ITS OWN. The reason given here was §7.1's cap "with anything past that
      // behind a column chooser this application does not have" — it has one
      // now (§7.1.4, and §7.1.7 put it on this list), so what is left is the
      // reason that was always the better one: both are identity, and a
      // dispatcher scans ONE place for "which load is this".
      //
      // Never truncated. These are the fields people copy and read down a
      // phone.
      render: (row) => (
        <span className="flex flex-col">
          <span className="z-identifier">{row.loadNumber}</span>
          {row.reference === null ? null : (
            <span className="font-mono text-xs text-ink-3" dir="ltr">
              {labels.reference} {row.reference}
            </span>
          )}
        </span>
      ),
    },
    ...(showCompanyColumn
      ? [
          {
            key: 'company',
            header: labels.company,
            truncate: true,
            render: (row: LoadRow) => row.companyName,
          },
        ]
      : []),
    {
      key: 'customer',
      header: labels.customer,
      truncate: true,
      render: (row) => row.customerName,
    },
    {
      key: 'pickup',
      header: labels.pickup,
      truncate: true,
      render: (row) => row.pickup,
    },
    {
      key: 'delivery',
      header: labels.delivery,
      truncate: true,
      render: (row) => row.delivery,
    },
    {
      key: 'truck',
      header: labels.truck,
      render: (row) => <span className="z-identifier">{row.truck}</span>,
    },
    {
      key: 'status',
      header: labels.status,
      render: (row) => (
        // Operational: filled. Billing: outlined. Same hue vocabulary,
        // different construction, so the two are distinguishable at a glance
        // (§7.2).
        <StatusBadge
          tone={operationalTone(row.operationalStatus)}
          label={statusLabels[row.operationalStatus] ?? row.operationalStatus}
          variant="filled"
        />
      ),
    },
    {
      key: 'billing',
      header: labels.billing,
      render: (row) => (
        <StatusBadge
          tone={billingTone(row.billingStatus)}
          label={billingLabels[row.billingStatus] ?? row.billingStatus}
          variant="outlined"
        />
      ),
    },
    {
      key: 'rate',
      header: labels.rate,
      align: 'end',
      // Money: right-aligned, tabular, mono, never truncated (§8).
      render: (row) => <span className="z-identifier">{row.rate}</span>,
    },
    {
      key: 'warnings',
      header: labels.warnings,
      render: (row) => (
        <WarningCell
          warnings={row.warnings}
          labels={{
            count: labels.warningCount,
            clear: labels.warningClear,
            names: labels.warningNames,
          }}
        />
      ),
    },
  ]

  const stripeTone = (row: LoadRow): StatusTone =>
    operationalTone(row.operationalStatus)

  return (
    <>
      {/* THE CHOOSER IS WHY THIS TABLE IS LEGAL (§7.1.7). Ten columns, nine
       * shown, and billing status is a tick away rather than gone. It sits in a
       * bar of its own because the two above it belong to the page: ViewsBar is
       * saved views and density, FilterBar is what the URL selects. */}
      <div className="flex items-center justify-end border-b border-border bg-surface-2 px-gutter py-z2">
        <ColumnsChooser
          grid="loads.loads"
          columns={columns.map((column) => ({
            key: column.key,
            header: String(column.header),
          }))}
          visible={visible}
          labels={{
            open: labels.columns,
            apply: labels.columnsApply,
            cancel: labels.columnsCancel,
            firstLocked: labels.columnsFirstLocked,
          }}
          errors={columnErrors}
        />
      </div>
      <Table
        columns={keepColumns(columns, visible)}
        rows={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/loads/${row.id}`}
        stripeTone={stripeTone}
        isCancelled={(row) => row.isCancelled}
        caption={labels.caption}
        empty={
          // Two different sentences, because they are two different facts. An
          // empty table because nothing exists yet is not an empty table because
          // the filters exclude everything, and only the second has an obvious
          // way out (§10).
          filtered ? (
            <EmptyState
              title={labels.emptyFilteredTitle}
              body={labels.emptyFilteredBody}
              action={
                <Button
                  variant="secondary"
                  onClick={() => router.replace(pathname, { scroll: false })}
                >
                  {labels.clearFilters}
                </Button>
              }
            />
          ) : (
            <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />
          )
        }
      />
    </>
  )
}
