import { getLocaleContext } from '@/lib/locale'
import { requireSession } from '@/lib/auth-context'
import { MIN_PASSWORD_LENGTH } from '@/lib/password-reset'
import { PasswordForm } from './PasswordForm'
import { SignOutButton } from './SignOutButton'

// Your own account. Phase 2 §6 asks for one thing here — the owner changing
// their own password through the interface rather than through a seed
// variable — so that is what it holds. Users, roles and preferences are the
// Admin section's job and are not stubbed here (§4: leave the route absent).
//
// §7.5: modals hold six fields at most, and this is three, but it is not a
// modal. A password change ends every other session; that is a page-sized
// consequence and it gets a page.

export default async function AccountPage() {
  const session = await requireSession()
  const { t } = await getLocaleContext()

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('account.title')}</h1>
        <SignOutButton label={t('account.signOut')} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <section className="max-w-[420px] rounded-card border border-border bg-surface p-z4">
          <h2 className="text-md font-medium text-ink">
            {t('account.password.title')}
          </h2>
          <p className="mt-z1 text-sm text-ink-2">
            {t('account.password.body')}
          </p>

          <div className="mt-z4">
            <PasswordForm
              labels={{
                current: t('account.password.current'),
                next: t('account.password.new'),
                confirm: t('account.password.confirm'),
                save: t('account.password.save'),
                done: t('account.password.done'),
                hint: t('account.password.hint').replace(
                  '{n}',
                  String(MIN_PASSWORD_LENGTH),
                ),
              }}
              errors={{
                'account.password.mismatch': t('account.password.mismatch'),
                'account.password.tooShort': t('account.password.tooShort'),
                'account.password.unchanged': t('account.password.unchanged'),
                'account.password.wrongCurrent': t(
                  'account.password.wrongCurrent',
                ),
              }}
            />
          </div>
        </section>

        <p className="mt-z3 max-w-[420px] text-xs text-ink-3">
          {t('account.signedInAs').replace('{role}', session.role)}
        </p>
      </div>
    </>
  )
}
