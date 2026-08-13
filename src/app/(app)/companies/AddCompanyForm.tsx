'use client'

import { useActionState, useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { addCompanyAction, lookupCarrierAction } from './actions'
import {
  ADD_COMPANY_INITIAL,
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
  lookup: string
  lookupHint: string
  lookupPending: string
  lookupFilled: string
  fromFmcsa: string
  fmcsaTitle: string
  fmcsaEntity: string
  fmcsaOperation: string
  fmcsaStatus: string
  fmcsaRating: string
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

export function AddCompanyForm({ labels }: { labels: AddCompanyLabels }) {
  const [state, action, pending] = useActionState(
    addCompanyAction,
    ADD_COMPANY_INITIAL,
  )
  const [values, setValues] = useState(BLANK)
  const [lookup, setLookup] = useState<LookupState>(LOOKUP_INITIAL)
  const [looking, startLookup] = useTransition()
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
    hint: fromLookup.has(name) ? labels.fromFmcsa : undefined,
  })

  const runLookup = () => {
    startLookup(async () => {
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
    })
  }

  const found = lookup.found

  return (
    <form action={action} className="flex max-w-[640px] flex-col gap-z3">
      <p className="text-sm text-ink-2">{labels.hint}</p>

      <Input label={labels.name} required {...field('name')} />
      <Input label={labels.legalName} {...field('legalName')} />

      <div className="flex items-end gap-z3">
        <div className="flex-1">
          {/* IDENTIFIERS, so `dir="ltr"` even in Farsi — the design system rule
           * the Phase 5 RTL pass widened from inputs to any Latin value. */}
          <Input label={labels.mcNumber} identifier {...field('mcNumber')} />
        </div>
        <div className="flex-1">
          <Input label={labels.dotNumber} identifier {...field('dotNumber')} />
        </div>
        {/* NOT `type="submit"`. The one submit on this form is Add authority,
         * and a lookup that submitted would be the save button wearing a
         * different word. */}
        <Button
          type="button"
          variant="secondary"
          onClick={runLookup}
          disabled={looking}
        >
          {looking ? labels.lookupPending : labels.lookup}
        </Button>
      </div>

      <p className="text-xs text-ink-3">{labels.lookupHint}</p>

      {lookup.error ? (
        <p role="status" className="text-sm text-warning">
          {lookup.error}
        </p>
      ) : null}

      {found ? (
        <section
          role="status"
          className="flex flex-col gap-z2 rounded-card border border-border bg-surface-2 p-z3"
        >
          <h2 className="text-sm font-medium text-ink">{labels.fmcsaTitle}</h2>

          {/* SHOWN, NOT STORED. `Company` has no column for entity type,
           * operation or safety rating, and inventing three would be a
           * migration to hold what the register can be asked again. */}
          <dl className="flex flex-wrap gap-x-z4 gap-y-z1 text-sm">
            {(
              [
                [labels.fmcsaStatus, found.status],
                [labels.fmcsaEntity, found.entityType],
                [labels.fmcsaOperation, found.operation],
                [labels.fmcsaRating, found.safetyRating],
              ] as const
            )
              .filter(([, value]) => value)
              .map(([term, value]) => (
                <div key={term} className="flex gap-z1">
                  <dt className="text-ink-3">{term}</dt>
                  <dd className="text-ink">{value}</dd>
                </div>
              ))}
          </dl>

          {/* IN WORDS, EACH ITS OWN SENTENCE — the load warnings' posture. A
           * badge has to be interpreted; a sentence can be acted on. */}
          {found.concerns.length > 0 ? (
            <ul className="flex flex-col gap-z1">
              {found.concerns.map((concern) => (
                <li key={concern} className="text-sm font-medium text-danger">
                  {concern}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs text-ink-3">{labels.lookupFilled}</p>
        </section>
      ) : null}

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
    </form>
  )
}
