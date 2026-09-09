'use client'

import { useState } from 'react'
import { DropZone } from '@/components/forms/DropZone'
import { MedicalCertUpload } from './MedicalCertUpload'
import { CoiConfirm, type CoiProposalView } from './CoiConfirm'
import { READABLE_COMPLIANCE_DOCUMENTS } from './compliance-documents'
import type { medLabels } from './med-labels'
import type { coiLabels } from './coi-labels'

// ---------------------------------------------------------------------------
// THE FRONT DOOR FOR A COMPLIANCE DOCUMENT.
//
// ── ONE ZONE, NOT ONE LINK PER TYPE ───────────────────────────────────────
//
// Registration and annual inspections are next. The shape they must not
// arrive in is a control per type, each with its own zone and its own copy.
// So this component owns "a compliance document arrived" and the reading is
// dispatched by what the document turns out to be.
//
// ── CLASSIFICATION PROPOSES, NEVER CHOOSES ────────────────────────────────
//
// The owner's ruling of 2026-09-09, and the whole reason this screen may infer
// a type at all when `compliance-documents.ts` otherwise forbids it:
//
//   classify -> extract with the proposed type's contract -> THIS STEP NAMES
//   the type it decided and lets the person change it, which re-reads with the
//   correct contract.
//
// A wrong guess costs one re-read and can never cause a wrong filing, because
// the verdict is on screen beside the values and nothing is stored until
// somebody agrees with both. A low-confidence classification asks BEFORE
// extracting — the route enforces that; this renders the question.
//
// THE FILE IS HELD, NOT RE-REQUESTED. Changing the type re-posts the same
// `File` object this browser already has, so an override costs one read rather
// than a read and a second upload.
//
// ── AND IT NO LONGER ASKS WHICH CARRIER ───────────────────────────────────
//
// This screen used to hold a carrier picker, because a certificate of
// insurance was assumed to belong to one of ours. `acord25-01.pdf` insures
// CHAPAN INC — an owner-operator's entity — against two tractors that run
// under RAM Haulage, and no answer to "which of your carriers is this for"
// would have been true. So the DOCUMENT places itself: `decideCoiSubject`
// matches the insured against the authorities, then the VINs against the
// trucks, and the confirm step names what it decided and why.
// ---------------------------------------------------------------------------

interface Candidate {
  id: string
  firstName: string
  lastName: string
}

interface Verdict {
  type: string | null
  confidence: string
  because: string | null
  stated: boolean
}

interface Props {
  roster: readonly Candidate[]
  labels: ReturnType<typeof medLabels>
  coi: ReturnType<typeof coiLabels>
  prominent?: boolean
  driverId?: string
  driverLabel?: string
}

type Reading =
  | { kind: 'medical'; proposal: unknown; match: unknown }
  | { kind: 'coi'; proposal: CoiProposalView }

