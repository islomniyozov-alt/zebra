'use client'

import { useActionState, useState } from 'react'
import { DropZone } from '@/components/forms/DropZone'
import { cx } from '@/lib/cx'
import { fileMedicalCertAction } from './med-actions'
import {
  FILE_MEDICAL_CERT_INITIAL,
  type FileMedicalCertState,
} from './med-state'

// ---------------------------------------------------------------------------
// DROP A MEDICAL CERTIFICATE ON THE DRIVER IT BELONGS TO.
//
// ── IT LIVES ON SAFETY, WHICH IS WHERE THE WORK HAPPENS ───────────────────
//
// It was on the driver's page first, and the owner moved it: "driver sector is
// only for adding driver, medical card is safety." Dispatch works from the
// expiry queue — they see a card lapsing and upload the replacement on the row
// that told them about it, rather than navigating to a person to do it.
//
// THE SUBJECT IS STILL STATED, WHICH IS THE PART THAT MATTERED. A compliance
// row already names its driver and its document type, so opening the upload
// from a row states whose certificate this is exactly as the driver's page
// did. The id travels as a search param and is RE-RESOLVED server-side against
// the tenant scope — see the page — so it is a claim the server checks rather
// than one the browser makes.
//
// AND FOR A DRIVER WITH NO ROW YET, IT ASKS. There is nothing to state, so the
// screen offers a driver to pick instead of inferring one. Reading the name
// off the certificate and matching it would be the failure this contract
// exists to prevent — see `checkDriverName`.
//
// ── READ, THEN CONFIRM. NEVER READ AND FILE. ──────────────────────────────
//
// The row it writes decides whether somebody may legally drive, so the confirm
// step is not a formality. It shows what will be filed, in the words the card
// used and the date this system read them as, and nothing is written until
// somebody clicks. If the printed name disagrees with the driver, that is
// SHOWN and the click is still the person's to make: the card may be right and
// the row wrong, and deciding which is not this screen's job.
//
// THE ZONE IS THE CDL's ZONE. `components/forms/DropZone` — one control, one
// paste handler, one accept list.
// ---------------------------------------------------------------------------

interface Proposal {
  expiresAt: string
  expiresAtPrinted: string
  expiresAtConfidence: 'high' | 'medium' | 'low'
  issuedAt: string | null
  issuedAtPrinted: string | null
  examinerName: string | null
  examinerRegistryNumber: string | null
  nameDisagreement: { printed: string; expected: string } | null
  printedName: string | null
}

interface Candidate {
  id: string
  firstName: string
  lastName: string
}

type Match =
  | { kind: 'one'; driver: Candidate }
  | { kind: 'none' }
  | { kind: 'many'; drivers: Candidate[] }

interface Props {
  /** Set when a compliance row stated its subject; empty at the front door. */
  driverId?: string
  driverLabel?: string
  /** The picker's options, for when the printed name matches none or many. */
  roster?: readonly Candidate[]
  /** Front-door sizing. See DropZone's note on why this is a real difference. */
  prominent?: boolean
  labels: {
    dropTitle: string
    dropBody: string
    dropHint: string
    reading: string
    heading: string
    expires: string
    issued: string
    examiner: string
    registry: string
    asPrinted: string
    nameWarning: string
    file: string
    discard: string
    filed: string
    none: string
    forDriver: string
    subjectStated: string
    subjectProposed: string
    notThem: string
    askNone: string
    askMany: string
    askBody: string
    notices: Record<string, string>
  }
}

