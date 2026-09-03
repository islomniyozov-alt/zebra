'use client'

import { useEffect, useState } from 'react'
import { cx } from '@/lib/cx'

// AN IDENTIFIER A DISPATCHER RETYPES INTO RELAY.
//
// ITEM 1. Every one of these is a string that exists to be carried to another
// system: a Trip ID pasted into Relay's search, a leg's Load ID, a facility
// code, a trailer number read off a gate ticket. Retyping `T-115GY4TBD` at 6am
// is how a lookup lands on the wrong trip, and the failure is silent — the
// wrong load looks like a load.
//
// NOT EVERY STRING. A driver's name and a street address are read, not carried,
// and making everything copyable is the same as making nothing copyable: the
// affordance stops meaning "you will want this one".
//
// IT DEGRADES TO PLAIN TEXT. `navigator.clipboard` needs a secure context and
// can be refused outright; the value is always selectable, and a failure says
// nothing rather than claiming a copy that did not happen.

interface Props {
  value: string
  /** Rendered instead of the raw value when the two differ — a lane, a label. */
  children?: React.ReactNode
  className?: string
  labels: { copy: string; copied: string }
}

export function Copyable({ value, children, className, labels }: Props) {
  const [copied, setCopied] = useState(false)

  // The confirmation clears itself. A tick that stays on forever stops being a
  // confirmation and becomes decoration.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1_500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // Refused or unavailable. The text is still selectable by hand, and a
      // toast saying "could not copy" would be noise about a thing the reader
      // can already see they can do.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? labels.copied : labels.copy}
      aria-label={`${copied ? labels.copied : labels.copy}: ${value}`}
      className={cx(
        'inline-flex items-center gap-z1 rounded-control text-start',
        'hover:text-accent focus-visible:outline focus-visible:outline-2',
        'focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
    >
      <span>{children ?? value}</span>
      <span
        aria-hidden
        className={cx(
          'text-xs transition-opacity',
          copied ? 'text-progress opacity-100' : 'text-ink-3 opacity-60',
        )}
      >
        {copied ? '✓' : '⧉'}
      </span>
    </button>
  )
}
