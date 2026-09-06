import { getLocaleContext } from '@/lib/locale'
import { requireSession } from '@/lib/auth-context'
import { MIN_PASSWORD_LENGTH } from '@/lib/password-reset'
import { ownAccountDb } from '@/lib/auth-db'
import { NameForm } from './NameForm'
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

  // The person, read the same way the topbar reads them. `User` is outside RLS
  // and this is your own row, which is why it goes through the account handle
  // rather than `withCurrentOrg` — see src/lib/auth-db.ts.
  const account = await ownAccountDb().user.findUnique({
    where: { id: session.userId },
    select: { name: true, email: true },
  })

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('account.title')}</h1>
        {/* NOTE FOR ANYONE AUTOMATING THIS SCREEN: this is a form, and it
         * renders ABOVE the password form. `form button[type="submit"]`
         * therefore matches SIGN OUT, not Change password — which is how a
         * diagnostic fixture once signed itself out, read the login page's
         * 200, and reported a bug that did not exist. Target the password
         * form by a field only it has. */}
        <SignOutButton label={t('account.signOut')} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-z4 overflow-y-auto bg-surface-2 px-gutter py-z5">
        {/* WHO YOU ARE, ABOVE HOW YOU GET IN. Daler, looking at this screen:
         * "is this my account or a place to change a password?" It was called
         * Your account and held one password form, so the name promised a
         * profile and the page delivered a security control.
         *
         * THE NAME IS FIRST BECAUSE IT IS THE ONE THING HERE THAT WAS WRONG
         * FOR EVERYBODY. Production had four of five users named after their
         * job — Owner, Dispatch, Accounting, Disptach — and no way to correct
         * it. See setOwnName. */}
        <section className="max-w-[420px] rounded-card border border-border bg-surface p-z4">
          <h2 className="text-md font-medium text-ink">
            {t('account.name.title')}
          </h2>
          <p className="mt-z1 text-sm text-ink-2">{t('account.name.body')}</p>

          <div className="mt-z3">
            <NameForm
              current={account?.name ?? ''}
              labels={{
                label: t('account.name.label'),
                save: t('account.name.save'),
                saved: t('account.name.saved'),
              }}
              errors={{
                'account.name.empty': t('account.name.empty'),
                'account.name.tooLong': t('account.name.tooLong'),
              }}
            />
          </div>

          {/* EMAIL IS SHOWN AND NOT EDITABLE, and that is a decision rather
           * than an omission. It is the login identifier, so changing it
           * changes how you sign in — which wants a verification round trip to
           * the new address before it takes effect. Verification is a feature,
           * not a field, and shipping the field without it would let somebody
           * type a typo and lock themselves out. Recorded as the next decision
           * on this screen. */}
          <div className="mt-z4 border-t border-border pt-z3">
            <p className="text-xs uppercase tracking-[0.04em] text-ink-3">
              {t('account.email.label')}
            </p>
            <p className="mt-z1 text-sm text-ink">{account?.email ?? ''}</p>
            <p className="mt-z1 text-xs text-ink-3">
              {t('account.email.body')}
            </p>
          </div>
        </section>

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
