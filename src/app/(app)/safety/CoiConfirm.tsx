'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { fileCoiAction } from './coi-actions'
import { FILE_COI_INITIAL, type FileCoiState } from './coi-state'
import type { coiLabels } from './coi-labels'

// ---------------------------------------------------------------------------
// CONFIRMING A CERTIFICATE BEFORE IT BECOMES COMPLIANCE ROWS.
//
// ── NOTHING IS FILED BY READING ───────────────────────────────────────────
//
// The same rule the medical card's confirm step exists for: a compliance row
// that appeared because a model read a document — with nobody having looked at
// the date — is a record this system cannot vouch for. Insurance is the harder
// case, not the easier one: an expired liability policy is a truck that must
// not roll, and a wrong expiry filed silently is an alarm that never fires.
//
// ── THE COVERAGES ARE A LIST, AS PRINTED, AND NOTHING HERE ASSUMES TWO ───
//
// This panel used to render one liability tick and one cargo tick, because
// the contract behind it had one limit field for each. `acord25-01.pdf`
// carries neither coverage: non-trucking liability and physical damage. So it
// renders WHATEVER ROWS CAME BACK, each with the type cell exactly as the form
// printed it, and the obligation it will file as is a control rather than a
// conclusion.
//
// A ROW'S PRINTED TYPE IS ALWAYS VISIBLE, even when the proposal is confident.
// "Non-Trucking Liability" filed as OTHER is only interpretable next to the
// words the document used, and those words go in the record's note too.
//
// ── THE SUBJECT IS NAMED, WITH THE REASON ────────────────────────────────
//
// A click made without the subject in view is the mistake this flow is
// arranged to prevent, and the subject is now a decision rather than a
// setting: the carrier when the certificate names one of ours, the trucks when
// it names vehicles instead. `subject.because` is the sentence explaining
// which happened, written where the rule is.
// ---------------------------------------------------------------------------

type Confidence = 'high' | 'medium' | 'low'

export interface CoverageView {
  printedType: string | null
  proposedType: string | null
  caution: string | null
  expiresAt: string | null
  effectiveAt: string | null
  identifier: string | null
  issuer: string | null
  limit: string | null
  confidence: Confidence
  refusal: string | null
}

export type VehicleView =
  | {
      kind: 'truck'
      vin: string
      description: string | null
      truck: {
        id: string
        unitNumber: string
        vin: string | null
        companyName: string
      }
      fills: boolean
    }
  | { kind: 'no_truck'; vin: string; description: string | null }
  | {
      kind: 'unreadable'
      printed: string
      description: string | null
      reason: string
    }

export type SubjectView =
  | {
      kind: 'company'
      company: { id: string; name: string }
      because: string
    }
  | { kind: 'trucks'; truckIds: string[]; because: string }
  | { kind: 'ask'; because: string }

export interface CoiProposalView {
  coverages: CoverageView[]
  vehicles: VehicleView[]
  subject: SubjectView
  insuredName: string | null
  carrier: { agrees: boolean; notes: string[] } | null
}

interface Props {
  proposal: CoiProposalView
  labels: ReturnType<typeof coiLabels>
  onCancel: () => void
}

/**
 * The obligations a certificate can file as.
 *
 * FOUR, NOT THE WHOLE ENUM. A certificate evidences insurance; offering
 * registration or a drug test on this panel would be a control that can only
 * ever be used by mistake.
 *
 * THE COMPANY BRANCH GETS TWO OF THEM. `FLEET_COMPLIANCE_TYPES` is what
 * `shapeRecords` will map back to a carrier — a company-level row of any other
 * type is dropped from every screen, so `fileCoi` refuses one and this does not
 * offer it. Physical damage insures particular vehicles anyway; on a carrier's
 * certificate it belongs on the trucks it names.
 */
const FLEET_TYPES = ['INSURANCE_LIABILITY', 'INSURANCE_CARGO'] as const
const ASSET_TYPES = [
  'INSURANCE_LIABILITY',
  'INSURANCE_CARGO',
  'INSURANCE_PHYSICAL_DAMAGE',
  'OTHER',
] as const

