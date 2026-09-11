'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
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
    create: string
  }
}

/**
 * A batch is a company, a week and TWO TYPED DATES.
 *
 * The dates are inputs rather than derived: on all six real statements the
 * check date is the statement date plus two, and turning that into a default
 * would make a coincidence into a rule about when somebody's cheque is cut.
 * Any day of the week is accepted and snapped to its Sunday — a person
 * choosing "the week of the 19th" should not have to know which day it began.
 */
export function NewBatchForm({ companies, labels }: Props) {
  const [state, action, pending] = useActionState(createBatchAction, INITIAL)

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
      <Input
        name="checkDate"
        type="date"
        label={labels.checkDate}
        className="w-[170px]"
      />
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
