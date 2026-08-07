'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { openClaimAction } from './claim-actions'
import { CLAIM_INITIAL, type ClaimState } from './claim-state'

// PHASE 4 §5 STEP 5 — opening a claim.
//
// The event first: what happened, against which authority, and how much they
// want. Parties, notes and documents go on afterwards, on the claim itself —
// the same shape as an inspection, and for the same reason: a repeating
// sub-form would let somebody type four parties and lose all four to one bad
// amount.
//
// THE LOAD IS OPTIONAL and the hint says why. An accident on a bobtail has no
// load, and a form that demanded one would make the most serious claim type
// the hardest to record.

interface Props {
  authorities: readonly SelectOption[]
  types: readonly SelectOption[]
  loads: readonly SelectOption[]
  trucks: readonly SelectOption[]
  drivers: readonly SelectOption[]
  today: string
  translate: Record<string, string>
  labels: {
    hint: string
    authority: string
    type: string
    incident: string
    incidentHint: string
    load: string
    loadHint: string
    truck: string
    driver: string
    assetHint: string
    claimant: string
    number: string
    amount: string
    description: string
    save: string
    cancel: string
  }
}

export function ClaimForm({
  authorities,
  types,
  loads,
  trucks,
  drivers,
  today,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<ClaimState, FormData>(
    openClaimAction,
    CLAIM_INITIAL,
  )

  return (
    <form action={act} className="flex max-w-[900px] flex-col gap-z4">
      <p className="max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
        <Select
          name="companyId"
          label={labels.authority}
          required
          options={authorities}
        />
        <Select name="type" label={labels.type} required options={types} />
        <Input
          name="incidentAt"
          label={labels.incident}
          hint={labels.incidentHint}
          defaultValue={today}
          inputMode="numeric"
        />
        {/* `Select` carries no hint slot, so the sentences explaining why
         * these three are optional sit under the grid. */}
        <Select name="loadId" label={labels.load} options={loads} />
        {/* §6 flag 15, resolved at Step 6: an accident names a tractor and a
         * person, and until now the schema reached them only through a load a
         * bobtail accident does not have. */}
        <Select name="truckId" label={labels.truck} options={trucks} />
        <Select name="driverId" label={labels.driver} options={drivers} />
        <Input name="claimantName" label={labels.claimant} />
        <Input name="claimNumber" label={labels.number} identifier />
        <Input name="amountClaimed" label={labels.amount} inputMode="decimal" />
      </div>

      <p className="text-sm text-ink-3">{labels.loadHint}</p>
      <p className="text-sm text-ink-3">{labels.assetHint}</p>

      <Input name="description" label={labels.description} required />

      <div className="flex items-center gap-z3">
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </Button>
        <Link
          href="/safety/claims"
          className="text-sm text-ink-2 hover:text-accent"
        >
          {labels.cancel}
        </Link>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {translate[state.error] ?? state.error}
          </p>
        ) : null}
      </div>
    </form>
  )
}