export function CoiConfirm({ proposal, labels, onCancel }: Props) {
  const [state, formAction] = useActionState<FileCoiState, FormData>(
    fileCoiAction,
    FILE_COI_INITIAL,
  )

  const atCompany = proposal.subject.kind === 'company'
  const choices = atCompany ? FLEET_TYPES : ASSET_TYPES

  // ── WHAT IS TICKED, AND WHAT EACH ROW WILL FILE AS ────────────────────
  //
  // Defaulted from the read: a row with no usable expiry cannot be filed at
  // all, and a row whose obligation this system will not guess starts UNSET
  // and unticked — a coverage nobody has classified must not file itself.
  const [chosen, setChosen] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      proposal.coverages.map((row, index) => [
        index,
        row.proposedType &&
        (choices as readonly string[]).includes(row.proposedType)
          ? row.proposedType
          : '',
      ]),
    ),
  )
  const [ticked, setTicked] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(
      proposal.coverages.map((row, index) => [
        index,
        Boolean(
          row.expiresAt &&
            row.proposedType &&
            (choices as readonly string[]).includes(row.proposedType),
        ),
      ]),
    ),
  )

  if (state.filedRecordIds.length > 0 && !state.error) {
    return (
      <div className="flex flex-col gap-z2">
        <p
          role="status"
          className="rounded-card border border-ok bg-ok-soft px-z3 py-z2 text-sm text-ok"
        >
          {labels.filed.replace('{count}', String(state.filedRecordIds.length))}
        </p>
        {state.vinsFilled.length > 0 ? (
          <p className="text-sm text-ink-2">
            {labels.vinsWritten.replace(
              '{count}',
              String(state.vinsFilled.length),
            )}
          </p>
        ) : null}
      </div>
    )
  }

  const none = <span className="text-ink-3">{labels.none}</span>
  const fileable = proposal.coverages.some(
    (row, i) => ticked[i] && row.expiresAt,
  )

  return (
    <form action={formAction} className="flex flex-col gap-z3">
      {proposal.subject.kind === 'company' ? (
        <input
          type="hidden"
          name="companyId"
          value={proposal.subject.company.id}
        />
      ) : null}
      {proposal.subject.kind === 'trucks'
        ? proposal.subject.truckIds.map((id) => (
            <input key={id} type="hidden" name="truckId" value={id} />
          ))
        : null}

      {/* ── WHO THIS IS FILED AGAINST, AND WHY ───────────────────────── */}
      <div className="rounded-card border border-border bg-surface px-z3 py-z3">
        <p className="mb-z2 text-xs uppercase tracking-wide text-ink-3">
          {labels.heading}
        </p>
        <dl className="mb-z3 grid grid-cols-[auto_1fr] gap-x-z4 gap-y-z2 text-sm">
          <dt className="text-ink-3">{labels.insured}</dt>
          <dd className="text-ink">{proposal.insuredName ?? none}</dd>
          <dt className="text-ink-3">{labels.filesAgainst}</dt>
          <dd className="font-medium text-ink">
            {proposal.subject.kind === 'company'
              ? proposal.subject.company.name
              : proposal.subject.kind === 'trucks'
                ? proposal.vehicles
                    .filter((row) => row.kind === 'truck')
                    .map((row) => row.truck.unitNumber)
                    .join(', ')
                : labels.nobody}
          </dd>
        </dl>
        <p className="text-sm text-ink-2">{proposal.subject.because}</p>

        {/* THE CROSS-CHECK, WHERE A PERSON CAN SEE IT. Warning tone rather
         * than danger: a legal-entity suffix or a missing MC is not an error,
         * and this must not read as a refusal. It reads as "look at this
         * before you click". It is absent entirely on the per-truck branch,
         * where a different insured is the expected case. */}
        {proposal.carrier && !proposal.carrier.agrees ? (
          <div className="mt-z3 rounded-card border border-warning bg-warning-soft px-z3 py-z2">
            {proposal.carrier.notes.map((note) => (
              <p key={note} className="text-sm text-warning">
                {note}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── THE COVERAGES, AS PRINTED ─────────────────────────────────── */}
      <fieldset className="flex flex-col gap-z3 rounded-card border border-border bg-surface px-z3 py-z3">
        <legend className="px-z2 text-xs uppercase tracking-wide text-ink-3">
          {labels.coverages}
        </legend>

        {proposal.coverages.map((row, index) => {
          const filable = row.expiresAt !== null
          return (
            <div
              key={index}
              className="flex flex-col gap-z2 border-t border-border pt-z3 first:border-t-0 first:pt-0"
            >
              <label className="flex items-start gap-z2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="coverage"
                  value={String(index)}
                  checked={Boolean(ticked[index]) && filable}
                  disabled={!filable}
                  onChange={(event) =>
                    setTicked((was) => ({
                      ...was,
                      [index]: event.target.checked,
                    }))
                  }
                  className="mt-1"
                />
                <span className="flex flex-col gap-z1">
                  {/* THE DOCUMENT'S OWN WORDS, FIRST AND ALWAYS. */}
                  <span className="font-medium">
                    {row.printedType ?? labels.unnamedCoverage}
                  </span>
                  <span className="text-xs text-ink-3">
                    {labels.confidence.replace(
                      '{level}',
                      labels.confidenceNames[row.confidence] ?? row.confidence,
                    )}
                  </span>
                </span>
              </label>

              {row.caution ? (
                <p className="rounded-card border border-warning bg-warning-soft px-z3 py-z2 text-sm text-warning">
                  {row.caution}
                </p>
              ) : null}

              {!filable ? (
                <p className="rounded-card border border-border-strong px-z3 py-z2 text-sm text-ink-2">
                  {labels.rowRefusals[row.refusal ?? ''] ?? labels.cannotFile}
                </p>
              ) : null}

              <div className="grid grid-cols-[auto_1fr] gap-x-z4 gap-y-z2 text-sm">
                <span className="text-ink-3">{labels.filesAs}</span>
                <span>
                  <select
                    value={chosen[index] ?? ''}
                    disabled={!filable}
                    onChange={(event) =>
                      setChosen((was) => ({
                        ...was,
                        [index]: event.target.value,
                      }))
                    }
                    className="rounded-card border border-border-strong bg-surface px-z2 py-z1 text-sm text-ink"
                  >
                    <option value="">{labels.pickType}</option>
                    {choices.map((type) => (
                      <option key={type} value={type}>
                        {labels.typeNames[type] ?? type}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="text-ink-3">{labels.policyNumber}</span>
                <span className="text-ink">{row.identifier ?? none}</span>
                <span className="text-ink-3">{labels.insurer}</span>
                <span className="text-ink">{row.issuer ?? none}</span>
                <span className="text-ink-3">{labels.effectiveAt}</span>
                <span className="text-ink">{row.effectiveAt ?? none}</span>
                <span className="text-ink-3">{labels.expiresAt}</span>
                <span className="font-medium text-ink">
                  {row.expiresAt ?? none}
                </span>
                <span className="text-ink-3">{labels.limit}</span>
                <span className="text-ink">{row.limit ?? none}</span>
              </div>

              <input
                type="hidden"
                name={`type.${index}`}
                value={chosen[index] ?? ''}
              />
              <input
                type="hidden"
                name={`expiresAt.${index}`}
                value={row.expiresAt ?? ''}
              />
              <input
                type="hidden"
                name={`effectiveAt.${index}`}
                value={row.effectiveAt ?? ''}
              />
              <input
                type="hidden"
                name={`identifier.${index}`}
                value={row.identifier ?? ''}
              />
              <input
                type="hidden"
                name={`issuer.${index}`}
                value={row.issuer ?? ''}
              />
              <input
                type="hidden"
                name={`printedType.${index}`}
                value={row.printedType ?? ''}
              />
              <input
                type="hidden"
                name={`limit.${index}`}
                value={row.limit ?? ''}
              />
            </div>
          )
        })}
      </fieldset>

      {/* ── THE VEHICLES, AND WHAT FILING WOULD DO TO THEM ────────────── */}
      {proposal.vehicles.length > 0 ? (
        <div className="flex flex-col gap-z2 rounded-card border border-border bg-surface px-z3 py-z3">
          <p className="text-xs uppercase tracking-wide text-ink-3">
            {labels.vehicles}
          </p>
          {proposal.vehicles.map((row, index) => (
            <div key={index} className="text-sm">
              <p className="font-mono text-ink">
                {row.kind === 'unreadable' ? row.printed : row.vin}
              </p>
              {row.description ? (
                <p className="text-ink-2">{row.description}</p>
              ) : null}
              <p className="text-ink-3">
                {row.kind === 'truck'
                  ? row.fills
                    ? labels.vinFills.replace('{unit}', row.truck.unitNumber)
                    : labels.vinAlready
                        .replace('{unit}', row.truck.unitNumber)
                        .replace('{carrier}', row.truck.companyName)
                  : row.kind === 'no_truck'
                    ? labels.vinNoTruck
                    : labels.vinUnreadable.replace(
                        '{reason}',
                        labels.vinReasons[row.reason] ?? row.reason,
                      )}
              </p>
              {/* ADD-MISSING, AND ONLY WHERE THERE IS A NULL TO FILL. The pair
               * travels as `truckId:VIN`; `fileCoi` re-reads the truck and
               * writes only into a null, so a VIN that arrived in between is
               * never overwritten. */}
              {row.kind === 'truck' && row.fills ? (
                <input
                  type="hidden"
                  name="vinFill"
                  value={`${row.truck.id}:${row.vin}`}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

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
          disabled={!fileable || proposal.subject.kind === 'ask'}
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
