import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import {
  INSPECTION_LEVELS,
  INSPECTION_SUBJECTS,
  inspectionList,
  type InspectionRow,
  type InspectionSubject,
} from '@/lib/inspections'
import { Button } from '@/components/ui/Button'
import { FilterBar } from '@/components/ui/FilterBar'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import type { InspectionLevel } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// PHASE 4 §5 STEP 4 — roadside inspections across the fleet.
//
// Every event, newest first, with what came of it. Unlike /safety, this is NOT
// a queue: a clean inspection needs nothing done and still belongs here,
// because two years of clean inspections is the thing a carrier shows an
// auditor. §4's box for step 5 traces inspection → violation → challenge, and
// this is the first link in that chain.

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await currentUserCan('read', 'inspection'))) notFound()
  const mayRecord = await currentUserCan('create', 'inspection')

  const params = await searchParams
  const { t } = await getLocaleContext()

  const subjectParam =
    typeof params['subject'] === 'string'
      ? (params['subject'] as InspectionSubject)
      : undefined
  const levelParam =
    typeof params['level'] === 'string'
      ? (params['level'] as InspectionLevel)
      : undefined
  const oosParam = params['oos'] === 'yes'

  const { rows, counts } = await withCurrentOrg(
    'read',
    'inspection',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)

      // The filtered list, plus the unfiltered set the chip counts come from.
      const [filtered, all] = await Promise.all([
        inspectionList(tx, scope, {
          ...(subjectParam ? { subject: subjectParam } : {}),
          ...(levelParam ? { level: levelParam } : {}),
          ...(oosParam ? { outOfService: true } : {}),
        }),
        inspectionList(tx, scope),
      ])

      // Each chip honours the OTHER filters and ignores its own group, so
      // clicking one lands on exactly the number it promised.
      const matches = (
        row: InspectionRow,
        ignore: 'subject' | 'level' | 'oos',
      ) =>
        (ignore === 'subject' ||
          !subjectParam ||
          (subjectParam === 'truck' && row.truck !== null) ||
          (subjectParam === 'trailer' && row.trailer !== null) ||
          (subjectParam === 'driver' && row.driver !== null)) &&
        (ignore === 'level' || !levelParam || row.level === levelParam) &&
        (ignore === 'oos' || !oosParam || row.outOfService)

      return {
        rows: filtered,
        counts: {
          subject: Object.fromEntries(
            INSPECTION_SUBJECTS.map((subject) => [
              subject,
              all.filter(
                (row) =>
                  matches(row, 'subject') &&
                  ((subject === 'truck' && row.truck !== null) ||
                    (subject === 'trailer' && row.trailer !== null) ||
                    (subject === 'driver' && row.driver !== null)),
              ).length,
            ]),
          ) as Record<string, number>,
          level: Object.fromEntries(
            INSPECTION_LEVELS.map((level) => [
              level,
              all.filter((row) => matches(row, 'level') && row.level === level)
                .length,
            ]),
          ) as Record<string, number>,
          oos: all.filter((row) => matches(row, 'oos') && row.outOfService)
            .length,
        },
      }
    },
  )

  const isFiltered = Boolean(subjectParam || levelParam || oosParam)
  const day = (value: Date) => value.toISOString().slice(0, 10)

  /** "104 · R-22 · Ahmad Karimov" — every unit the officer wrote down. */
  const subjectsOf = (row: InspectionRow) =>
    [row.truck?.unitNumber, row.trailer?.unitNumber, row.driver?.name]
      .filter((value) => value !== undefined && value !== null)
      .join(' · ')

  const columns: Column<InspectionRow>[] = [
    {
      key: 'date',
      header: t('ins.column.date'),
      render: (row) => (
        <Link
          href={`/safety/inspections/${row.id}`}
          className="z-identifier font-medium text-ink hover:text-accent"
        >
          {day(row.inspectedAt)}
        </Link>
      ),
    },
    {
      key: 'subject',
      header: t('ins.column.subject'),
      truncate: true,
      render: (row) => subjectsOf(row),
    },
    {
      key: 'level',
      header: t('ins.column.level'),
      truncate: true,
      render: (row) => t(`insLevel.${row.level}` as MessageKey),
    },
    {
      key: 'state',
      header: t('ins.column.state'),
      render: (row) => <span className="font-mono">{row.state}</span>,
    },
    {
      key: 'report',
      header: t('ins.column.report'),
      // Never truncated: a report number is a field people copy into a DataQs
      // challenge.
      render: (row) => (
        <span className="font-mono text-xs">{row.reportNumber ?? '—'}</span>
      ),
    },
    {
      key: 'violations',
      header: t('ins.column.violations'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums">
          {row.violations.length === 0 ? '—' : row.violations.length}
        </span>
      ),
    },
    {
      key: 'result',
      header: t('ins.column.result'),
      render: (row) =>
        // Three states, and the middle one is not "nothing": an inspection with
        // violations that grounded nothing is a real outcome and reads as its
        // own count rather than as a silence.
        row.outOfService ? (
          <StatusBadge tone="danger" label={t('ins.oos')} />
        ) : row.isClean ? (
          <StatusBadge tone="success" label={t('ins.clean')} />
        ) : (
          <StatusBadge
            tone="warning"
            label={
              row.violations.length === 1
                ? t('ins.oneViolation')
                : t('ins.violationCount').replace(
                    '{count}',
                    String(row.violations.length),
                  )
            }
          />
        ),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('ins.title')}</h1>
        <div className="flex items-center gap-z4">
          <p className="max-w-[52ch] text-sm text-ink-3">{t('ins.hint')}</p>
          <Link href="/safety" className="text-sm text-accent hover:underline">
            {t('safety.title')}
          </Link>
          {mayRecord ? (
            <Link href="/safety/inspections/new">
              <Button variant="primary" size="compact">
                {t('ins.record')}
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
            param: 'subject',
            label: t('ins.subject'),
            choices: INSPECTION_SUBJECTS.map((subject) => ({
              value: subject,
              label: t(`safety.subject.${subject}` as MessageKey),
              count: counts.subject[subject] ?? 0,
            })),
          },
          {
            param: 'level',
            label: t('ins.level'),
            choices: INSPECTION_LEVELS.map((level) => ({
              value: level,
              label: t(`insLevel.${level}` as MessageKey),
              count: counts.level[level] ?? 0,
            })),
          },
          {
            // A one-chip group. It is a filter, not a toggle, and lives with
            // the others so the URL carries it the same way.
            param: 'oos',
            label: t('ins.oos'),
            choices: [
              { value: 'yes', label: t('ins.oosOnly'), count: counts.oos },
            ],
          },
        ]}
      />

      <Table
        caption={t('ins.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stripeTone={(row) =>
          row.outOfService ? 'danger' : row.isClean ? 'success' : 'warning'
        }
        empty={
          isFiltered ? (
            <EmptyState
              title={t('ins.filtered.title')}
              body={t('ins.filtered.body')}
            />
          ) : (
            <EmptyState
              title={t('ins.empty.title')}
              body={t('ins.empty.body')}
              action={
                mayRecord ? (
                  <Link href="/safety/inspections/new">
                    <Button variant="primary">{t('ins.record')}</Button>
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
