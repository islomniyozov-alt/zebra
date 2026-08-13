'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FmcsaLookup } from '@/components/forms/FmcsaLookup'
import type { FmcsaLabels } from '@/components/forms/fmcsa-labels'
import { lookupCarrierAction } from './actions'
import {
  ADD_COMPANY_INITIAL,
  type AddCompanyState,
  LOOKUP_FIELDS,
  LOOKUP_INITIAL,
  type LookupState,
} from './company-state'

// The minimal authority form (Phase 6 §7 flag 11). Every field on it is one
// the invoice header or the remit-to block already reads — `renderInvoicePdf`
// takes the name, the USDOT and the MC, and `remitToFor` falls back to the
// company's own address when no factor is on file. Nothing here is decoration.
//
// CONTROLLED SINCE THE FMCSA LOOKUP. The fields were uncontrolled, which is
// the right default for a form nothing writes into; a lookup that fills eight
// of them needs somewhere for the values to live. The cost is one state object
// and it buys the "From FMCSA" marks, which are the point: a field somebody
// checked and a field a register filled in should not look identical.
//
// THE LOOKUP IS AN OFFER, NOT A STEP. The form works with the register down,
// with no web key configured, and for a carrier that is not in the register at
// all. Every failure is one sentence that ends by saying so, and nothing on
// this form is disabled while the lookup runs except the lookup button.
//
// ONE FORM FOR CREATE AND EDIT. The fields, the strict two-letter state, the
// duplicate refusals and the register are the same on both; only the action
// and the starting values differ. A second copy for editing is a second copy
// that stops matching — and the register is exactly as useful for correcting a
// mistyped USDOT as it was for entering it.

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

const BLANK: Record<string, string> = {
  name: '',
  legalName: '',
  mcNumber: '',
  dotNumber: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  phone: '',
  email: '',
}

export function AddCompanyForm({
  labels,
  fmcsa,
  action: submitAction,
  initial,
  children,
}: {
  labels: AddCompanyLabels
  fmcsa: FmcsaLabels
  action: (
    previous: AddCompanyState,
    formData: FormData,
  ) => Promise<AddCompanyState>
  /** Absent when creating. Present when editing an existing authority. */
  initial?: Readonly<Record<string, string>>
  /** Deactivate and Remove, rendered under the buttons on the edit screen. */
  children?: React.ReactNode
}) {
  const [state, action, pending] = useActionState(
    submitAction,
    ADD_COMPANY_INITIAL,
  )
  const [values, setValues] = useState({ ...BLANK, ...initial })
  const [lookup, setLookup] = useState<LookupState>(LOOKUP_INITIAL)
  // Which fields the register filled and the person has not touched since.
  const [fromLookup, setFromLookup] = useState<ReadonlySet<string>>(new Set())

  const errorFor = (field: string) =>
    state.field === field ? (state.error ?? undefined) : undefined

  /** Typing in a field is the person taking it back from the register. */
  const set = (field: string) => (value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }))
    setFromLookup((previous) => {
      if (!previous.has(field)) return previous
      const next = new Set(previous)
      next.delete(field)
      return next
    })
  }

  const field = (name: string) => ({
    name,
    value: values[name] ?? '',
    onChange: (event: { target: { value: string } }) =>
      set(name)(event.target.value),
    error: errorFor(name),
    // §1.4's rule, one source over: a field showing something the person did
    // not type says where it came from.
    hint: fromLookup.has(name) ? fmcsa.from : undefined,
  })

  const runLookup = async () => {
    const answer = await lookupCarrierAction({
      dot: values['dotNumber'] ?? '',
      mc: values['mcNumber'] ?? '',
    })
    setLookup(answer)
    if (!answer.found) return

    // FILLED, NOT SAVED. Exactly the posture the extraction prefill takes:
    // the values land in the fields, the person reads them, and the only
    // write on this screen is still the button at the bottom.
    const prefill = answer.found.prefill
    setValues((previous) => ({ ...previous, ...prefill }))
    setFromLookup(new Set(LOOKUP_FIELDS.filter((key) => prefill[key] !== '')))
  }

  return (
    <form action={action} className="flex max-w-[640px] flex-col gap-z3">
      <p className="text-sm text-ink-2">{labels.hint}</p>

      <Input label={labels.name} required {...field('name')} />
      <Input label={labels.legalName} {...field('legalName')} />

      <div className="flex gap-z3">
        <div className="flex-1">
          {/* IDENTIFIERS, so `dir="ltr"` even in Farsi — the design system rule
           * the Phase 5 RTL pass widened from inputs to any Latin value. */}
          <Input label={labels.mcNumber} identifier {...field('mcNumber')} />
        </div>
        <div className="flex-1">
          <Input label={labels.dotNumber} identifier {...field('dotNumber')} />
        </div>
      </div>

      {/* The same control and the same panel the broker form uses. Two screens
       * asking the register one question must not learn to say two things. */}
      <FmcsaLookup
        labels={fmcsa}
        found={lookup.found}
        error={lookup.error}
        onRun={runLookup}
      />

      <Input label={labels.addressLine1} {...field('addressLine1')} />
      <Input label={labels.addressLine2} {...field('addressLine2')} />

      <div className="flex gap-z3">
        <div className="flex-1">
          <Input label={labels.city} {...field('city')} />
        </div>
        <Input
          label={labels.state}
          className="w-[80px]"
          identifier
          {...field('state')}
        />
        <Input
          label={labels.postalCode}
          className="w-[120px]"
          identifier
          {...field('postalCode')}
        />
      </div>

      <div className="flex gap-z3">
        <div className="flex-1">
          <Input label={labels.phone} identifier {...field('phone')} />
        </div>
        <div className="flex-1">
          <Input label={labels.email} type="email" {...field('email')} />
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

      {children}
    </form>
  )
}
