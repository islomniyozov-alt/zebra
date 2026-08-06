'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { closePayRuleAction, savePayRuleAction } from '../pay-actions'
import { PAY_RULE_INITIAL, type PayRuleState } from '../pay-state'

// THE FOUR RULES, BY NAME.
//
// "Percent of gross" and "percent of linehaul" are separate entries in the
// list and not a percentage box with a base toggle beside it. On a
// $2,450 + $380 + $160 load at 30% they differ by $162.00, every load, and a
// control that makes one of them the default makes that difference invisible.
// The hint under the field says which is which in words.
//
// CUSTOM is not offered. The engine refuses it too — see driver-pay.ts — so
// this is not the only thing standing between an expression and payroll.

export interface PayRuleRowView {
  id: string
  type: string
  typeLabel: string
  /** Pre-formatted by the server: "30%", "$0.58 / mi", "$450.00". */
  figure: string
  from: string
  to: string | null
  isCurrent: boolean
  notes: string | null
}

interface Props {
  driverId: string
  rules: readonly PayRuleRowView[]
  types: readonly SelectOption[]
  today: string
  /** A MANAGER reads the rules and does not write them. */
  readOnly: boolean
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    add: string
    type: string
    percent: string
    perMile: string
    flat: string
    from: string
    to: string
    toHint: string
    open: string
    notes: string
    save: string
    close: string
    closeHint: string
    none: string
    grossHint: string
    linehaulHint: string
  }
}

export function PayRules({
  driverId,
  rules,
  types,
  today,
  readOnly,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<PayRuleState, FormData>(
    savePayRuleAction.bind(null, driverId),
    PAY_RULE_INITIAL,
  )
  const [type, setType] = useState('PERCENT_GROSS')

  const isPercent = type === 'PERCENT_GROSS' || type === 'PERCENT_LINEHAUL'

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      {rules.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-2">{labels.none}</p>
      ) : (
        <ul className="mt-z3 flex flex-col">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-baseline gap-x-z3 gap-y-z1 border-b border-border py-z2 text-sm last:border-b-0"
            >
              <span className="font-medium text-ink">{rule.typeLabel}</span>
              <span className="font-mono tabular-nums text-ink">
                {rule.figure}
              </span>
              <span className="font-mono text-xs text-ink-3">
                {rule.from} → {rule.to ?? '—'}
              </span>
              {rule.isCurrent ? (
                <span className="rounded-control border border-border-strong px-z2 text-xs text-ink-2">
                  {labels.open}
                </span>
              ) : null}
              {rule.notes ? (
                <span className="text-ink-3">{rule.notes}</span>
              ) : null}
              {rule.isCurrent && !readOnly ? (
                <CloseRule
                  driverId={driverId}
                  ruleId={rule.id}
                  today={today}
                  labels={{ close: labels.close, hint: labels.closeHint }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {readOnly ? null : (
        <form action={act} className="mt-z4 flex flex-col gap-z3">
          <h3 className="text-sm font-medium text-ink-2">{labels.add}</h3>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
            <Select
              name="type"
              label={labels.type}
              required
              options={types}
              value={type}
              onChange={(event) => setType(event.target.value)}
            />

            {/* Only the field this rule type uses is rendered. A hidden leftover
             * is a number that ends up on the saved rule. */}
            {isPercent ? (
              <Input
                name="percent"
                label={labels.percent}
                required
                inputMode="decimal"
                hint={
                  type === 'PERCENT_GROSS'
                    ? labels.grossHint
                    : labels.linehaulHint
                }
              />
            ) : null}
            {type === 'PER_MILE' ? (
              <Input
                name="perMile"
                label={labels.perMile}
                required
                inputMode="decimal"
              />
            ) : null}
            {type === 'FLAT_PER_LOAD' ? (
              <Input
                name="flat"
                label={labels.flat}
                required
                inputMode="decimal"
              />
            ) : null}

            <Input
              name="effectiveFrom"
              label={labels.from}
              required
              defaultValue={today}
              inputMode="numeric"
            />
            <Input
              name="effectiveTo"
              label={labels.to}
              hint={labels.toHint}
              inputMode="numeric"
            />
            <Input name="notes" label={labels.notes} />
          </div>

          <div className="flex items-center gap-z3">
            <Button type="submit" variant="secondary" disabled={pending}>
              {labels.save}
            </Button>
            {state.error ? (
              <p role="alert" className="text-sm text-danger">
                {translate[state.error] ?? state.error}
              </p>
            ) : null}
          </div>
        </form>
      )}
    </section>
  )
}

function CloseRule({
  driverId,
  ruleId,
  today,
  labels,
}: {
  driverId: string
  ruleId: string
  today: string
  labels: { close: string; hint: string }
}) {
  const [, act, pending] = useActionState<PayRuleState, FormData>(
    closePayRuleAction.bind(null, driverId, ruleId),
    PAY_RULE_INITIAL,
  )

  return (
    <form action={act} className="ms-auto flex items-center gap-z2">
      <input
        name="effectiveTo"
        defaultValue={today}
        aria-label={labels.hint}
        inputMode="numeric"
        className="h-control-compact w-[110px] rounded-control border border-border-strong bg-surface px-z2 font-mono text-xs text-ink"
      />
      {/* Ghost, not danger: closing a rule is not destructive — the rule stays
       * and every settlement it produced is untouched. */}
      <Button type="submit" variant="ghost" size="compact" disabled={pending}>
        {labels.close}
      </Button>
    </form>
  )
}
