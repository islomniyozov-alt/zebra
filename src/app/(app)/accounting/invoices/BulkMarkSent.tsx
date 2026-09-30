'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { markSentBulkAction } from './bulk-actions'
import { SENT_INITIAL } from './bulk-state'

interface Props {
  /** The server-rendered grid, checkboxes and all. */
  children: ReactNode
  /** `email`, `portal`, … already translated, value is what gets recorded. */
  channels: readonly { value: string; label: string }[]
  labels: {
    selected: string
    markSent: string
    channel: string
    clear: string
    done: string
  }
  /** Refusal sentences, already translated — a client cannot call `t`. */
  reasons: Record<string, string>
}

/**
 * The form around the invoices grid, and the bar that appears once something
 * is ticked (§7.1).
 *
 * MODELLED ON `BulkStatus` ON THE BATCHES GRID, deliberately and down to the
 * count coming from the DOM: the checkboxes ARE the state, they are form
 * fields, they post themselves, and counting them on change is one line that
 * cannot drift from what will be submitted. Holding a selection in React
 * state would mean lifting every row's identity into this component and
 * keeping it in step with a server-rendered body that re-renders on every
 * sort, filter and page.
 *
 * ── THE CHANNEL IS PART OF THE ACTION, NOT A SETTING ─────────────────────
 *
 * It sits in the bar beside the button rather than in a preference, because
 * it is a fact about THIS batch of invoices — the week you emailed twenty and
 * posted two is the week a remembered default would record the wrong thing
 * about two of them.
 */
export function BulkMarkSent({ children, channels, labels, reasons }: Props) {
  const [count, setCount] = useState(0)
  const [state, markSent, pending] = useActionState(
    markSentBulkAction,
    SENT_INITIAL,
  )

  return (
    <form
      action={markSent}
      onChange={(event) => {
        const form = event.currentTarget
        setCount(
          form.querySelectorAll<HTMLInputElement>(
            'input[name="invoice"]:checked',
          ).length,
        )
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}

      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-z3 border-t border-border bg-surface-2 px-gutter py-z2">
          <span className="text-sm text-ink">
            <span className="font-mono tabular-nums">{count}</span>{' '}
            {labels.selected}
          </span>

          <label className="flex items-center gap-z2 text-xs text-ink-2">
            {labels.channel}
            <select
              name="channel"
              required
              defaultValue=""
              className="h-control rounded-control border border-border-strong bg-surface px-z2 text-sm text-ink"
            >
              <option value="" disabled />
              {channels.map((channel) => (
                <option key={channel.value} value={channel.value}>
                  {channel.label}
                </option>
              ))}
            </select>
          </label>

          <Button
            type="submit"
            variant="secondary"
            size="compact"
            disabled={pending}
          >
            {labels.markSent}
          </Button>
        </div>
      ) : null}

      {state.changed > 0 || state.refusals.length > 0 ? (
        <div className="border-t border-border bg-surface-2 px-gutter py-z2 text-sm">
          {state.changed > 0 ? (
            <p className="text-ink">
              <span className="font-mono tabular-nums">{state.changed}</span>{' '}
              {labels.done}
            </p>
          ) : null}
          {/* BY NAME, NOT COUNTED. "17 of 20" tells somebody three brokers
           * were not billed and not which three. */}
          {state.refusals.map((refusal) => (
            <p key={refusal.invoice} className="text-danger" role="alert">
              <span className="z-identifier font-mono" dir="ltr">
                {refusal.invoice}
              </span>{' '}
              {reasons[refusal.reason] ?? refusal.reason}
            </p>
          ))}
        </div>
      ) : null}
    </form>
  )
}
