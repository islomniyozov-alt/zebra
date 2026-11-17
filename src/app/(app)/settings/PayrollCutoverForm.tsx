'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { savePayrollCutoverAction } from './actions'
import { CUTOVER_INITIAL } from './cutover-state'

interface Props {
  /** The stored date, `YYYY-MM-DD`, or '' when the default applies. */
  value: string
  mayEdit: boolean
  labels: {
    section: string
    cutover: string
    hint: string
    save: string
    saved: string
    readOnly: string
  }
}

/**
 * The organization's payroll cutover — the carry-over floor (MONEY-DESIGN §6,
 * owner's ruling 2026-11-17). One field for the organization, above the
 * per-authority forms: the floor is the organization's, and its default is
 * each authority's first Zebra batch, which the hint says.
 */
export function PayrollCutoverForm({ value, mayEdit, labels }: Props) {
  const [state, save, pending] = useActionState(
    savePayrollCutoverAction,
    CUTOVER_INITIAL,
  )
  return (
    <form action={save} className="flex flex-col gap-z3">
      <h2 className="text-md font-medium text-ink">{labels.section}</h2>
      <div className="max-w-[280px]">
        <Input
          label={labels.cutover}
          name="cutover"
          type="date"
          defaultValue={value}
          hint={labels.hint}
          error={state.error ?? undefined}
          disabled={!mayEdit}
        />
      </div>
      {mayEdit ? (
        <div className="flex items-center gap-z3">
          <Button
            type="submit"
            variant="primary"
            size="compact"
            disabled={pending}
          >
            {labels.save}
          </Button>
          {state.saved ? (
            <span className="text-xs text-success">{labels.saved}</span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-ink-3">{labels.readOnly}</p>
      )}
    </form>
  )
}
