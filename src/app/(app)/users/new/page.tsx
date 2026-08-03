import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { grantableRoles } from '@/lib/users'
import { NewUserForm } from '../NewUserForm'
import type { MessageKey } from '@/lib/i18n'

// The roles an actor may hand out come from `grantableRoles`, not from the
// enum: an ADMIN cannot mint an OWNER. The server checks it again — this is
// only the half that stops the option being offered.

const CREATE_ERROR_KEYS: MessageKey[] = [
  'users.error.nameRequired',
  'users.error.emailRequired',
  'users.error.alreadyMember',
  'users.error.emailUnavailable',
  'users.error.roleNotGrantable',
  'users.error.companyNotInOrg',
  'ref.error.required',
]

export default async function NewUserPage() {
  if (!(await currentUserCan('create', 'user'))) notFound()

  const { t } = await getLocaleContext()

  const { companies, actorRole } = await withCurrentOrg(
    'read',
    'company',
    async (tx, session) => ({
      actorRole: session.role,
      companies: await tx.company.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    }),
  )

  const roles = grantableRoles(actorRole).map((role) => ({
    value: role,
    label: t(`roles.${role}` as MessageKey),
  }))

  // The error messages travel pre-translated: a translator is a closure and a
  // closure cannot be serialised to a client component.
  const translate = Object.fromEntries(
    CREATE_ERROR_KEYS.map((key) => [key, t(key)]),
  )

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('users.new')}</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <NewUserForm
          roles={roles}
          companies={companies}
          // The same origin reset links carry, so the address handed to a new
          // dispatcher and the address in their reset mail agree.
          signInOrigin={process.env.APP_ORIGIN ?? null}
          translate={translate}
          labels={{
            name: t('users.name'),
            email: t('users.email'),
            role: t('users.role'),
            scope: t('users.scope'),
            scopeHint: t('users.scopeHint'),
            save: t('ref.save'),
            cancel: t('ref.cancel'),
            created: t('users.created'),
            tempPassword: t('users.tempPassword'),
            tempPasswordHint: t('users.tempPasswordHint'),
            done: t('users.tempPasswordDone'),
            shareTelegram: t('users.share.telegram'),
            shareCopy: t('users.share.copy'),
            shareCopied: t('users.share.copied'),
            shareCopyFailed: t('users.share.copyFailed'),
            shareIntro: t('users.share.intro'),
            shareEmail: t('users.share.email'),
            sharePassword: t('users.share.password'),
            shareInstruction: t('users.share.instruction'),
          }}
        />
      </div>
    </>
  )
}
