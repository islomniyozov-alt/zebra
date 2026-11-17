import type { Metadata } from 'next'
import { getLocaleContext } from '@/lib/locale'
import { ToastProvider } from '@/components/ui/Toast'
import './globals.css'

export const metadata: Metadata = {
  title: 'Zebra',
  description: 'Transportation management',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { locale } = await getLocaleContext()

  // NO `dir`: both locales are left-to-right since Farsi was removed
  // (2026-11-17, §12), and left-to-right is the default.
  //
  // NO data-density here. It is a per-user preference and this layout has no
  // user — the login screen has no density to have. The app shell sets it from
  // the preference row; `:root` in globals.css carries Standard for everything
  // outside the shell. Setting it here as well made the attribute ambiguous:
  // a check reading `[data-density]` found <html> and never saw the shell.
  return (
    <html lang={locale}>
      <body className="bg-surface-2 text-ink">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
