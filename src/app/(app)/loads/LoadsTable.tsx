'use client'

import { useSearchParams } from 'next/navigation'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { useRouter, usePathname } from 'next/navigation'
import { billingTone, operationalTone, type StatusTone } from '@/lib/status'
import type {
  LoadBillingStatus,
  LoadOperationalStatus,
} from '@/generated/prisma/client'

// The Loads screen's table. Nine columns at most (§7.1), and this uses eight —
// or seven when the organization holds a single authority, because §6.3 as
// amended says the company column appears only when maxCompanies > 1.

export interface LoadRow {
  id: string
  loadNumber: string
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
}

interface LoadsTableProps {
  rows: readonly LoadRow[]
  showCompanyColumn: boolean
  labels: {
    caption: string
    load: string
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
  }
  /** Pre-translated maps. Functions cannot cross to a client component. */
  statusLabels: Record<string, string>
  billingLabels: Record<string, string>
}

export function LoadsTable({
  rows,
  showCompanyColumn,
  labels,
  statusLabels,
  billingLabels,
}: LoadsTableProps) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const filtered = params.size > 0

  const columns: Column<LoadRow>[] = [
    {
      key: 'loadNumber',
      header: labels.load,
      // Never truncated. This is the field people copy and read down a phone.
      render: (row) => <span className="z-identifier">{row.loadNumber}</span>,
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
  ]

  const stripeTone = (row: LoadRow): StatusTone =>
    operationalTone(row.operationalStatus)

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
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
  )
}
