'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { addCompanyAction } from './actions'
import { ADD_COMPANY_INITIAL } from './company-state'

// The minimal authority form (Phase 6 §7 flag 11). Every field on it is one
// the invoice header or the remit-to block already reads — `renderInvoicePdf`
// takes the name, the USDOT and the MC, and `remitToFor` falls back to the
// company's own address when no factor is on file. Nothing here is decoration.

export interface AddCompanyLabels {
  name: string
  legalName: string
  mcNumber: string
  dotNumber: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  phone: string
  email: string
  save: string
  cancel: string
  hint: string
}

export function AddCompanyForm({ labels }: { labels: AddCompanyLabels }) {
  const [state, action, pending] = useActionState(
    addCompanyAction,
    ADD_COMPANY_INITIAL,
  )

  const errorFor = (field: string) =>
    state.field === field ? (state.error ?? undefined) : undefined

  return (
    <form action={action} className="flex max-w-[640px] flex-col gap-z3">
      <p className="text-sm text-ink-2">{labels.hint}</p>

      <Input
        name="name"
        label={labels.name}
        required
        error={errorFor('name')}
      />
      <Input name="legalName" label={labels.legalName} />

      <div className="flex gap-z3">
        <div className="flex-1">
          {/* IDENTIFIERS, so `dir="ltr"` even in Farsi — the design system rule
           * the Phase 5 RTL pass widened from inputs to any Latin value. */}
          <Input name="mcNumber" label={labels.mcNumber} identifier />
        </div>
        <div className="flex-1">
          <Input name="dotNumber" label={labels.dotNumber} identifier />
        </div>
      </div>

      <Input name="addressLine1" label={labels.addressLine1} />
      <Input name="addressLine2" label={labels.addressLine2} />

      <div className="flex gap-z3">
        <div className="flex-1">
          <Input name="city" label={labels.city} />
        </div>
        <Input
          name="state"
          label={labels.state}
          className="w-[80px]"
          identifier
          error={errorFor('state')}
        />
        <Input
          name="postalCode"
          label={labels.postalCode}
          className="w-[120px]"
          identifier
        />
      </div>

      <div className="flex gap-z3">
        <div className="flex-1">
          <Input name="phone" label={labels.phone} identifier />
        </div>
        <div className="flex-1">
          <Input name="email" label={labels.email} type="email" />
        </div>
      </div>

      {/* The limit refusal has no field to hang off — it is about the plan, not
       * about anything on this form. */}
      {state.error && !state.field ? (
        <p role="alert" className="text-base text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-z2">
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </Button>
        <Link
          href="/companies"
          className="inline-flex h-control items-center rounded-control px-z3 text-base font-medium text-ink-2 hover:bg-surface-3"
        >
          {labels.cancel}
        </Link>
      </div>
    </form>
  )
}
