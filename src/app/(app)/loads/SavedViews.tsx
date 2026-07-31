'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cx } from '@/lib/cx'
import { deleteViewAction, saveViewAction } from './view-actions'
import { VIEW_INITIAL, type ViewState } from './view-state'
import type { SavedView } from '@/lib/preferences'

// §7.4 — "Saved views are first-class: a named filter set, per user, pinned to
// the top of the table. 'My trucks today' should be one click, not four."
//
// Pinned above the table, not behind a menu, because one click is the whole
// requirement. The save control only appears when there is something to save:
// offering "save this view" on an unfiltered table is offering to bookmark the
// table itself.

interface Props {
  views: readonly SavedView[]
  labels: {
    save: string
    name: string
    saveHint: string
    remove: string
    all: string
    cancel: string
  }
}

export function SavedViews({ views, labels }: Props) {
  const params = useSearchParams()
  const pathname = usePathname()
  const [naming, setNaming] = useState(false)
  const [state, action, pending] = useActionState<ViewState, FormData>(
    saveViewAction,
    VIEW_INITIAL,
  )

  const current = params.toString()
  const filtered = current.length > 0

  return (
    <div className="flex flex-wrap items-center gap-z2 border-b border-border bg-surface-2 px-gutter py-z2">
      <Link
        href={pathname}
        className={cx(
          'h-control-compact rounded-control border px-z2 text-xs font-medium leading-[26px]',
          filtered
            ? 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3'
            : 'border-accent bg-accent-soft text-accent',
        )}
      >
        {labels.all}
      </Link>

      {views.map((view) => {
        const active = view.query === current
        return (
          <span key={view.slug} className="flex items-center">
            <Link
              href={`${pathname}?${view.query}`}
              className={cx(
                'h-control-compact rounded-s-control border px-z2 text-xs font-medium leading-[26px]',
                active
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
              )}
            >
              {view.name}
            </Link>
            {/* Removing a bookmark is not destructive enough for a modal, and
             * a modal on every chip would be four clicks to undo one. */}
            <form action={deleteViewAction.bind(null, view.slug)}>
              <button
                type="submit"
                aria-label={`${labels.remove} ${view.name}`}
                className="h-control-compact rounded-e-control border border-s-0 border-border-strong bg-surface px-z1 text-xs text-ink-3 hover:bg-surface-3 hover:text-danger"
              >
                ×
              </button>
            </form>
          </span>
        )
      })}

      {filtered && !naming ? (
        <Button
          type="button"
          variant="ghost"
          size="compact"
          onClick={() => setNaming(true)}
        >
          {labels.save}
        </Button>
      ) : null}

      {naming ? (
        <form action={action} className="flex items-end gap-z2">
          {/* The query travels with the form rather than being re-derived on
           * the server: what gets saved is exactly what the dispatcher was
           * looking at, not what the server thinks they were looking at. */}
          <input type="hidden" name="query" value={current} />
          <Input
            name="name"
            label={labels.name}
            placeholder={labels.saveHint}
            required
            autoFocus
            className="h-control-compact"
          />
          <Button
            type="submit"
            variant="secondary"
            size="compact"
            disabled={pending}
          >
            {labels.save}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={() => setNaming(false)}
          >
            {labels.cancel}
          </Button>
        </form>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      ) : null}
    </div>
  )
}
