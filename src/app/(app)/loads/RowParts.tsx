'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import type { LoadNote } from '@/lib/load-notes'
import type { Warning, WarningName } from '@/lib/warnings'
import { cx } from '@/lib/cx'
import { loadNotesAction } from './filter-actions'

// §6.7 item 8 — a row's expand and its menu.
//
// THE EXPAND is a continuation row (§7.1): stops in order with their local
// times, the load's newest notes, and every warning in words. Stops and
// warnings ride with the row; the notes are read when it opens. Open or closed
// is component state and nothing else, so a reload closes every row.
//
// THE MENU holds Open, Copy load number and Attach POD. Attach POD LINKS to the
// documents panel's POD slot: by the owner's ruling of 2026-10-09 nothing sets
// POD received by hand, and a confirmed POD document is what does.

export interface RowStop {
  type: 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE'
  place: string
  when: string | null
}

export interface ExpandLabels {
  expand: string
  collapse: string
  stops: string
  notes: string
  notesNone: string
  notesLoading: string
  notesFailed: string
  warnings: string
  warningsNone: string
  stopTypes: Record<RowStop['type'], string>
  warningNames: Record<WarningName, string>
}

export interface MenuLabels {
  menu: string
  open: string
  copy: string
  copied: string
  copyFailed: string
  attachPod: string
}

/** The chevron that opens and closes a row. */
export function ExpandToggle({
  open,
  onToggle,
  loadNumber,
  labels,
}: {
  open: boolean
  onToggle: () => void
  loadNumber: string
  labels: Pick<ExpandLabels, 'expand' | 'collapse'>
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? labels.collapse : labels.expand}: ${loadNumber}`}
      className="inline-flex size-[20px] items-center justify-center rounded-control text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2"
    >
      {/* Points to the reading direction's end when closed, down when open. */}
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className={cx(
          'size-[12px] transition-transform duration-120 ease-out rtl:-scale-x-100',
          open && 'rotate-90 rtl:-rotate-90',
        )}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="M6 3.5 10.5 8 6 12.5" />
      </svg>
    </button>
  )
}

/** What the continuation row shows. */
export function RowDetail({
  loadId,
  stops,
  warnings,
  labels,
}: {
  loadId: string
  stops: readonly RowStop[]
  warnings: readonly Warning[]
  labels: ExpandLabels
}) {
  const [notes, setNotes] = useState<LoadNote[] | 'loading' | 'failed'>(
    'loading',
  )

  useEffect(() => {
    let live = true
    loadNotesAction(loadId)
      .then((found) => {
        if (live) setNotes(found)
      })
      .catch(() => {
        if (live) setNotes('failed')
      })
    return () => {
      live = false
    }
  }, [loadId])

  return (
    <div className="grid grid-cols-1 gap-z4 py-z2 md:grid-cols-3">
      <section>
        <h3 className="mb-z1 text-xs font-semibold uppercase tracking-[0.04em] text-ink-3">
          {labels.stops}
        </h3>
        <ol className="flex flex-col gap-z1">
          {stops.map((stop, index) => (
            <li key={index} className="flex gap-z2">
              <span className="w-[72px] shrink-0 text-ink-3">
                {labels.stopTypes[stop.type]}
              </span>
              <span className="text-ink">{stop.place}</span>
              <span className="ms-auto font-mono tabular-nums text-ink-2">
                {stop.when ?? '—'}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h3 className="mb-z1 text-xs font-semibold uppercase tracking-[0.04em] text-ink-3">
          {labels.notes}
        </h3>
        {notes === 'loading' ? (
          <p className="text-ink-3">{labels.notesLoading}</p>
        ) : notes === 'failed' ? (
          <p className="text-danger">{labels.notesFailed}</p>
        ) : notes.length === 0 ? (
          <p className="text-ink-3">{labels.notesNone}</p>
        ) : (
          <ul className="flex flex-col gap-z1">
            {notes.map((note) => (
              <li key={note.id}>
                <span className="text-ink">{note.body}</span>
                <span className="ms-z2 text-ink-3">
                  {note.author ?? ''} · {note.at.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-z1 text-xs font-semibold uppercase tracking-[0.04em] text-ink-3">
          {labels.warnings}
        </h3>
        {warnings.length === 0 ? (
          <p className="text-ink-3">{labels.warningsNone}</p>
        ) : (
          <ul className="flex flex-col gap-z1">
            {warnings.map((warning, index) => (
              <li key={index}>
                <span className="text-warning">
                  {labels.warningNames[warning.name]}
                </span>
                {warning.detail ? (
                  <span className="ms-z2 text-ink-2">{warning.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** The row's menu: Open, Copy load number, and Attach POD where it applies. */
export function RowMenu({
  loadId,
  loadNumber,
  attachPod,
  labels,
}: {
  loadId: string
  loadNumber: string
  attachPod: boolean
  labels: MenuLabels
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const wrapper = useRef<HTMLDivElement>(null)
  const toast = useToast()

  // Closes on a click anywhere else and on Escape, like every popover here.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const copy = async () => {
    setOpen(false)
    try {
      await navigator.clipboard.writeText(loadNumber)
      toast.success(labels.copied.replace('{n}', loadNumber))
    } catch {
      toast.error(labels.copyFailed.replace('{n}', loadNumber))
    }
  }

  const item =
    'block w-full px-z3 py-z1 text-start text-xs text-ink hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none'

  return (
    <div ref={wrapper} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${labels.menu}: ${loadNumber}`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-[24px] items-center justify-center rounded-control text-ink-3 hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2"
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-[14px]"
          fill="currentColor"
        >
          <circle cx="8" cy="3.5" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="8" cy="12.5" r="1.25" />
        </svg>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute end-0 top-[calc(100%+4px)] z-30 min-w-[180px] rounded-card border border-border-strong bg-surface py-z1 shadow-lg"
        >
          <Link role="menuitem" href={`/loads/${loadId}`} className={item}>
            {labels.open}
          </Link>
          <button role="menuitem" type="button" onClick={copy} className={item}>
            {labels.copy}
          </button>
          {attachPod ? (
            <Link
              role="menuitem"
              href={`/loads/${loadId}#pod`}
              className={item}
            >
              {labels.attachPod}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
