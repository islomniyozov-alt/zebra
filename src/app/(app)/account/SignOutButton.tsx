'use client'

import { signOutAction } from '../../(auth)/actions'
import { Button } from '@/components/ui/Button'

// A form rather than an onClick: sign-out is a state change, and it works with
// no JavaScript loaded. §7.7 — destructive-adjacent actions are never
// accent-coloured (standing rule 11), so this is secondary.

export function SignOutButton({ label }: { label: string }) {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="secondary" size="compact">
        {label}
      </Button>
    </form>
  )
}
