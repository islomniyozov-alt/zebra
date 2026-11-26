'use client'

import { useEffect, useRef } from 'react'

/**
 * AFTER A FILE, THE INTAKE RESETS BY ITSELF (TMS §0 rule 15, §7.8 v11.59;
 * owner's ruling 2026-11-26). A confirm step calls this with whether its
 * filing is finished — the record saved and, where a file rides along, its
 * upload settled — and the sentence to show. The intake receives it once,
 * goes back to an empty drop zone and shows the sentence for a moment.
 *
 * Without `onFiled` (the medical card on a driver's page) nothing is called
 * and the step shows its own success line, as before.
 */
export function useFiled(
  done: boolean,
  message: string,
  onFiled: ((message: string) => void) | undefined,
) {
  const sent = useRef(false)
  useEffect(() => {
    if (!done || !onFiled || sent.current) return
    sent.current = true
    onFiled(message)
  }, [done, message, onFiled])
}
