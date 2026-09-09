import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { Table, type Column } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'

// Admin → Authorities (Phase 6 §7 flag 11).
//
// A COMPANY IS AN OPERATING AUTHORITY. `Company.id` IS the authority every
// scoped query filters by (tenancy.ts), so this list is the set of carriers
// the whole application books, invoices and settles under — and until this
// screen it could only be changed with SQL.
//
// READ IS `company:read`, which every operator role holds — a dispatcher's
// authority switcher is built from the same rows. ADDING is `company:create`,
// which only OWNER and ADMIN hold, and the button is absent rather than
// disabled for everybody else.

interface Row {
  id: string
  name: string
  mc: string
  dot: string
  where: string
  isActive: boolean
  retired: boolean
}

export default async function CompaniesPage() {
  const { t } = await getLocaleContext()

  if (!(await currentUserCan('read', 'company'))) notFound()
  const mayAdd = await currentUserCan('create', 'company')
  const mayEdit = await currentUserCan('update', 'company')

  const data = await withCurrentOrg('read', 'company', async (tx) => {
    const [companies, organization] = await Promise.all([
      tx.company.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          mcNumber: true,
          dotNumber: true,
          city: true,
          state: true,
          isActive: true,
          retired: true,
        },
      }),
      tx.organization.findFirst({ select: { maxCompanies: true } }),
    ])
    return { companies, limit: organization?.maxCompanies ?? 1 }
  })

  const rows: Row[] = data.companies.map((company) => ({
    id: company.id,
    name: company.name,
    mc: company.mcNumber ?? '—',
    dot: company.dotNumber ?? '—',
    where: [company.city, company.state].filter(Boolean).join(', ') || '—',
    isActive: company.isActive,
    retired: company.retired,
  }))

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('companies.name'),
      render: (row: Row) => row.name,
    },
    {
      key: 'mc',
      header: t('companies.mcNumber'),
      render: (row: Row) => (
        <span className="font-mono" dir="ltr">
          {row.mc}
        </span>
      ),
    },
    {
      key: 'dot',
      header: t('companies.dotNumber'),
      render: (row: Row) => (
        <span className="font-mono" dir="ltr">
          {row.dot}
        </span>
      ),
    },
    {
      key: 'where',
      header: t('companies.city'),
      render: (row: Row) => row.where,
    },
    // DEACTIVATED HAS TO BE VISIBLE ON THE LIST. It is the difference between
    // an authority freight can be booked under and one that only appears on
    // history, and until this column it was invisible everywhere except by
    // noticing an absence in the topbar switcher.
    {
      key: 'status',
      header: t('companies.status'),
      // RETIRED OUTRANKS ACTIVE HERE, and that is not a contradiction:
      // a retired authority stays `isActive` ON PURPOSE, so that its freight
      // keeps a filter chip on the load list. Reporting it as "Active" would
      // be true of the column and false of the thing — this is the one screen
      // where somebody asks why a carrier is missing from a select, and the
      // answer has to be readable.
      render: (row: Row) =>
        row.retired ? (
          <span className="text-ink-3">{t('companies.retired')}</span>
        ) : row.isActive ? (
          t('companies.active')
        ) : (
          <span className="text-ink-3">{t('companies.inactive')}</span>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-z4">
      <div className="flex items-center justify-between gap-z3">
        <div className="flex items-baseline gap-z3">
          <h1 className="text-xl font-semibold text-ink">
            {t('companies.title')}
          </h1>
          {/* THE LEVER, IN PLAIN SIGHT. `maxCompanies` is what the plan sells;
           * showing the count spent against it is how somebody knows they are
           * about to be refused before they fill in a form. */}
          <span className="text-sm text-ink-2">
            {t('companies.usage')
              .replace('{used}', String(rows.length))
              .replace('{limit}', String(data.limit))}
          </span>
        </div>
        {mayAdd ? (
          <Link href="/companies/new">
            <Button variant="primary">{t('companies.add')}</Button>
          </Link>
        ) : null}
      </div>

      <Table
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        // §7.1's whole-row link, which this list never had — the owner's
        // report. Only for a role that may actually edit: a MANAGER holds
        // `company:read` for the switcher and has nothing to open.
        {...(mayEdit ? { rowHref: (row: Row) => `/companies/${row.id}` } : {})}
        caption={t('companies.title')}
        empty={
          <EmptyState title={t('companies.empty')} body={t('companies.hint')} />
        }
      />
    </div>
  )
}
