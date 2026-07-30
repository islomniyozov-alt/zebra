import type { ReactNode } from 'react'

// The unauthenticated shell: no sidebar, no topbar, nothing to navigate to.
//
// Standing rule 7 — every surface declares its own background. This one is
// surface-2 so the card in the middle reads as raised against it.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-2 px-gutter">
      {children}
    </main>
  )
}
