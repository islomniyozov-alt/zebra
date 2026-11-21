'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'

// "Saved — {name}." after an authority's edit lands on the list (TMS §6.3
// v11.41). The quiet success toast, said once; then `?saved=` leaves the URL
// so a reload or a shared link does not say it again.
export function SavedNotice({ message }: { message: string }) {
  const toast = useToast()
  const router = useRouter()
  const said = useRef(false)
  useEffect(() => {
    if (said.current) return
    said.current = true
    toast.success(message)
    router.replace('/companies', { scroll: false })
  }, [message, toast, router])
  return null
}
