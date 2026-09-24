import Link from 'next/link'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { Table, type Column } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  dqfChecklist,
  dqfFactsForDrivers,
  dqfIncompleteCount,
  DQF_REQUIREMENTS,
  isQualifiable,
} from '@/lib/dqf'
import { PERSON_DRIVER } from '@/lib/driver-kind'
import type { MessageKey } from '@/lib/i18n'

// ITEM 13 — THE WHOLE ROSTER, IN ONE COLUMN OF NUMBERS.
//
// The driver page answers "is this file complete". This answers the question
// an audit actually opens with, which is "how many of your drivers are
// qualified" — and the honest form of that answer is a list somebody can sort
// by how bad it is.
//
// ── NOTHING IS STORED AND NOTHING IS CACHED ──────────────────────────────
//
// Every row is computed from the same `dqfChecklist` the driver page and the
// warnings call. A "completeness" column on Driver would be the fourth copy of
// this answer and the first one able to be wrong.
//
// ── TERMINATED DRIVERS ARE NOT LISTED ────────────────────────────────────
//
// §391.51(c) keeps a former driver's file for three years; it does not keep it
// CURRENT. The Datatruck import brought 69 terminated drivers and 39
// applicants, and a roster screen reporting 108 incomplete files would be
// reporting on nobody. `isQualifiable` is the filter and it is applied in the
// query, not in the render — a row that is not a finding should not be fetched
// and then hidden.
//
// ── SORTING IS A LINK, NOT STATE ─────────────────────────────────────────
//
// Two orders, both in the URL, so the view somebody is looking at is the view
// they can send to somebody else. Same shape as the drivers list's toggles.

const SORTS = ['missing', 'name'] as const
type Sort = (typeof SORTS)[number]

interface Row {
  id: string
  name: string
  companyName: string
  /** Missing or expired. `due` is not counted — see `dqfIncompleteCount`. */
  incomplete: number
  /** The oldest date any incomplete entry has been outstanding since. */
  since: string | null
}

export default async function DqfRosterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, locale } = await getLocaleContext()

  const sortParam = typeof params['sort'] === 'string' ? params['sort'] : ''
  const sort: Sort = (SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as Sort)
    : 'missing'
  const onlyIncomplete = params['all'] !== '1'
  const companyParam =
    typeof params['company'] === 'string' ? params['company'] : undefined

  const { rows, companyCount } = await withCurrentOrg(
    'read',
    'compliance',
    async (tx, session) => {
      const companyCount = await tx.company.count()
      const drivers = await tx.driver.findMany({
        where: {
          ...companyScopeFilter(session.companyScopes),
          ...(companyParam ? { companyId: companyParam } : {}),
          // THE CLOSED-HISTORY FILTER, IN THE QUERY. Same predicate as
          // `isQualifiable`, which is asserted below rather than trusted.
          deletedAt: null,
          status: { not: 'INACTIVE' },
          // AND A REFERRAL PAYEE IS NOT A DRIVER WITH A FILE. One spelling of
          // that exclusion, imported, so this page and the warnings cannot
          // disagree about whose DQF is expected.
          ...PERSON_DRIVER,
        },
        orderBy: [{ company: { name: 'asc' } }, { lastName: 'asc' }],
        take: 400,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          status: true,
          deletedAt: true,
          kind: true,
          company: { select: { name: true } },
        },
      })

      // ONE PAIR OF STATEMENTS FOR THE PAGE, not one per driver. The same
      // loader the driver page uses, so the roster count and the panel cannot
      // disagree about what is on file.
      const facts = await dqfFactsForDrivers(
        tx,
        drivers.map((driver) => driver.id),
      )
      const now = new Date()
      const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

      const rows: Row[] = drivers
        // BELT AND BRACES, and the reason is flag-worthy on its own: the WHERE
        // above and `isQualifiable` are two statements of one rule, so this
        // runs the function over the rows the query returned. If they ever
        // disagree the answer is the function's, which is the one the warning
        // and the driver page also use.
        .filter((driver) => isQualifiable(driver))
        .map((driver) => {
          const entries = dqfChecklist(
            facts.get(driver.id) ?? {
              hireDate: null,
              compliance: [],
              documents: [],
            },
            now,
          )
          const outstanding = entries
            .filter(
              (entry) =>
                entry.status === 'missing' || entry.status === 'expired',
            )
            .map((entry) => entry.dueSince)
            .filter((date): date is Date => date !== null)
            .sort((a, b) => a.getTime() - b.getTime())[0]

          return {
            id: driver.id,
            name: `${driver.lastName}, ${driver.firstName}`,
            companyName: driver.company.name,
            incomplete: dqfIncompleteCount(entries),
            since: outstanding ? day.format(outstanding) : null,
          }
        })

      return { rows, companyCount }
    },
  )

  const shown = (onlyIncomplete ? rows.filter((r) => r.incomplete > 0) : rows)
    .slice()
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : b.incomplete - a.incomplete || a.name.localeCompare(b.name),
    )

  const showCompany = companyCount > 1
  const total = DQF_REQUIREMENTS.length

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('drivers.name'),
      render: (row) => row.name,
    },
    ...(showCompany
      ? [
          {
            key: 'company',
            header: t('ref.authority'),
            truncate: true,
            render: (row: Row) => row.companyName,
          },
        ]
      : []),
    {
      key: 'missing',
      header: t('dqf.roster.missing'),
      // A COUNT AND A DENOMINATOR. "3" alone is unreadable without knowing
      // there are eight requirements, and the denominator is the definition's
      // length rather than a number typed here.
      render: (row) =>
        row.incomplete === 0 ? (
          <StatusBadge tone="success" label={t('dqf.roster.complete')} />
        ) : (
          <span className="font-mono">
            {row.incomplete} / {total}
          </span>
        ),
    },
    {
      key: 'since',
      header: t('dqf.since'),
      // THE OLDEST OUTSTANDING DATE, which is the one that decides how bad
      // this row is. A file missing something since 2024 is a different
      // conversation from one missing something since last week.
      render: (row) => row.since ?? '—',
    },
  ]

  const link = (next: Record<string, string>) =>
    `/safety/dqf?${new URLSearchParams({
      ...(companyParam ? { company: companyParam } : {}),
      ...(onlyIncomplete ? {} : { all: '1' }),
      ...(sort === 'missing' ? {} : { sort }),
      ...next,
    }).toString()}`

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('dqf.roster.title')}
        </h1>
        <p className="max-w-[60ch] text-xs text-ink-3">{t('dqf.hint')}</p>
      </div>

      <div className="flex items-center gap-z4 border-b border-border bg-surface-2 px-gutter py-z2">
        <Link
          href={link(onlyIncomplete ? { all: '1' } : {})}
          className="text-sm font-medium text-ink-2 hover:text-accent"
        >
          {onlyIncomplete
            ? t('dqf.roster.all')
            : t('dqf.roster.onlyIncomplete')}
        </Link>
        {SORTS.map((name) => (
          <Link
            key={name}
            href={link({ sort: name })}
            className={
              sort === name
                ? 'text-sm font-medium text-accent'
                : 'text-sm text-ink-2 hover:text-accent'
            }
          >
            {t(`dqf.roster.sort.${name}` as MessageKey)}
          </Link>
        ))}
      </div>

      <Table
        caption={t('dqf.roster.title')}
        columns={columns}
        rows={shown}
        rowKey={(row) => row.id}
        rowHref={(row) => `/drivers/${row.id}`}
        empty={
          <EmptyState
            title={t('dqf.roster.empty.title')}
            body={t('dqf.roster.empty.body')}
          />
        }
      />
    </>
  )
}