export function MedicalCertUpload({
  driverId = '',
  driverLabel = '',
  roster = [],
  prominent = false,
  labels,
}: Props) {
  const [reading, setReading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  // WHO IT WILL BE FILED AGAINST — proposed by the read, or picked below.
  // Held beside the proposal so choosing a driver after a "none" costs no
  // second upload: the values are already in hand.
  const [match, setMatch] = useState<Match | null>(null)
  const [chosen, setChosen] = useState<Candidate | null>(null)
  const [state, formAction] = useActionState<FileMedicalCertState, FormData>(
    fileMedicalCertAction,
    FILE_MEDICAL_CERT_INITIAL,
  )

  const take = async (file: File) => {
    setReading(true)
    setNotice(null)
    setProposal(null)
    try {
      const body = new FormData()
      body.append('file', file)
      // THE DRIVER TRAVELS WITH THE FILE. The route resolves it through the
      // tenant scope rather than trusting it — an id from a browser is a
      // claim, not a permission.
      body.append('driverId', driverId)

      const response = await fetch('/api/med/read', { method: 'POST', body })
      if (!response.ok) {
        // The handler's refusals shown as themselves. A dispatcher told
        // "something went wrong" photographs the card again for no reason.
        setNotice(
          response.status === 413
            ? 'drivers.med.tooLarge'
            : response.status === 415
              ? 'drivers.med.wrongType'
              : response.status === 403
                ? 'drivers.med.notAllowed'
                : 'drivers.med.failed',
        )
        return
      }
      const result = (await response.json()) as {
        proposal: Proposal | null
        match?: Match
        notice: string | null
      }
      if (result.proposal) {
        setProposal(result.proposal)
        const found = result.match ?? { kind: 'none' as const }
        setMatch(found)
        // ONE MATCH IS A PROPOSAL, NOT A DECISION: it pre-selects and a person
        // still confirms. None and several leave nobody chosen, and the picker
        // asks — with these values already read.
        setChosen(found.kind === 'one' ? found.driver : null)
      } else setNotice(result.notice ?? 'drivers.med.unreadable')
    } catch {
      setNotice('drivers.med.failed')
    } finally {
      setReading(false)
    }
  }

  if (state.filedRecordId) {
    return (
      <p
        role="status"
        className="rounded-card border border-ok bg-ok-soft px-z3 py-z2 text-sm text-ok"
      >
        {labels.filed}
      </p>
    )
  }

  if (proposal) {
    const value = (text: string | null) =>
      text ? text : <span className="text-ink-3">{labels.none}</span>

    return (
      <form action={formAction} className="flex flex-col gap-z3">
        <div className="rounded-card border border-border bg-surface px-z3 py-z3">
          <p className="mb-z2 text-xs uppercase tracking-wide text-ink-3">
            {labels.heading}
          </p>
          {/* ── WHO IT WILL BE FILED AGAINST ─────────────────────────────
           *
           * Named on the confirm step itself, because a click made without
           * the subject in view is the mistake this whole flow is arranged to
           * prevent. When the printed name matched exactly, this is a
           * PROPOSAL and the person is agreeing to it; when it matched none
           * or several, there is nothing to agree to yet and the picker below
           * asks instead. */}
          {chosen ? (
            <div className="mb-z3">
              <p className="text-sm font-medium text-ink">
                {chosen.firstName} {chosen.lastName}
              </p>
              <p className="text-xs text-ink-3">
                {driverId
                  ? labels.subjectStated
                  : labels.subjectProposed.replace(
                      '{printed}',
                      proposal.printedName ?? '',
                    )}
              </p>
              {!driverId ? (
                <button
                  type="button"
                  onClick={() => setChosen(null)}
                  className="mt-z1 text-xs text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-accent"
                >
                  {labels.notThem}
                </button>
              ) : null}
            </div>
          ) : (
            <div
              role="group"
              className="mb-z3 rounded-card border-2 border-warning bg-warning-soft px-z3 py-z2"
            >
              <p className="text-sm font-medium text-ink">
                {match?.kind === 'many'
                  ? labels.askMany.replace(
                      '{printed}',
                      proposal.printedName ?? '',
                    )
                  : labels.askNone.replace(
                      '{printed}',
                      proposal.printedName ?? '',
                    )}
              </p>
              <p className="mt-z1 text-xs text-ink-2">{labels.askBody}</p>
              <ul className="mt-z2 flex flex-wrap gap-x-z4 gap-y-z1">
                {(match?.kind === 'many' ? match.drivers : roster).map(
                  (driver) => (
                    <li key={driver.id}>
                      <button
                        type="button"
                        onClick={() => setChosen(driver)}
                        className="text-sm text-accent hover:underline"
                      >
                        {driver.lastName}, {driver.firstName}
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}

          {/* NOT A FOOTNOTE. A certificate filed against the wrong person is
              the failure this comparison exists for, and it is shown ONLY when
              the names disagree — a warning that fires on every card is one
              people learn to dismiss. */}
          {proposal.nameDisagreement ? (
            <div
              role="alert"
              className="mb-z3 rounded-card border-2 border-warning bg-warning-soft px-z3 py-z2"
            >
              <p className="text-sm text-ink">
                {labels.nameWarning
                  .replace('{printed}', proposal.nameDisagreement.printed)
                  .replace('{expected}', proposal.nameDisagreement.expected)}
              </p>
            </div>
          ) : null}

          <dl className="grid grid-cols-[auto_1fr] gap-x-z4 gap-y-z2 text-sm">
            <dt className="text-ink-3">{labels.expires}</dt>
            <dd className="font-mono text-ink">
              {proposal.expiresAt}
              <span className="ms-z2 text-xs text-ink-3">
                {labels.asPrinted.replace(
                  '{printed}',
                  proposal.expiresAtPrinted,
                )}
              </span>
              {proposal.expiresAtConfidence === 'high' ? null : (
                <span className="ms-z2 text-xs text-warning">
                  {proposal.expiresAtConfidence}
                </span>
              )}
            </dd>

            <dt className="text-ink-3">{labels.issued}</dt>
            <dd className="font-mono text-ink">{value(proposal.issuedAt)}</dd>

            <dt className="text-ink-3">{labels.examiner}</dt>
            <dd className="text-ink">{value(proposal.examinerName)}</dd>

            <dt className="text-ink-3">{labels.registry}</dt>
            <dd className="font-mono text-ink">
              {value(proposal.examinerRegistryNumber)}
            </dd>
          </dl>
        </div>

        {/* WHAT IS FILED IS WHAT WAS SHOWN. The values ride in the form rather
            than being carried server-side from the read, so the row records
            the date somebody actually looked at. */}
        <input type="hidden" name="driverId" value={chosen?.id ?? ''} />
        <input type="hidden" name="expiresAt" value={proposal.expiresAt} />
        <input type="hidden" name="issuedAt" value={proposal.issuedAt ?? ''} />
        <input
          type="hidden"
          name="examinerName"
          value={proposal.examinerName ?? ''}
        />
        <input
          type="hidden"
          name="examinerRegistryNumber"
          value={proposal.examinerRegistryNumber ?? ''}
        />

        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}

        <div className="flex items-center gap-z3">
          <button
            type="submit"
            // NOTHING TO FILE WITHOUT A SUBJECT. Disabled rather than hidden,
            // so the person can see what they are being asked to complete.
            disabled={!chosen}
            className={cx(
              'inline-flex h-control items-center rounded-control bg-accent px-z4',
              'text-base font-medium text-on-accent hover:bg-accent-strong',
            )}
          >
            {labels.file}
          </button>
          <button
            type="button"
            onClick={() => setProposal(null)}
            className="text-sm text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-accent"
          >
            {labels.discard}
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-z2">
      {notice ? (
        <p
          role="status"
          className="rounded-card border border-warning bg-warning-soft px-z3 py-z2 text-sm text-warning"
        >
          {labels.notices[notice] ?? notice}
        </p>
      ) : null}
      {driverLabel ? (
        <p className="text-sm text-ink-2">
          {labels.forDriver.replace('{driver}', driverLabel)}
        </p>
      ) : null}
      <DropZone
        labels={{
          title: labels.dropTitle,
          body: labels.dropBody,
          hint: labels.dropHint,
          busy: labels.reading,
        }}
        busy={reading}
        prominent={prominent}
        onFile={(file) => void take(file)}
      />
    </div>
  )
}
