import Link from 'next/link'
import { getLocaleContext } from '@/lib/locale'
import { ResetConfirmForm } from './ResetConfirmForm'

// §11.6. Redeeming the link.
export default async function ResetConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const { t } = await getLocaleContext()

  return (
    <div className="w-[min(400px,100%)] rounded-card border border-border bg-surface p-z7">
      <h1 className="mb-z6 text-lg font-medium text-ink">
        {t('auth.reset.title')}
      </h1>
      <ResetConfirmForm
        token={token}
        labels={{
          newPassword: t('auth.reset.newPassword'),
          confirmPassword: t('auth.reset.confirmPassword'),
          save: t('auth.reset.save'),
          done: t('auth.reset.done'),
        }}
        errors={{
          'auth.reset.mismatch': t('auth.reset.mismatch'),
          'auth.reset.tooShort': t('auth.reset.tooShort'),
          'auth.reset.invalidToken': t('auth.reset.invalidToken'),
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
