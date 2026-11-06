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

  // §6.1.3 — the unauthenticated shell has no sidebar, so the navy appears
  // here instead: a 48px nav-bg band carrying the wordmark exactly as the
  // sidebar's wordmark row renders it, then the form on surface. One card,
  // nothing else — no illustration, no tagline, no second column.
  return (
    <div className="w-[min(400px,100%)] overflow-hidden rounded-card border border-border-strong bg-surface">
      <div className="flex h-topbar items-center border-b border-nav-border bg-nav-bg px-z6">
        <span className="text-md font-medium tracking-[0.08em] text-nav-ink">
          {t('app.name').toUpperCase()}
        </span>
      </div>
      <div className="p-z7">
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
    </div>
  )
}