export function ComplianceIntake({
  roster,
  labels,
  coi,
  prominent,
  driverId,
  driverLabel,
}: Props) {
  const [reading, setReading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [held, setHeld] = useState<File | null>(null)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [needsType, setNeedsType] = useState(false)
  const [result, setResult] = useState<Reading | null>(null)

  const post = async (file: File, type?: string) => {
    setReading(true)
    setNotice(null)
    try {
      const body = new FormData()
      body.append('file', file)
      if (type) body.append('type', type)
      if (driverId) body.append('driverId', driverId)

      const response = await fetch('/api/compliance/read', {
        method: 'POST',
        body,
      })
      if (!response.ok) {
        // The handler's refusals shown as themselves. A dispatcher told
        // "something went wrong" photographs the document again for nothing.
        setNotice(
          response.status === 413
            ? 'drivers.med.tooLarge'
            : response.status === 415
              ? 'drivers.med.wrongType'
              : response.status === 403
                ? 'drivers.med.notAllowed'
                : 'safety.intake.failed',
        )
        return
      }

      const payload = (await response.json()) as {
        verdict: Verdict | null
        proposal: unknown
        match?: unknown
        carrier?: { agrees: boolean; notes: string[] } | null
        needsType?: boolean
        notice: string | null
      }

      setVerdict(payload.verdict)
      setNeedsType(Boolean(payload.needsType))

      if (payload.needsType) return
      if (!payload.proposal) {
        setNotice(payload.notice ?? 'safety.intake.unreadable')
        return
      }

      if (payload.verdict?.type === 'INSURANCE_CERT') {
        setResult({
          kind: 'coi',
          proposal: payload.proposal as CoiProposalView,
        })
      } else {
        setResult({
          kind: 'medical',
          proposal: payload.proposal,
          match: payload.match ?? { kind: 'none' },
        })
      }
    } catch {
      setNotice('safety.intake.failed')
    } finally {
      setReading(false)
    }
  }

  const restart = () => {
    setResult(null)
    setVerdict(null)
    setNeedsType(false)
    setHeld(null)
  }

  // ── THE VERDICT, WHEREVER THE FLOW HAS GOT TO ─────────────────────────
  //
  // Rendered above every branch below rather than inside one, because the
  // ruling is that the person always sees what this decided — including when
  // it decided nothing and is asking.
  const verdictLine =
    verdict && !verdict.stated && verdict.type ? (
      <p className="text-sm text-ink-2">
        {coi.readAs.replace(
          '{type}',
          coi.documentNames[verdict.type] ?? verdict.type,
        )}
        {verdict.because ? (
          <span className="text-ink-3"> — {verdict.because}</span>
        ) : null}{' '}
        <button
          type="button"
          onClick={restart}
          className="underline decoration-border-strong underline-offset-2 hover:text-accent"
        >
          {coi.notThat}
        </button>
      </p>
    ) : null

  if (result?.kind === 'coi') {
    return (
      <div className="flex flex-col gap-z2">
        {verdictLine}
        <CoiConfirm
          proposal={result.proposal}
          labels={coi}
          onCancel={restart}
        />
      </div>
    )
  }

  if (result?.kind === 'medical') {
    return (
      <div className="flex flex-col gap-z2">
        {verdictLine}
        <MedicalCertUpload
          roster={roster}
          labels={labels}
          prominent={false}
          initial={
            result.proposal
              ? // The intake already read it; this renders the confirm step
                // rather than a second drop zone for a file already sent.
                ({
                  proposal: result.proposal,
                  match: result.match,
                } as never)
              : null
          }
          {...(driverId ? { driverId, driverLabel } : {})}
        />
      </div>
    )
  }

  // ── ASKING, BECAUSE THE CLASSIFIER WOULD HAVE BEEN GUESSING ───────────
  if (needsType && held) {
    return (
      <div className="flex flex-col gap-z3">
        <p className="text-sm text-ink">{coi.whichType}</p>
        {verdict?.because ? (
          <p className="text-sm text-ink-3">{verdict.because}</p>
        ) : null}
        <div className="flex flex-wrap gap-z2">
          {READABLE_COMPLIANCE_DOCUMENTS.map((row) => (
            <button
              key={row.documentType}
              type="button"
              disabled={reading}
              onClick={() => void post(held, row.documentType)}
              className="rounded-card border border-border-strong bg-surface px-z3 py-z2 text-sm text-ink hover:bg-surface-3"
            >
              {coi.documentNames[row.documentType] ?? row.documentType}
            </button>
          ))}
          <button
            type="button"
            onClick={restart}
            className="px-z2 text-sm text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-accent"
          >
            {coi.cancel}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-z2">
      {notice ? (
        <p
          role="status"
          className="rounded-card border border-warning bg-warning-soft px-z3 py-z2 text-sm text-warning"
        >
          {(labels.notices as Record<string, string>)[notice] ??
            coi.notices[notice] ??
            notice}
        </p>
      ) : null}
      {driverLabel ? (
        <p className="text-sm text-ink-2">
          {labels.forDriver.replace('{driver}', driverLabel)}
        </p>
      ) : null}
      <DropZone
        labels={{
          title: coi.dropTitle,
          body: labels.dropBody,
          hint: labels.dropHint,
          busy: labels.reading,
        }}
        busy={reading}
        prominent={prominent ?? false}
        onFile={(file) => {
          // HELD, so an override or a carrier choice costs one read rather
          // than a read and a second upload.
          setHeld(file)
          void post(file)
        }}
      />
    </div>
  )
}
