import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { formatCents } from '@/lib/money'
import {
  CLAIM_STATUSES,
  CLAIM_TYPES,
  claimList,
  type ClaimRow,
} from '@/lib/claims'
import { Button } from '@/components/ui/Button'
import { FilterBar } from '@/components/ui/FilterBar'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ClaimStatus, ClaimType } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// PHASE 4 §5 STEP 5 — /safety/claims.
//
// Cargo, accidents, shortages: everything somebody wants paid for. Newest
// incident first, because the question this screen answers is "what is open
// against us right now" and a claim from March is not that.
//
// §2.5 keeps a DISPATCHER out of here entirely — a claim carries an amount and
// a dispute, and neither is theirs. That is a permission on the resource, not
// a hidden column, so the route 404s rather than rendering an empty table.

const TONE: Record<ClaimStatus, StatusTone> = {
  OPEN: 'warning',
  UNDER_REVIEW: 'progress',
  DISPUTED: 'danger',
  RESOLVED: 'success',
  DENIED: 'muted',
  CLOSED: 'muted',
}

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await currentUserCan('read', 'claim'))) notFound()
  const mayFile = await currentUserCan('create', 'claim')

  const params = await searchParams
  const { t, locale } = await getLocaleContext()

  const typeParam =
    typeof params['type'] === 'string'
      ? (params['type'] as ClaimType)
      : undefined
  const statusParam =
    typeof params['status'] === 'string'
      ? (params['status'] as ClaimStatus)
      : undefined
  const openOnly = params['working'] === 'yes'

  const { rows, counts } = await withCurrentOrg(
    'read',
    'claim',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)

      const [filtered, all] = await Promise.all([
        claimList(tx, scope, {
          ...(typeParam ? { type: typeParam } : {}),
          ...(statusParam ? { status: statusParam } : {}),
          ...(openOnly ? { openOnly: true } : {}),
        }),
        claimList(tx, scope),
      ])

      // Each chip honours the OTHER filters and ignores its own group, so
      // clicking one lands on exactly the number it promised.
      const matches = (row: ClaimRow, ignore: 'type' | 'status' | 'working') =>
        (ignore === 'type' || !typeParam || row.type === typeParam) &&
        (ignore === 'status' || !statusParam || row.status === statusParam) &&
        (ignore === 'working' || !openOnly || row.status !== 'CLOSED')

      return {
        rows: filtered,
        counts: {
          type: Object.fromEntries(
            CLAIM_TYPES.map((type) => [
              type,
              all.filter((row) => matches(row, 'type') && row.type === type)
                .length,
            ]),
          ) as Record<string, number>,
          status: Object.fromEntries(
            CLAIM_STATUSES.map((status) => [
              status,
              all.filter(
                (row) => matches(row, 'status') && row.status === status,
              ).length,
            ]),
          ) as Record<string, number>,
          working: all.filter(
            (row) => matches(row, 'working') && row.status !== 'CLOSED',
          ).length,
        },
      }
    },
  )

  const isFiltered = Boolean(typeParam || statusParam || openOnly)
  const day = (value: Date) => value.toISOString().slice(0, 10)

  const columns: Column<ClaimRow>[] = [
    {
      key: 'incident',
      header: t('claims.column.incident'),
      render: (row) => (
        <Link
          href={`/safety/claims/${row.id}`}
          className="z-identifier font-medium text-ink hover:text-accent"
        >
          {row.incidentAt ? day(row.incidentAt) : day(row.createdAt)}
        </Link>
      ),
    },
    {
      key: 'type',
      header: t('claims.column.type'),
      truncate: true,
      render: (row) => t(`claimType.${row.type}` as MessageKey),
    },
    {
      key: 'claimant',
      header: t('claims.column.claimant'),
      truncate: true,
      render: (row) => row.claimantName ?? row.customer?.name ?? '—',
    },
    {
      key: 'load',
      header: t('claims.column.load'),
      render: (row) =>
        row.load ? (
          <Link
            href={`/loads/${row.load.id}`}
            className="z-identifier text-accent hover:underline"
          >
            {row.load.loadNumber}
          </Link>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'number',
      header: t('claims.column.number'),
      // Never truncated: their claim number is what goes in the subject line.
      render: (row) => (
        <span className="font-mono text-xs">{row.claimNumber ?? '—'}</span>
      ),
    },
    {
      key: 'claimed',
      header: t('claims.column.claimed'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums">
          {row.amountClaimedCents === null
            ? '—'
            : formatCents(row.amountClaimedCents, locale)}
        </span>
      ),
    },
    {
      key: 'paid',
      header: t('claims.column.paid'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums text-ink-2">
          {row.amountPaidCents === null
            ? '—'
            : formatCents(row.amountPaidCents, locale)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('claims.column.status'),
      render: (row) => (
        <StatusBadge
          tone={TONE[row.status]}
          label={t(`claimStatus.${row.status}` as MessageKey)}
        />
      ),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('claims.title')}</h1>
        <div className="flex items-center gap-z4">
          <p className="max-w-[52ch] text-sm text-ink-3">{t('claims.hint')}</p>
          <Link href="/safety" className="text-sm text-accent hover:underline">
            {t('safety.title')}
          </Link>
          {mayFile ? (
            <Link href="/safety/claims/new">
              <Button variant="primary" size="compact">
                {t('claims.file')}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <FilterBar
        clearLabel={t('loads.filter.clear')}
        moreLabel={t('loads.filter.more')}
        groups={[
          {
            param: 'working',
            label: t('claims.working'),
            choices: [
              {
                value: 'yes',
                label: t('claims.notClosed'),
                count: counts.working,
              },
            ],
          },
          {
            param: 'status',
            label: t('claims.status'),
            choices: CLAIM_STATUSES.map((status) => ({
              value: status,
              label: t(`claimStatus.${status}` as MessageKey),
              count: counts.status[status] ?? 0,
            })),
          },
          {
            param: 'type',
            label: t('claims.type'),
            choices: CLAIM_TYPES.map((type) => ({
              value: type,
              label: t(`claimType.${type}` as MessageKey),
              count: counts.type[type] ?? 0,
            })),
          },
        ]}
      />

      <Table
        caption={t('claims.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stripeTone={(row) => TONE[row.status]}
        empty={
          isFiltered ? (
            <EmptyState
              title={t('claims.filtered.title')}
              body={t('claims.filtered.body')}
            />
          ) : (
            <EmptyState
              title={t('claims.empty.title')}
              body={t('claims.empty.body')}
              action={
                mayFile ? (
                  <Link href="/safety/claims/new">
                    <Button variant="primary">{t('claims.file')}</Button>
                  </Link>
                ) : null
              }
            />
          )
        }
      />
    </>
  )
}
