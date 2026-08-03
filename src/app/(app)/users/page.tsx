import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { listUsers } from '@/lib/users'
import { renderStopTime } from '@/lib/stop-time'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { setUserActiveAction } from './actions'
import type { Role } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// Admin → Users. The screen the onboarding procedure depends on: an admin
// creates an account, hands over a temporary password, and the new person
// changes it within minutes.
//
// Read the tenancy note at the top of src/lib/users.ts before touching the
// query. `User` is not one of the tables row-level security protects, so the
// list is built from `Membership` and not from `User`.

interface Row {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
  scope: string
  lastLogin: string
  isSelf: boolean
}

export default async function UsersPage() {
  // §4: a route a role may not use should not exist for that role either.
  if (!(await currentUserCan('read', 'user'))) notFound()

  const { t, locale } = await getLocaleContext()

  const { rows, zone } = await withCurrentOrg(
    'read',
    'user',
    async (tx, session) => {
      const users = await listUsers(tx, session.organizationId)
      const company = await tx.company.findFirst({
        select: { timezone: true },
      })

      return {
        zone: company?.timezone ?? 'America/Chicago',
        rows: users.map((user) => ({
          ...user,
          isSelf: user.id === session.userId,
        })),
      }
    },
  )

  const mayCreate = await currentUserCan('create', 'user')
  const mayUpdate = await currentUserCan('update', 'user')

  const table: Row[] = rows.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    scope:
      user.companyNames.length === 0
        ? t('users.scopeAll')
        : user.companyNames.join(', '),
    lastLogin:
      user.lastLoginAt === null
        ? t('users.neverSignedIn')
        : (renderStopTime(user.lastLoginAt, null, {
            fallbackZone: zone,
            locale,
          })?.text ?? '—'),
    isSelf: user.isSelf,
  }))

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('users.name'),
      render: (row) => <span className="font-medium text-ink">{row.name}</span>,
    },
    {
      key: 'email',
      header: t('users.email'),
      truncate: true,
      render: (row) => <span className="font-mono">{row.email}</span>,
    },
    {
      key: 'role',
      header: t('users.role'),
      render: (row) => t(`roles.${row.role}` as MessageKey),
    },
    {
      key: 'scope',
      header: t('users.scope'),
      truncate: true,
      render: (row) => row.scope,
    },
    {
      key: 'lastLogin',
      header: t('users.lastLogin'),
      render: (row) => (
        <span
          className={
            row.lastLogin === t('users.neverSignedIn') ? 'text-ink-3' : ''
          }
        >
          {row.lastLogin}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('ref.status'),
      render: (row) =>
        row.isActive ? (
          <StatusBadge tone="success" label={t('users.active')} />
        ) : (
          <StatusBadge tone="muted" label={t('users.inactive')} />
        ),
    },
    ...(mayUpdate
      ? [
          {
            key: 'actions',
            header: '',
            align: 'end' as const,
            render: (row: Row) =>
              // No control against your own row. The service refuses it too —
              // this is the half that stops anybody reaching for it.
              row.isSelf ? (
                <span className="text-xs text-ink-3">—</span>
              ) : (
                <form
                  action={setUserActiveAction.bind(null, row.id, !row.isActive)}
                >
                  <Button type="submit" variant="ghost" size="compact">
                    {row.isActive
                      ? t('users.deactivate')
                      : t('users.reactivate')}
                  </Button>
                </form>
              ),
          },
        ]
      : []),
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('users.title')}</h1>
        {mayCreate ? (
          <Link href="/users/new">
            <Button variant="primary" size="compact">
              {t('users.add')}
            </Button>
          </Link>
        ) : null}
      </div>

      <Table
        caption={t('users.title')}
        columns={columns}
        rows={table}
        rowKey={(row) => row.id}
        isCancelled={(row) => !row.isActive}
        empty={
          <EmptyState
            title={t('users.empty.title')}
            body={t('users.empty.body')}
            action={
              mayCreate ? (
                <Link href="/users/new">
                  <Button variant="primary">{t('users.add')}</Button>
                </Link>
              ) : null
            }
          />
        }
      />
    </>
  )
}
