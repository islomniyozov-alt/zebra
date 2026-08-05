'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { markFactoredAction } from '../../receivables/actions'
import {
  FACTORING_INITIAL,
  type FactoringState,
} from '../../receivables/factoring-state'

// Selling the invoice. §3.3: this is not a status change, it is a sale — the
// factor becomes the collector, the invoice leaves aging, and a reserve the
// factor still holds appears in its place.
//
// The rate fields are OPTIONAL and blank means "the terms on file". They exist
// because a one-off deal happens, and typing the rate you actually got beats
// editing the standing terms and forgetting to put them back.

interface Props {
  invoiceId: string
  factors: readonly SelectOption[]
  translate: Record<string, string>
  labels: {
    markFactored: string
    hint: string
    factor: string
    advanceRate: string
    feeRate: string
    overrideHint: string
  }
}

export function MarkFactored({ invoiceId, factors, translate, labels }: Props) {
  const [state, act, pending] = useActionState<FactoringState, FormData>(
    markFactoredAction.bind(null, invoiceId),
    FACTORING_INITIAL,
  )

  return (
    <form action={act} className="flex flex-col gap-z3">
      <div>
        <h2 className="text-md font-medium text-ink">{labels.markFactored}</h2>
        <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
        <Select
          name="factoringCompanyId"
          label={labels.factor}
          required
          options={factors}
        />
        <Input
          name="advanceRate"
          label={labels.advanceRate}
          hint={labels.overrideHint}
          inputMode="decimal"
        />
        <Input name="feeRate" label={labels.feeRate} inputMode="decimal" />
      </div>

      <div className="flex items-center gap-z3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {labels.markFactored}
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {translate[state.error] ?? state.error}
          </p>
        ) : null}
      </div>
    </form>
  )
}
