import type { ReactNode } from 'react'

// §10. "Empty states are invitations, with the action attached."
//
// Not "No loads found" but "No loads match these filters" + Clear filters.
// Not "No documents" but "No rate confirmation yet" + Upload.
//
// §14 lists "No data available" as an anti-pattern by name. The distinction
// that matters: an empty table because nothing exists yet is a different
// sentence from an empty table because the filters exclude everything, and the
// second one has an obvious action attached.

interface EmptyStateProps {
  title: string
  body: string
  /** The way out. A filtered-empty state without one is a dead end. */
  action?: ReactNode
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-z2 bg-surface px-z5 py-z8 text-center">
      <p className="text-md font-medium text-ink">{title}</p>
      <p className="max-w-[42ch] text-base text-ink-2">{body}</p>
      {action ? <div className="mt-z2">{action}</div> : null}
    </div>
  )
}
