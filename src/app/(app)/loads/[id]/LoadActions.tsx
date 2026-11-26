'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import type { DetailState } from './actions'
import { cx } from '@/lib/cx'

// NOT exported from actions.ts. A 'use server' file may only export async
// functions — Next refuses the build with "can only export async functions,
// found object", and it refuses at BUILD time, which npm run check never
// reaches. Deploy is what caught it. Standing rule 9 earning its place again.
const DETAIL_INITIAL: DetailState = { error: null, notice: null }

// The one manual status click, and the cancellation (§7).
//
// Cancel is behind a Modal because it looks final. It is not — cancelling
// never deletes anything and never touches the operational status, so a load
// cancelled in transit still says it was in transit. But it looks final to the
// person clicking at 6am, and that is who the confirmation is for.

interface Props {
  isCancelled: boolean
  canDeliver: boolean
  /**
   * `menu` (the Amazon detail, §7.13; owner's review 2026-11-17): the header
   * keeps only neutral actions — Mark delivered as a secondary button and a ⋮
   * menu — and Cancel load lives in the menu, the only place it is red.
   * `inline`, the default, is every other load detail as it was.
   */
  layout?: 'inline' | 'menu'
  markDelivered: (previous: DetailState) => Promise<DetailState>
  cancel: (previous: DetailState, formData: FormData) => Promise<DetailState>
  uncancel: () => Promise<void>
  /**
   * Duplicate load (TMS §7.14 part 7), in the ⋮ menu above Undo. Absent for
   * a role that may not create a load.
   */
  duplicate?: (previous: DetailState) => Promise<DetailState>
  /**
   * Undo (TMS §7.14 part 7). `enabled` and `detail` are `undoVerdict`'s
   * answer, asked by the page: what Undo would take back, or why it cannot.
   * The write asks the same predicate again before it acts.
   */
  undo?: {
    action: (previous: DetailState) => Promise<DetailState>
    enabled: boolean
    detail: string
  }
  labels: {
    markDelivered: string
    cancel: string
    cancelTitle: string
    cancelBody: string
    reason: string
    confirmCancel: string
    uncancel: string
    close: string
    /** The ⋮ button's name, for `layout="menu"`. */
    menu?: string
    duplicate?: string
    undo?: string
  }
}

const ITEM =
  'block w-full px-z3 py-z1 text-start text-xs font-medium focus-visible:outline-none'

