import Link from 'next/link'
import { getLocaleContext } from '@/lib/locale'
import { ResetRequestForm } from './ResetRequestForm'

// §11.6. Requesting a link. The answer is the same sentence whether or not the
// account exists — this endpoint must not become the account-enumeration
// oracle that login carefully is not.
export default async function ResetPasswordPage() {
  const { t } = await getLocaleContext()

  return (
    <div className="w-[min(400px,100%)] rounded-card border border-border bg-surface p-z7">
      <h1 className="mb-z2 text-lg font-medium text-ink">
        {t('auth.reset.title')}
      </h1>
      <p className="mb-z6 text-base text-ink-2">{t('auth.reset.body')}</p>
      <ResetRequestForm
        labels={{
          email: t('auth.email'),
          send: t('auth.reset.send'),
          sent: t('auth.reset.sent'),
          rateLimited: t('auth.rateLimited'),
        }}
      />
      <Link
        href="/login"
        className="mt-z4 inline-block text-base text-accent underline underline-offset-2"
      >
        {t('auth.backToSignIn')}
      </Link>
    </div>
  )
}
