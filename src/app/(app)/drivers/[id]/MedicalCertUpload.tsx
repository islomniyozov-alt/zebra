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
// ── READ, THEN CONFIRM. NEVER READ AND FILE. ──────────────────────────────
//
// The CDL's flow prefills a form that CREATES a driver, so a person reads
// every value before anything exists. This lands on a driver who already
// exists, and the row it writes decides whether they may legally drive — so
// the confirm step is not a formality. It shows what will be filed, in the
// words the card used and the date this system read them as, and nothing is
// written until somebody clicks.
//
// THE DRIVER IS NOT IN QUESTION HERE. Whose certificate this is comes from the
// page it was dropped on, never from the document — see `checkDriverName`. If
// the card prints a name that disagrees, that is SHOWN and the click is still
// the person's to make: the card may be right and the page wrong, and deciding
// which is not this screen's job.
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
}

interface Props {
  driverId: string
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
    notices: Record<string, string>
  }
}

export function MedicalCertUpload({ driverId, labels }: Props) {
  const [reading, setReading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [state, formAction] = useActionState<FileMedicalCertState, FormData>(
    fileMedicalCertAction.bind(null, driverId),
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
        notice: string | null
      }
      if (result.proposal) setProposal(result.proposal)
      else setNotice(result.notice ?? 'drivers.med.unreadable')
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
      <DropZone
        labels={{
          title: labels.dropTitle,
          body: labels.dropBody,
          hint: labels.dropHint,
          busy: labels.reading,
        }}
        busy={reading}
        onFile={(file) => void take(file)}
      />
    </div>
  )
}