export function LoadActions({
  isCancelled,
  canDeliver,
  markDelivered,
  cancel,
  uncancel,
  duplicate,
  undo,
  labels,
  layout = 'inline',
}: Props) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // Closes on a click anywhere else and on Escape, like every popover here.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])
  const [deliverState, deliverAction, delivering] = useActionState(
    markDelivered,
    DETAIL_INITIAL,
  )
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancel,
    DETAIL_INITIAL,
  )
  const [undoState, undoAction, undoing] = useActionState(
    undo?.action ?? (async () => DETAIL_INITIAL),
    DETAIL_INITIAL,
  )
  const [duplicateState, duplicateAction, duplicating] = useActionState(
    duplicate ?? (async () => DETAIL_INITIAL),
    DETAIL_INITIAL,
  )

  // THE ⋮ MENU (§7.13; §7.14 part 7): Duplicate load, Undo, then Cancel load
  // — red, and last. A cancelled load keeps the menu without Cancel, because
  // Undo is how a cancellation made a minute ago is taken back.
  const menu =
    layout === 'menu' ? (
      <div ref={menuRef} className="relative">
        <button
          type="button"
          data-load-menu
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={labels.menu}
          onClick={() => setMenuOpen((value) => !value)}
          className="inline-flex h-control-compact items-center justify-center px-z1 rounded-control border border-border-strong bg-surface text-ink-2 hover:bg-surface-3 focus-visible:outline focus-visible:outline-2"
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
        {menuOpen ? (
          <div
            role="menu"
            className="absolute end-0 top-[calc(100%+4px)] z-30 min-w-[220px] rounded-card border border-border-strong bg-surface py-z1 shadow-lg"
          >
            {duplicate ? (
              <form action={duplicateAction}>
                <button
                  type="submit"
                  role="menuitem"
                  disabled={duplicating}
                  className={cx(
                    ITEM,
                    'text-ink hover:bg-surface-3 focus-visible:bg-surface-3',
                  )}
                >
                  {labels.duplicate}
                </button>
              </form>
            ) : null}
            {undo ? (
              <form action={undoAction} onSubmit={() => setMenuOpen(false)}>
                {/* Disabled says why, in the item itself: a greyed Undo with
                 * no reason invites clicking it again. */}
                <button
                  type="submit"
                  role="menuitem"
                  disabled={!undo.enabled || undoing}
                  aria-describedby="undo-detail"
                  className={cx(
                    ITEM,
                    undo.enabled
                      ? 'text-ink hover:bg-surface-3 focus-visible:bg-surface-3'
                      : 'cursor-not-allowed text-ink-3',
                  )}
                >
                  {labels.undo}
                  <span
                    id="undo-detail"
                    className="block text-xs font-normal text-ink-3"
                  >
                    {undo.detail}
                  </span>
                </button>
              </form>
            ) : null}
            {isCancelled ? null : (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  setOpen(true)
                }}
                className={cx(
                  ITEM,
                  'text-danger hover:bg-danger-soft focus-visible:bg-danger-soft',
                )}
              >
                {labels.confirmCancel}
              </button>
            )}
          </div>
        ) : null}
      </div>
    ) : null

  // A refused Undo or Duplicate says why, beside the menu.
  const menuError = undoState.error ?? duplicateState.error

  if (isCancelled) {
    return (
      <div className="flex items-center gap-z2">
        <form action={uncancel}>
          <Button type="submit" variant="secondary" size="compact">
            {labels.uncancel}
          </Button>
        </form>
        {menu}
        {menuError ? (
          <p role="alert" className="text-sm text-danger">
            {menuError}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-z2">
      {canDeliver ? (
        <form action={deliverAction}>
          <Button
            type="submit"
            variant={layout === 'menu' ? 'secondary' : 'primary'}
            size="compact"
            disabled={delivering}
          >
            {labels.markDelivered}
          </Button>
        </form>
      ) : null}

      {/* Standing rule 11 of the design system: destructive actions are never
       * accent-coloured. In the menu layout Cancel is not in the header at
       * all — it is the menu's red item, behind the same confirmation. */}
      {layout === 'menu' ? (
        menu
      ) : (
        <Button
          type="button"
          variant="danger"
          size="compact"
          onClick={() => setOpen(true)}
        >
          {labels.cancel}
        </Button>
      )}

      {menuError ? (
        <p role="alert" className="text-sm text-danger">
          {menuError}
        </p>
      ) : null}

      {/* A declined transition is a NOTICE, not an error. The person clicking
       * did nothing wrong — the load is simply further along than their screen
       * was, which is the race §7's idempotence exists to survive. */}
      {deliverState.notice ? (
        <p role="status" className="text-sm text-warning">
          {deliverState.notice}
        </p>
      ) : null}

      <Modal
        open={open}
        title={labels.cancelTitle}
        onClose={() => setOpen(false)}
      >
        <form
          action={cancelAction}
          onSubmit={() => setOpen(false)}
          className="flex flex-col gap-z4"
        >
          <p className="text-sm text-ink-2">{labels.cancelBody}</p>
          <Input name="reason" label={labels.reason} required autoFocus />
          {cancelState.error ? (
            <p role="alert" className="text-base text-danger">
              {cancelState.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-z2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {labels.close}
            </Button>
            <Button type="submit" variant="danger" disabled={cancelling}>
              {labels.confirmCancel}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

interface NotesProps {
  notes: ReadonlyArray<{
    id: string
    body: string
    at: string
    by: string | null
  }>
  add: (previous: DetailState, formData: FormData) => Promise<DetailState>
  labels: { title: string; placeholder: string; post: string; empty: string }
}

/** The communication log (§10). Writes `Communication` rows, not free text. */
export function LoadNotes({ notes, add, labels }: NotesProps) {
  const [state, action, pending] = useActionState(add, DETAIL_INITIAL)

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>

      <form action={action} className="mt-z3 flex items-end gap-z2">
        <div className="flex-1">
          <Input
            name="body"
            label={labels.title}
            placeholder={labels.placeholder}
            required
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {labels.post}
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="mt-z2 text-base text-danger">
          {state.error}
        </p>
      ) : null}

      {notes.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-3">{labels.empty}</p>
      ) : (
        <ul className="mt-z3 flex flex-col gap-z2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="border-b border-border pb-z2 last:border-b-0"
            >
              <p className="text-base text-ink">{note.body}</p>
              <p className="mt-z1 text-xs text-ink-3">
                <span className="font-mono">{note.at}</span>
                {note.by ? ` · ${note.by}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
