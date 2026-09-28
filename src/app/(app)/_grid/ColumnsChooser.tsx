'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { saveColumnsAction } from './columns-actions'
import { COLUMNS_INITIAL } from './columns-state'

interface Props {
  grid: string
  /** Every column this grid has, in the table's own order. */
  columns: readonly { key: string; header: string }[]
  visible: readonly string[]
  labels: {
    open: string
    apply: string
    cancel: string
    /** Explains why the first column has no checkbox. */
    firstLocked: string
  }
  errors: Record<string, string>
}

/**
 * §7.1.4 — which columns this person keeps, on this grid.
 *
 * ── A POPOVER, NOT A MODAL ────────────────────────────────────────────────
 *
 * §7.5 permits a modal at six fields; this can be twelve checkboxes, and more
 * importantly the choice is made by LOOKING AT THE GRID. A modal covers the thing
 * being adjusted, which is the same argument the inline row editor makes.
 *
 * ── THE FIRST COLUMN HAS NO CHECKBOX ──────────────────────────────────────
 *
 * §7.1: the first cell carries the row's anchor, so the row's accessible name is
 * the thing that identifies it. Hiding it would leave a clickable row whose link
 * has no text — announced as "link" and nothing else. The control says so rather
 * than silently ignoring a tick, because a checkbox that springs back is worse
 * than one that was never offered.
 *
 * ── AND IT IS A FORM, SO IT WORKS WITHOUT JAVASCRIPT ──────────────────────
 *
 * Checkboxes plus a submit. The open/closed state is client state because a
 * popover has to be; everything that changes data is the form.
 */
export function ColumnsChooser({
  grid,
  columns,
  visible,
  labels,
  errors,
}: Props) {
  const [open, setOpen] = useState(false)
  const [state, save, saving] = useActionState(
    saveColumnsAction.bind(
      null,
      grid,
      columns.map((column) => column.key),
    ),
    COLUMNS_INITIAL,
  )

  if (!open) {
    return (
      <Button variant="secondary" size="compact" onClick={() => setOpen(true)}>
        {labels.open}
      </Button>
    )
  }

  const [first, ...rest] = columns

  return (
    <div className="relative">
      <Button variant="secondary" size="compact" onClick={() => setOpen(false)}>
        {labels.open}
      </Button>
      <form
        action={save}
        className="absolute end-0 top-[calc(100%+4px)] z-20 flex w-[240px] flex-col gap-z1 rounded-card border border-border-strong bg-surface p-z3 shadow-lg"
      >
        {first ? (
          <p className="text-xs text-ink-3">
            {first.header} — {labels.firstLocked}
          </p>
        ) : null}
        {rest.map((column) => (
          <label
            key={column.key}
            className="flex items-center gap-z2 text-base text-ink"
          >
            <input
              type="checkbox"
              name="column"
              value={column.key}
              defaultChecked={visible.includes(column.key)}
              className="size-[14px] accent-[var(--color-accent)]"
            />
            {column.header}
          </label>
        ))}
        <div className="mt-z2 flex items-center gap-z2">
          <Button
            type="submit"
            variant="primary"
            size="compact"
            disabled={saving}
          >
            {labels.apply}
          </Button>
          <Button variant="ghost" size="compact" onClick={() => setOpen(false)}>
            {labels.cancel}
          </Button>
        </div>
        {state.error ? (
          <p className="text-xs text-danger" role="alert">
            {errors[state.error] ?? state.error}
          </p>
        ) : null}
      </form>
    </div>
  )
}
