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
}: {
  settlementId: string
  translate: Record<string, string>
  labels: { approve: string; hint: string }
}) {
  const [state, act, pending] = useActionState<SettlementState, FormData>(
    approveSettlementAction.bind(null, settlementId),
    SETTLEMENT_INITIAL,
  )
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
