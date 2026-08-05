'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { saveFactorAction } from '../actions'
import { FACTORING_INITIAL, type FactoringState } from '../factoring-state'

// One form for both add and edit. Which one it is comes from the presence of a
// factor, and the id rides along in a hidden field — so the URL, not component
// state, decides what is being edited and a refresh does not lose it.

export interface FactorDraft {
  id: string
  companyId: string | null
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  /** Already rendered as a percentage string by the server. */
  advanceRate: string
  feeRate: string
  notes: string | null
}

interface Props {
  factor: FactorDraft | null
  companies: readonly SelectOption[]
  translate: Record<string, string>
  labels: {
    heading: string
    name: string
    authority: string
    contact: string
    phone: string
    email: string
    advanceRate: string
    feeRate: string
    percentHint: string
    notes: string
    save: string
    cancel: string
    saved: string
  }
}

export function FactorForm({ factor, companies, translate, labels }: Props) {
  const [state, act, pending] = useActionState<FactoringState, FormData>(
    saveFactorAction,
    FACTORING_INITIAL,
  )

  return (
    <form
      action={act}
      // `key` on the form, not on a field: switching which factor is being
      // edited must reset every uncontrolled input at once, and React reuses
      // the DOM node otherwise.
      key={factor?.id ?? 'new'}
      className="flex flex-col gap-z3 rounded-card border border-border bg-surface p-z4"
    >
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>

      {factor ? <input type="hidden" name="id" value={factor.id} /> : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-z3">
        <Input
          name="name"
          label={labels.name}
          required
          defaultValue={factor?.name ?? ''}
        />
        <Select
          name="companyId"
          label={labels.authority}
          required
          options={companies}
          defaultValue={factor?.companyId ?? ''}
        />
        <Input
          name="advanceRate"
          label={labels.advanceRate}
          hint={labels.percentHint}
          required
          inputMode="decimal"
          defaultValue={factor?.advanceRate ?? ''}
        />
        <Input
          name="feeRate"
          label={labels.feeRate}
          hint={labels.percentHint}
          required
          inputMode="decimal"
          defaultValue={factor?.feeRate ?? ''}
        />
        <Input
          name="contactName"
          label={labels.contact}
          defaultValue={factor?.contactName ?? ''}
        />
        <Input
          name="phone"
          label={labels.phone}
          defaultValue={factor?.phone ?? ''}
        />
        <Input
          name="email"
          label={labels.email}
          type="email"
          defaultValue={factor?.email ?? ''}
        />
        <Input
          name="notes"
          label={labels.notes}
          defaultValue={factor?.notes ?? ''}
        />
      </div>

      <div className="flex items-center gap-z3">
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </Button>
        {factor ? (
          <Link
            href="/receivables/factoring"
            className="text-sm text-ink-2 hover:text-ink"
          >
            {labels.cancel}
          </Link>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {translate[state.error] ?? state.error}
          </p>
        ) : null}
        {state.savedId && !state.error ? (
          <p role="status" className="text-sm text-success">
            {labels.saved}
          </p>
        ) : null}
      </div>
    </form>
  )
}
