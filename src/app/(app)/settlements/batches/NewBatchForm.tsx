'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { checkDateFor, weekOf } from '@/lib/settlement-week'
import { createBatchAction, type BatchState } from './actions'

// NOT exported from actions.ts — a 'use server' file may only export async
// functions, and Next refuses that at BUILD time, which `npm run check` never
// reaches.
const INITIAL: BatchState = { error: null, blocked: [] }

interface Props {
  companies: readonly { id: string; name: string }[]
  labels: {
    heading: string
    company: string
    week: string
    weekHint: string
    statementDate: string
    checkDate: string
    checkDateDerived: string
    create: string
  }
}

/**
 * A batch is a company, a week and ONE typed date.
 *
 * THE CHECK DATE USED TO BE THE SECOND ONE AND IS NOW SHOWN, NOT TYPED. It is
 * `checkDateFor` — period end + 13, the verified cadence — and this form is
 * where 2026-09-25 was keyed against a period ending 9/19 (§0 as amended
 * 2026-09-28). A field nobody can edit is not a field somebody can get wrong.
 *
 * SHOWN RATHER THAN HIDDEN, because the person pressing the button is about to
 * cut cheques on that date and should see it before the batch exists. It is read
 * from the same function the create calls, so the screen cannot promise a date
 * the create would not write.
 *
 * Any day of the week is accepted and snapped to its Sunday — a person choosing
 * "the week of the 19th" should not have to know which day it began.
 */
export function NewBatchForm({ companies, labels }: Props) {
  const [state, action, pending] = useActionState(createBatchAction, INITIAL)
  const [periodStart, setPeriodStart] = useState('')

  // The same two functions the action calls, in the same order. An empty or
  // half-typed date gives no week and therefore no promise.
  const derived = (() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return null
    const day = new Date(`${periodStart}T00:00:00.000Z`)
    if (Number.isNaN(day.getTime())) return null
    return checkDateFor(weekOf(day)).toISOString().slice(0, 10)
  })()

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-z3 rounded-card border border-border bg-surface p-z4"
    >
      <h2 className="w-full text-md font-medium text-ink">{labels.heading}</h2>

      <Select
        name="companyId"
        label={labels.company}
        options={companies.map((company) => ({
          value: company.id,
          label: company.name,
        }))}
        className="w-[200px]"
      />
      <div>
        <Input
          name="periodStart"
          type="date"
          label={labels.week}
          className="w-[170px]"
          value={periodStart}
          onChange={(event) => setPeriodStart(event.target.value)}
        />
        <p className="mt-z1 max-w-[220px] text-xs text-ink-3">
          {labels.weekHint}
        </p>
      </div>
      <Input
        name="statementDate"
        type="date"
        label={labels.statementDate}
        className="w-[170px]"
      />
      {/* NO `name`, so nothing is posted and the action has nothing to read. */}
      <div className="w-[170px]">
        <p className="text-xs text-ink-3">{labels.checkDate}</p>
        <p className="mt-z1 text-sm text-ink tabular-nums">{derived ?? '—'}</p>
        <p className="mt-z1 text-xs text-ink-3">{labels.checkDateDerived}</p>
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        {labels.create}
      </Button>

      {state.error ? (
        <p className="w-full text-xs text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
