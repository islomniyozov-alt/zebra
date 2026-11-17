'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { recordRenewalAction } from './compliance-actions'
import { COMPLIANCE_INITIAL, type ComplianceState } from './compliance-state'

// ---------------------------------------------------------------------------
// RECORD, ON A DATED DQF ROW (§6.4 part 2 v11.30).
//
// The MVR, the annual review, the medical certificate and the clearinghouse
// query are compliance records. The row records one of ITS type through the
// compliance panel's own action and writer (`recordRenewalAction` →
// `recordRenewal`), so a record made here is indistinguishable from one made
// in the panel below — the type travels as a hidden field the row states.
//
// Closed until asked: nine open forms is a page nobody reads.
// ---------------------------------------------------------------------------

export function DqfRecordForm({
  driverId,
  complianceType,
  defaultExpires,
  translate,
  labels,
}: {
  driverId: string
  complianceType: string
  /** yyyy-mm-dd — a year out for an annual row. */
  defaultExpires: string
  translate: Record<string, string>
  labels: {
    record: string
    expires: string
    done: string
    save: string
    cancel: string
  }
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<
    ComplianceState,
    FormData
  >(recordRenewalAction.bind(null, 'driver', driverId), COMPLIANCE_INITIAL)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-accent hover:underline"
      >
        {labels.record}
      </button>
    )
  }

  return (
    <form
      action={formAction}
      className="flex w-full flex-wrap items-end gap-z2 pt-z2"
    >
      <input type="hidden" name="type" value={complianceType} />
      <div className="w-[150px]">
        <Input
          name="expiresAt"
          label={labels.expires}
          defaultValue={defaultExpires}
          required
          inputMode="numeric"
        />
      </div>
      <div className="w-[150px]">
        <Input name="issuedAt" label={labels.done} inputMode="numeric" />
      </div>
      <Button
        type="submit"
        variant="secondary"
        size="compact"
        disabled={pending}
      >
        {labels.save}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="compact"
        onClick={() => setOpen(false)}
      >
        {labels.cancel}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {translate[state.error] ?? state.error}
        </span>
      ) : null}
    </form>
  )
}
