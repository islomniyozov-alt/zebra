'use client'

import { useActionState, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { openBatchAction } from '../actions'
import { PAYROLL_INITIAL } from '../state'

interface Props {
  /**
   * The range Create opens, `YYYY-MM-DD` both ends, exactly as the screen
   * read it (§6.2.10 part 7, R1). Re-validated server-side.
   */
  from: string
  to: string
  /** The authority to settle; required for a new batch (part 7, R2). */
  companyId: string
  disabled: boolean
  /** How many trips the grid rendered, so the count starts right. */
  shown: number
  labels: {
    /** `Add {count} trips` — `{count}` substituted here, live. */
    add: string
    selectAll: string
    /** The range, said beside the button. */
    period: string
  }
  /** The trip grid. Its checkboxes are this form's inputs. */
  children: ReactNode
}

/**
 * The trip picker and the button that opens the batch (§6.2.10 part 1).
 *
 * ── THE TICKS ARE THE FORM, AND THE FORM POSTS BOTH SETS ──────────────────
 *
 * `Table`'s selection renders a checkbox per row under `trip`, plus a hidden
 * input per row under `shown`. Checkboxes post only when ticked, so the server
 * computes the office's decision as `shown` minus `trip` — the EXCLUSIONS.
 *
 * WHY NOT RECOMPUTE THE AVAILABLE SET SERVER-SIDE: a trip that is delivered
 * between this page rendering and somebody pressing the button is not in `shown`,
 * so it is not excluded — it simply joins the batch, which is exactly the
 * monotonicity the exclusion design exists for (§6.2.10). Recomputing would make
 * that trip look unticked and quietly keep it out of somebody's pay.
 *
 * ── THE COUNT IS LIVE, AND IT IS THE BUTTON'S OWN LABEL ───────────────────
 *
 * "Add 34 trips" is a sentence a person can check against the screen before
 * pressing it. A bare "Create" after unticking nine rows is the same click with
 * nothing to verify.
 */
export function CreateBatch({
  from,
  to,
  companyId,
  disabled,
  shown,
  labels,
  children,
}: Props) {
  const [state, open, pending] = useActionState(
    openBatchAction,
    PAYROLL_INITIAL,
  )
  const form = useRef<HTMLFormElement>(null)
  const [picked, setPicked] = useState(shown)

  // COUNTED OFF THE DOM, not mirrored into React state per row. The inputs are
  // server-rendered inside this form, so the form itself is the source of truth
  // and there is no second copy to drift.
  const recount = () => {
    const boxes =
      form.current?.querySelectorAll<HTMLInputElement>('input[name="trip"]')
    if (!boxes) return
    setPicked([...boxes].filter((box) => box.checked).length)
  }

  const selectAll = () => {
    const boxes =
      form.current?.querySelectorAll<HTMLInputElement>('input[name="trip"]')
    if (!boxes) return
    for (const box of boxes) box.checked = true
    recount()
  }

  return (
    <form action={open} ref={form} onChange={recount}>
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <input type="hidden" name="companyId" value={companyId} />

      <div className="flex items-center gap-z3 border-b border-border bg-surface-2 px-gutter py-z2">
        <Button
          type="button"
          variant="secondary"
          size="compact"
          onClick={selectAll}
        >
          {labels.selectAll}
        </Button>
        <span className="text-xs text-ink-3">{labels.period}</span>
        <span className="ms-auto flex items-center gap-z2">
          <Button
            type="submit"
            variant="primary"
            size="compact"
            // NOTHING TICKED IS NOT A BATCH. An empty batch is a document
            // somebody has to go and delete, and the button says so by being
            // unavailable rather than by refusing after the click.
            disabled={disabled || pending || picked === 0}
            aria-disabled={disabled || picked === 0}
          >
            {labels.add.replace('{count}', String(picked))}
          </Button>
        </span>
      </div>

      {state.error ? (
        <p
          className="border-b border-border bg-danger-soft px-gutter py-z2 text-xs text-danger"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}

      {children}
    </form>
  )
}
