'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import {
  addLineAction,
  approveSettlementAction,
  markPaidAction,
  removeLineAction,
  voidSettlementAction,
  addTripsAction,
  recalculateAction,
  sendToDriverAction,
} from '../actions'
import { SETTLEMENT_INITIAL, type SettlementState } from '../settlement-state'

// The three things somebody does to a settlement after it is generated, each
// one gated on the state it belongs to: add lines while it is a DRAFT, approve
// it once, record the payment once it is approved.
//
// They are separate forms rather than one panel with buttons that grey out,
// because "you cannot do that yet" is better said by the control not being
// there than by it being there and refusing.

function Error({
  state,
  translate,
}: {
  state: SettlementState
  translate: Record<string, string>
}) {
  if (!state.error) return null
  return (
    <p role="alert" className="text-sm text-danger">
      {(translate[state.error] ?? state.error).replace(
        '{loads}',
        state.loadNumbers.join(', '),
      )}
    </p>
  )
}

export function AddLine({
  settlementId,
  types,
  translate,
  labels,
}: {
  settlementId: string
  types: readonly SelectOption[]
  translate: Record<string, string>
  labels: {
    heading: string
    hint: string
    type: string
    description: string
    amount: string
    add: string
  }
}) {
  const [state, act, pending] = useActionState<SettlementState, FormData>(
    addLineAction.bind(null, settlementId),
    SETTLEMENT_INITIAL,
  )

  return (
    <form action={act} className="flex flex-col gap-z3">
      <div>
        <h2 className="text-md font-medium text-ink">{labels.heading}</h2>
        <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>
      </div>
      <div className="flex flex-wrap items-end gap-z3">
        <Select
          name="type"
          label={labels.type}
          required
          options={types}
          className="w-[200px]"
        />
        <Input
          name="description"
          label={labels.description}
          required
          className="w-[260px]"
        />
        {/* Typed POSITIVE always. The sign comes from the type, not from
         * whether somebody remembered the minus. */}
        <Input
          name="amount"
          label={labels.amount}
          required
          inputMode="decimal"
          className="w-[140px]"
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {labels.add}
        </Button>
      </div>
      <Error state={state} translate={translate} />
    </form>
  )
}

export function RemoveLine({
  settlementId,
  lineId,
  label,
}: {
  settlementId: string
  lineId: string
  label: string
}) {
  const [, act, pending] = useActionState<SettlementState, FormData>(
    removeLineAction.bind(null, settlementId, lineId),
    SETTLEMENT_INITIAL,
  )
  return (
    <form action={act}>
      {/* Ghost, not danger: standing rule 11 keeps the accent off destructive
       * actions, and a line on a draft is cheap to put back. */}
      <Button type="submit" variant="ghost" size="compact" disabled={pending}>
        {label}
      </Button>
    </form>
  )
}

export function Approve({
  settlementId,
  translate,
  labels,
  inToolbar = false,
}: {
  settlementId: string
  translate: Record<string, string>
  labels: { approve: string; hint: string }
  /**
   * §6.2.2's action row rather than a panel of its own.
   *
   * THE HINT IS THE WHOLE DIFFERENCE. "Approving freezes it. Deductions can no
   * longer be added" is a paragraph, and a paragraph in a toolbar wraps across
   * the page head and shoves the buttons sideways — which is exactly what the
   * first render of the workbench did. It belongs on the button as a title
   * there, and as prose when the control has a panel to itself.
   */
  inToolbar?: boolean
}) {
  const [state, act, pending] = useActionState<SettlementState, FormData>(
    approveSettlementAction.bind(null, settlementId),
    SETTLEMENT_INITIAL,
  )

  if (inToolbar) {
    return (
      <form action={act} className="flex items-center gap-z2">
        <Button
          type="submit"
          variant="primary"
          size="compact"
          disabled={pending}
          title={labels.hint}
        >
          {labels.approve}
        </Button>
        <Error state={state} translate={translate} />
      </form>
    )
  }

  return (
    <form action={act} className="flex flex-col gap-z2">
      <p className="max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>
      <div className="flex items-center gap-z3">
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.approve}
        </Button>
        <Error state={state} translate={translate} />
      </div>
    </form>
  )
}

export function MarkPaid({
  settlementId,
  methods,
  translate,
  labels,
}: {
  settlementId: string
  methods: readonly SelectOption[]
  translate: Record<string, string>
  labels: {
    heading: string
    method: string
    reference: string
    referenceHint: string
    markPaid: string
  }
}) {
  const [state, act, pending] = useActionState<SettlementState, FormData>(
    markPaidAction.bind(null, settlementId),
    SETTLEMENT_INITIAL,
  )
  return (
    <form action={act} className="flex flex-col gap-z3">
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>
      <div className="flex flex-wrap items-end gap-z3">
        <Select
          name="method"
          label={labels.method}
          required
          options={methods}
          className="w-[200px]"
        />
        <Input
          name="reference"
          label={labels.reference}
          hint={labels.referenceHint}
          required
          className="w-[260px]"
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.markPaid}
        </Button>
      </div>
      <Error state={state} translate={translate} />
    </form>
  )
}

