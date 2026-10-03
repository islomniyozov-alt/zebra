import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { LoginForm } from './LoginForm'

export default async function LoginPage() {
  // Already signed in? The login screen is not a place to linger. Same
  // destination as a fresh sign-in, so arriving at /login with a session and
  // arriving with credentials land in the same place.
  if (await getSession()) redirect('/dashboard')

  const { t } = await getLocaleContext()

  return (
    <div className="w-[min(400px,100%)] rounded-card border border-border bg-surface p-z7">
      <h1 className="mb-z6 text-lg font-medium text-ink">
        {t('auth.signInTo')}
      </h1>
      <LoginForm
        labels={{
          signIn: t('auth.signIn'),
          email: t('auth.email'),
          password: t('auth.password'),
          forgot: t('auth.forgot'),
        }}
        // EVERY KEY THE ACTION CAN RETURN, because the form falls back to
        // `auth.invalid` for one it was not given — which would tell somebody
        // their password was wrong when the database was unreachable.
        // `tests/auth-action.test.ts` asserts this map covers the action's whole
        // failure set.
        errors={{
          'auth.invalid': t('auth.invalid'),
          'auth.rateLimited': t('auth.rateLimited'),
          'auth.noMembership': t('auth.noMembership'),
          'auth.unavailable': t('auth.unavailable'),
        }}
      />
    </div>
  )
}
