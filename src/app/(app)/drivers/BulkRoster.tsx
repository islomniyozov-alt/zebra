'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { changeRosterAction } from './bulk-actions'
import { ROSTER_BULK_INITIAL } from './bulk-state'

interface Props {
  /** The server-rendered grid, checkboxes and all. */
  children: ReactNode
  labels: {
    selected: string
    active: string
    vacation: string
    terminated: string
    clear: string
    blocked: string
    done: string
  }
  /** Refusal sentences, already translated — a client cannot call `t`. */
  reasons: Record<string, string>
}

/**
 * The form around the drivers grid, and the bar that appears once something is
 * ticked (§7.1; the same shape as payroll's `BulkStatus`, for the same reasons:
 * the grid is server-rendered `children`, the checkboxes ARE the selection, and
 * the server decides per row and refuses by name).
 *
 * THREE BUTTONS, ALL ROSTER VALUES (§6.4 part 1, owner's ruling 2026-09-21).
 * Nothing here can set Dispatched or On route — those are read off the freight.
 */
export function BulkRoster({ children, labels, reasons }: Props) {
  const [count, setCount] = useState(0)
  const [activeState, markActive, activating] = useActionState(
    changeRosterAction.bind(null, 'active'),
    ROSTER_BULK_INITIAL,
  )
  const [vacationState, markVacation, vacationing] = useActionState(
    changeRosterAction.bind(null, 'vacation'),
    ROSTER_BULK_INITIAL,
  )
  const [terminatedState, markTerminated, terminating] = useActionState(
    changeRosterAction.bind(null, 'terminated'),
    ROSTER_BULK_INITIAL,
  )

  const states = [activeState, vacationState, terminatedState]
  const state =
    states.find((row) => row.changed + row.refusals.length > 0) ??
    ROSTER_BULK_INITIAL
  const busy = activating || vacationing || terminating

  const recount = (form: HTMLFormElement | null) => {
    if (!form) return
    setCount(
      form.querySelectorAll<HTMLInputElement>('input[name="driver"]:checked')
        .length,
    )
  }

  return (
    <form
      onChange={(event) => recount(event.currentTarget)}
      className="contents"
    >
      {children}

      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-z2 border-t border-border-strong bg-accent-soft px-gutter py-z2">
          <span className="text-xs font-medium text-accent">
            {count} {labels.selected}
          </span>
          <Button
            type="submit"
            formAction={markActive}
            variant="primary"
            size="compact"
            disabled={busy}
          >
            {labels.active}
          </Button>
          <Button
            type="submit"
            formAction={markVacation}
            variant="secondary"
            size="compact"
            disabled={busy}
          >
            {labels.vacation}
          </Button>
          <Button
            type="submit"
            formAction={markTerminated}
            variant="secondary"
            size="compact"
            disabled={busy}
          >
            {labels.terminated}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            onClick={(event) => {
              const form = event.currentTarget.closest('form')
              form
                ?.querySelectorAll<HTMLInputElement>('input[name="driver"]')
                .forEach((box) => {
                  box.checked = false
                })
              setCount(0)
            }}
          >
            {labels.clear}
          </Button>
        </div>
      ) : null}

      {state.refusals.length > 0 ? (
        <div
          className="border-t border-danger bg-danger-soft px-gutter py-z3"
          role="alert"
        >
          <p className="text-sm font-medium text-danger">{labels.blocked}</p>
          <ul className="mt-z1 flex flex-col gap-z1 text-xs text-ink">
            {state.refusals.map((refusal) => (
              <li key={refusal.driver}>
                <span className="font-medium">{refusal.driver}</span> —{' '}
                {reasons[refusal.reason] ?? refusal.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.changed > 0 ? (
        <p className="border-t border-border bg-success-soft px-gutter py-z2 text-xs text-success">
          {labels.done} {state.changed}
        </p>
      ) : null}
    </form>
  )
}