export function VoidSettlement({
  settlementId,
  translate,
  labels,
}: {
  settlementId: string
  translate: Record<string, string>
  labels: { void: string; hint: string }
}) {
  const [state, act, pending] = useActionState<SettlementState, FormData>(
    voidSettlementAction.bind(null, settlementId),
    SETTLEMENT_INITIAL,
  )
  return (
    <form action={act} className="flex flex-col gap-z2">
      <p className="max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>
      <div className="flex items-center gap-z3">
        <Button type="submit" variant="danger" disabled={pending}>
          {labels.void}
        </Button>
        <Error state={state} translate={translate} />
      </div>
    </form>
  )
}

/**
 * The unsettled freight this driver has in the period, offered for adding.
 *
 * ── HELD LOADS ARE LISTED, MARKED, AND NOT PRE-TICKED ─────────────────────
 *
 * Owner's ruling: "held included with reason". A held load is one the engine
 * declined to price — the remittance has not arrived, or arrived short — and it
 * is the most interesting row in the panel, because it is the freight somebody
 * has to decide about. Hiding it would make the panel lie by omission about
 * what this driver ran.
 *
 * ITS CHECKBOX STARTS EMPTY AND ITS ROW CARRIES THE REASON. Adding one is then
 * a deliberate act by somebody who has read why the engine would not. A clean
 * load starts ticked, because that is the case where there is nothing to weigh.
 */
export function AddTrips({
  settlementId,
  trips,
  translate,
  labels,
}: {
  settlementId: string
  trips: readonly {
    loadId: string
    loadNumber: string
    route: string
    gross: string
    held: string | null
  }[]
  translate: Record<string, string>
  labels: { heading: string; hint: string; add: string; heldNote: string }
}) {
  const [state, act, pending] = useActionState(
    addTripsAction.bind(null, settlementId),
    SETTLEMENT_INITIAL,
  )

  if (trips.length === 0) return null

  return (
    <form action={act} className="flex flex-col gap-z2">
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>
      <p className="text-xs text-ink-3">{labels.hint}</p>

      <ul className="flex flex-col">
        {trips.map((trip) => (
          <li
            key={trip.loadId}
            className="flex items-baseline gap-z3 border-b border-border py-z2 text-sm last:border-b-0"
          >
            <input
              type="checkbox"
              name="load"
              value={trip.loadId}
              defaultChecked={trip.held === null}
              aria-label={trip.loadNumber}
              className="size-[14px] accent-[var(--color-accent)]"
            />
            <span className="z-identifier font-mono text-ink" dir="ltr">
              {trip.loadNumber}
            </span>
            <span className="flex-1 truncate text-ink-2">{trip.route}</span>
            {trip.held ? (
              <span className="text-xs text-warning">
                {labels.heldNote} {trip.held}
              </span>
            ) : null}
            <span className="font-mono tabular-nums text-ink">
              {trip.gross}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-z2">
        <Button
          type="submit"
          variant="primary"
          size="compact"
          disabled={pending}
        >
          {labels.add}
        </Button>
        {state.error ? (
          <p className="text-xs text-danger" role="alert">
            {translate[state.error] ?? state.error}
          </p>
        ) : null}
      </div>
    </form>
  )
}

/** Re-add the lines. See the action for why it does not re-price them. */
export function Recalculate({
  settlementId,
  label,
}: {
  settlementId: string
  label: string
}) {
  const [, act, pending] = useActionState(
    recalculateAction.bind(null, settlementId),
    SETTLEMENT_INITIAL,
  )
  return (
    <form action={act}>
      <Button
        type="submit"
        variant="secondary"
        size="compact"
        disabled={pending}
      >
        {label}
      </Button>
    </form>
  )
}

/**
 * Mail this statement to the driver.
 *
 * IT IS THE ONLY CONTROL ON THIS PAGE WITH A CONFIRM, and the confirm names
 * the address. Everything else here writes a row somebody can look at
 * afterwards; this one puts a figure in front of a person and cannot be
 * recalled. The address is shown because the mistake worth catching is the
 * right button pressed on the wrong driver's statement.
 *
 * IT REFUSES LOUDLY RATHER THAN HIDING. On dev it always fails with
 * `not_production` (see `statement-send.ts`), and that refusal is the message
 * the office should see — a button greyed out with no sentence would send
 * somebody looking for a permission they do not lack.
 */
export function SendToDriver({
  settlementId,
  email,
  labels,
  translate,
}: {
  settlementId: string
  email: string | null
  labels: { send: string; confirm: string; sent: string }
  translate: Record<string, string>
}) {
  const [state, act, pending] = useActionState<SettlementState, FormData>(
    sendToDriverAction.bind(null, settlementId),
    SETTLEMENT_INITIAL,
  )

  return (
    <form
      action={act}
      className="flex items-center gap-z2"
      onSubmit={(event) => {
        if (!globalThis.confirm(`${labels.confirm} ${email ?? ''}`.trim())) {
          event.preventDefault()
        }
      }}
    >
      <Button
        type="submit"
        variant="secondary"
        size="compact"
        disabled={pending}
      >
        {labels.send}
      </Button>
      <Error state={state} translate={translate} />
    </form>
  )
}
