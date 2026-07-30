'use client'

import { useEffect, useRef, type ReactNode } from 'react'

// §7.5 — modals hold six fields at most. Anything larger is a full page; the
// Add Load form is a full page. Nothing enforces the six here, but the comment
// is the thing a reviewer cites.
//
// Built on <dialog> so focus trapping, Escape and the inert backdrop come from
// the platform rather than from a hand-rolled key handler that misses Tab.

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className={[
        'rounded-card border border-border bg-surface p-0 text-ink',
        'backdrop:bg-ink/40',
        'w-[min(560px,calc(100vw-var(--spacing-z8)))]',
      ].join(' ')}
    >
      <header className="border-b border-border px-z4 py-z3">
        <h2 className="text-md font-medium text-ink">{title}</h2>
      </header>
      <div className="px-z4 py-z4">{children}</div>
      {footer ? (
        <footer className="flex justify-end gap-z2 border-t border-border px-z4 py-z3">
          {footer}
        </footer>
      ) : null}
    </dialog>
  )
}
