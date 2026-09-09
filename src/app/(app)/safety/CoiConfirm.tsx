'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { fileCoiAction } from './coi-actions'
import { FILE_COI_INITIAL, type FileCoiState } from './coi-state'

// ---------------------------------------------------------------------------
// CONFIRMING A CERTIFICATE OF INSURANCE BEFORE IT BECOMES COMPLIANCE ROWS.
//
// ── NOTHING IS FILED BY READING ───────────────────────────────────────────
//
// The same rule the medical card's confirm step exists for: a compliance row
// that appeared because a model read a photograph — with nobody having looked
// at the date — is a record this system cannot vouch for. Insurance is the
// harder case, not the easier one: an expired liability policy is a truck that
// must not roll, and a wrong expiry filed silently is an alarm that never
// fires.
//
// ── THE CARRIER CHECK IS SHOWN, NEVER ACTED ON ───────────────────────────
//
// Brokers send certificates constantly, including other carriers'. But an
// insurer writes `RAM HAULAGE LLC` where this system holds `RAM Haulage`, so a
// strict match would reject correct certificates daily. The sentences from
// `checkCarrier` are rendered here and a person decides — a warning beside the
// values, not a wall in front of them.
//
// ── TWO COVERAGES, TICKED SEPARATELY ─────────────────────────────────────
//
// One certificate usually evidences liability AND cargo, and a carrier can
// hold one without the other. Each is its own row and its own tick, defaulted
// from what the document actually carries — an absent cargo line leaves the
// box clear rather than filing a coverage nobody has.
// ---------------------------------------------------------------------------

interface Coverage {
  type: 'INSURANCE_LIABILITY' | 'INSURANCE_CARGO'
  expiresAt: string
  identifier: string | null
  issuer: string | null
  limit: string | null
}

export interface CoiProposalView {
  coverages: Coverage[]
  expiresAt: string
  effectiveAt: string | null
  carrier: { agrees: boolean; notes: string[] }
}

interface Props {
  proposal: CoiProposalView
  company: { id: string; name: string }
  labels: {
    heading: string
    forCompany: string
    policyNumber: string
    insurer: string
    effectiveAt: string
    expiresAt: string
    liability: string
    cargo: string
    limit: string
    none: string
    file: string
    filing: string
    filed: string
    cancel: string
  }
  onCancel: () => void
}

export function CoiConfirm({ proposal, company, labels, onCancel }: Props) {
  const [state, formAction] = useActionState<FileCoiState, FormData>(
    fileCoiAction,
    FILE_COI_INITIAL,
  )

  const liability = proposal.coverages.find(
    (row) => row.type === 'INSURANCE_LIABILITY',
  )
  const cargo = proposal.coverages.find((row) => row.type === 'INSURANCE_CARGO')

  const [wantLiability, setWantLiability] = useState(Boolean(liability))
  const [wantCargo, setWantCargo] = useState(Boolean(cargo))

  if (state.filedRecordIds.length > 0) {
    return (
      <p
        role="status"
        className="rounded-card border border-ok bg-ok-soft px-z3 py-z2 text-sm text-ok"
      >
        {labels.filed}
      </p>
    )
  }

  const value = (text: string | null) =>
    text ? text : <span className="text-ink-3">{labels.none}</span>

  return (
    <form action={formAction} className="flex flex-col gap-z3">
      <input type="hidden" name="companyId" value={company.id} />
      <input type="hidden" name="expiresAt" value={proposal.expiresAt} />
      {proposal.effectiveAt ? (
        <input type="hidden" name="effectiveAt" value={proposal.effectiveAt} />
      ) : null}
      <input
        type="hidden"
        name="policyNumber"
        value={liability?.identifier ?? ''}
      />
      <input type="hidden" name="insurer" value={liability?.issuer ?? ''} />
      <input
        type="hidden"
        name="liabilityLimit"
        value={liability?.limit ?? ''}
      />
      <input type="hidden" name="cargoLimit" value={cargo?.limit ?? ''} />

      <div className="rounded-card border border-border bg-surface px-z3 py-z3">
        <p className="mb-z2 text-xs uppercase tracking-wide text-ink-3">
          {labels.heading}
        </p>

        {/* WHO IT WILL BE FILED AGAINST, named on the confirm step itself —
         * a click made without the subject in view is the mistake this flow
         * is arranged to prevent. */}
        <p className="mb-z3 text-sm text-ink">
          {labels.forCompany.replace('{company}', company.name)}
        </p>

        {/* ── THE CROSS-CHECK, WHERE A PERSON CAN SEE IT ─────────────────
         *
         * Warning tone rather than danger: a legal-entity suffix or a missing
         * MC is not an error, and this must not read as a refusal. It reads
         * as "look at this before you click". */}
        {!proposal.carrier.agrees ? (
          <div className="mb-z3 rounded-card border border-warning bg-warning-soft px-z3 py-z2">
            {proposal.carrier.notes.map((note) => (
              <p key={note} className="text-sm text-warning">
                {note}
              </p>
            ))}
          </div>
        ) : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-z4 gap-y-z2 text-sm">
          <dt className="text-ink-3">{labels.policyNumber}</dt>
          <dd className="text-ink">{value(liability?.identifier ?? null)}</dd>
          <dt className="text-ink-3">{labels.insurer}</dt>
          <dd className="text-ink">{value(liability?.issuer ?? null)}</dd>
          <dt className="text-ink-3">{labels.effectiveAt}</dt>
          <dd className="text-ink">{value(proposal.effectiveAt)}</dd>
          <dt className="text-ink-3">{labels.expiresAt}</dt>
          <dd className="font-medium text-ink">{proposal.expiresAt}</dd>
        </dl>
      </div>

      <fieldset className="flex flex-col gap-z2 rounded-card border border-border bg-surface px-z3 py-z3">
        <label className="flex items-center gap-z2 text-sm text-ink">
          <input
            type="checkbox"
            name="liability"
            checked={wantLiability}
            onChange={(event) => setWantLiability(event.target.checked)}
          />
          <span>
            {labels.liability}
            {liability?.limit ? (
              <span className="text-ink-2">
                {' '}
                — {labels.limit} {liability.limit}
              </span>
            ) : null}
          </span>
        </label>
        <label className="flex items-center gap-z2 text-sm text-ink">
          <input
            type="checkbox"
            name="cargo"
            checked={wantCargo}
            onChange={(event) => setWantCargo(event.target.checked)}
            // NO CARGO LINE MEANS NO CARGO COVERAGE, which is a fact rather
            // than an omission. The box is offered but unticked, so filing one
            // is a deliberate act.
          />
          <span>
            {labels.cargo}
            {cargo?.limit ? (
              <span className="text-ink-2">
                {' '}
                — {labels.limit} {cargo.limit}
              </span>
            ) : null}
          </span>
        </label>
      </fieldset>

      {state.error ? (
        <p
          role="alert"
          className="rounded-card border border-danger bg-danger-soft px-z3 py-z2 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-z3">
        <Button
          type="submit"
          variant="primary"
          size="compact"
          disabled={!wantLiability && !wantCargo}
        >
          {labels.file}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-accent"
        >
          {labels.cancel}
        </button>
      </div>
    </form>
  )
}
