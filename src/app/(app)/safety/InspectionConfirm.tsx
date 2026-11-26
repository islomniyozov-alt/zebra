'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFiled } from './use-filed'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { uploadDocument } from '@/lib/upload-client'
import type {
  InspectionFormPrefill,
  TruckCandidate,
  TruckMatch,
} from '@/lib/annual-inspection'
import type {
  InspectionVerdicts,
  Verdict,
} from '@/lib/extraction/inspection-fields'
import { fileInspectionAction } from './inspection-actions'
import {
  COMPLIANCE_INITIAL,
  type ComplianceState,
} from '../_reference/compliance-state'
import type { InspectionLabels } from './inspection-labels'

// ---------------------------------------------------------------------------
// THE ANNUAL INSPECTION'S CONFIRM STEP (TMS §7.8, v11.47).
//
// The compliance panel's own fields, prefilled from the reading. A field the
// reader could not read is EMPTY and says "—, enter by hand" — never filled
// with a guess — and, when the reader saw something it would not vouch for,
// what it saw and why it was not used. The truck is proposed from an exact
// fleet-unit or VIN match and confirmed here; nothing is filed until a person
// presses File. §0 rule 14: a refused save keeps what was typed.
// ---------------------------------------------------------------------------

export interface InspectionReadView {
  verdicts: InspectionVerdicts
  prefill: InspectionFormPrefill
  match: TruckMatch
  trucks: TruckCandidate[]
}

interface Props {
  reading: InspectionReadView
  file: File | null
  labels: InspectionLabels
  onCancel: () => void
  /** The intake's reset after a File (rule 15); absent, the step shows its own line. */
  onFiled?: (message: string) => void
}

export function InspectionConfirm({
  reading,
  file,
  labels,
  onCancel,
  onFiled,
}: Props) {
  const [state, act, pending] = useActionState<ComplianceState, FormData>(
    fileInspectionAction,
    COMPLIANCE_INITIAL,
  )
  const [attach, setAttach] = useState<'idle' | 'done' | 'failed'>('idle')
  const { verdicts, prefill, match, trucks } = reading

  // The photo goes on AFTER the record exists, as on the compliance panel:
  // the upload mints against an entity that has to be there already.
  useEffect(() => {
    if (!state.createdId || !file || attach !== 'idle') return
    uploadDocument(file, {
      entity: 'complianceItem',
      entityId: state.createdId,
      documentType: 'INSPECTION_REPORT',
    })
      .then(() => setAttach('done'))
      .catch(() => setAttach('failed'))
  }, [state.createdId, file, attach])

  // Filed once the record exists AND its photo has settled either way.
  useFiled(
    Boolean(state.createdId) && (!file || attach !== 'idle'),
    attach === 'failed'
      ? `${labels.filed} ${labels.attachFailed}`
      : labels.filed,
    onFiled,
  )

  if (state.createdId) {
    return (
      <p
        role="status"
        className="rounded-card border border-ok bg-ok-soft px-z3 py-z2 text-sm text-ok"
      >
        {labels.filed}
        {attach === 'failed' ? ` ${labels.attachFailed}` : null}
      </p>
    )
  }

  /** The hint under a field: by hand when unread, with what was seen. */
  const hintFor = (verdict: Verdict<unknown>, readHint?: string) => {
    if (verdict.read) return readHint
    const seen = verdict.printed
      ? ` ${labels.readAs
          .replace('{printed}', verdict.printed)
          .replace('{why}', labels.why[verdict.why] ?? verdict.why)}`
      : ''
    return `${labels.byHand}${seen}`
  }
  const fact = (verdict: Verdict<string>) =>
    verdict.read ? verdict.value : hintFor(verdict)

  const typed = state.values
  const proposed = match.kind === 'one' ? match.truck : null
  const issuerVerdict: Verdict<unknown> =
    verdicts.inspectorName.read || verdicts.agency.read
      ? { read: true, value: '', printed: '', confidence: 'high' }
      : verdicts.inspectorName

  return (
    <form action={act} className="flex flex-col gap-z3">
      <div className="rounded-card border border-border bg-surface px-z3 py-z3">
        <p className="mb-z2 text-xs uppercase tracking-wide text-ink-3">
          {labels.heading}
        </p>

        <dl className="mb-z3 grid grid-cols-[max-content_1fr] gap-x-z3 gap-y-z1 text-sm">
          <dt className="text-ink-3">{labels.fleetUnit}</dt>
          <dd className="font-mono text-ink">{fact(verdicts.fleetUnit)}</dd>
          <dt className="text-ink-3">{labels.vin}</dt>
          <dd className="font-mono text-ink">{fact(verdicts.vin)}</dd>
          <dt className="text-ink-3">{labels.result}</dt>
          <dd className="text-ink">
            {verdicts.result.read
              ? verdicts.result.value === 'passed'
                ? labels.passed
                : labels.failed
              : hintFor(verdicts.result)}
          </dd>
        </dl>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
          <div className="flex flex-col gap-z1">
            <Select
              name="truckId"
              label={labels.truck}
              required
              defaultValue={proposed?.id ?? ''}
              options={[
                { value: '', label: labels.chooseTruck },
                ...trucks.map((truck) => ({
                  value: truck.id,
                  label: truck.unitNumber,
                })),
              ]}
            />
            {proposed ? (
              <p className="text-xs text-ink-3">
                {(match.kind === 'one' && match.by === 'vin'
                  ? labels.proposedByVin
                  : labels.proposedByUnit
                ).replace('{unit}', proposed.unitNumber)}
              </p>
            ) : null}
          </div>
          <Input
            name="identifier"
            label={labels.reportNumber}
            defaultValue={typed?.identifier ?? prefill.identifier}
            hint={hintFor(verdicts.reportNumber)}
          />
          <Input
            name="issuedAt"
            label={labels.inspectionDate}
            inputMode="numeric"
            defaultValue={typed?.issuedAt ?? prefill.issuedAt}
            hint={hintFor(verdicts.inspectionDate)}
          />
          <Input
            name="expiresAt"
            label={labels.expires}
            inputMode="numeric"
            required
            defaultValue={typed?.expiresAt ?? prefill.expiresAt}
            hint={hintFor(verdicts.inspectionDate, labels.expiresDerived)}
          />
          <Input
            name="issuer"
            label={labels.inspector}
            defaultValue={typed?.issuer ?? prefill.issuer}
            hint={hintFor(issuerVerdict)}
          />
          <Input
            name="notes"
            label={labels.notes}
            defaultValue={typed?.notes ?? prefill.notes}
          />
        </div>
      </div>

      <div className="flex items-center gap-z3">
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.file}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {labels.cancel}
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {labels.errors[state.error] ?? state.error}
          </p>
        ) : null}
      </div>
    </form>
  )
}
