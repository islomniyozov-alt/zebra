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
  const { locale, dir } = await getLocaleContext()

  // `dir` comes from the locale and nothing else (§12). Every stylesheet uses
  // logical properties, so this one attribute is the entire right-to-left
  // implementation — there is no mirrored stylesheet to keep in step.
  //
  // data-density is the §5.1 user preference. Standard until there is a
  // settings screen to change it from.
  return (
    <html lang={locale} dir={dir} data-density="standard">
      <body className="bg-surface-2 text-ink">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
