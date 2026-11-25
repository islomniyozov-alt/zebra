'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { uploadDocument } from '@/lib/upload-client'
import { HELD_CARD_HREF, holdCard } from '@/lib/held-card'
import {
  verdictFor,
  type RegistrationFormField,
  type RegistrationVerdicts,
} from '@/lib/extraction/registration-fields'
import type {
  RegistrationTruckCandidate,
  RegistrationTruckMatch,
} from '@/lib/registration-match'
import { fileRegistrationAction } from './registration-actions'
import { REGISTRATION_FILE_INITIAL } from './registration-state'
import type { RegistrationLabels } from './registration-labels'

// ---------------------------------------------------------------------------
// A CAB CARD'S CONFIRM STEP ON THE SAFETY INTAKE (TMS §7.8, v11.57).
//
// What the card says, the truck it matched (VIN, then unit number, then
// plate — `registration-match.ts`) in a select the person may change, and the
// expiry and issue date prefilled. File is Add truck's own filing on that
// truck; the file then goes on the new REGISTRATION item. Nothing is stored
// until File is pressed, and the truck's own fields are never changed.
//
// NO MATCH offers "No truck with this VIN — add it": the card and its reading
// are put in this device's handoff slot (`held-card.ts`) and Add truck opens
// already filled from them, without a second read.
// ---------------------------------------------------------------------------

export interface RegistrationReadView {
  verdicts: RegistrationVerdicts
  prefill: Partial<Record<RegistrationFormField, string>>
  match: RegistrationTruckMatch
  trucks: RegistrationTruckCandidate[]
}

interface Props {
  reading: RegistrationReadView
  file: File | null
  labels: RegistrationLabels
  onCancel: () => void
}

export function RegistrationConfirm({
  reading,
  file,
  labels,
  onCancel,
}: Props) {
  const router = useRouter()
  const [state, act, pending] = useActionState(
    fileRegistrationAction,
    REGISTRATION_FILE_INITIAL,
  )
  const [attach, setAttach] = useState<'idle' | 'done' | 'failed'>('idle')
  const [handing, setHanding] = useState(false)
  const { verdicts, prefill, match, trucks } = reading

  // The file goes on AFTER the item exists, as the inspection's does.
  useEffect(() => {
    if (!state.createdId || !file || attach !== 'idle') return
    uploadDocument(file, {
      entity: 'complianceItem',
      entityId: state.createdId,
      documentType: 'REGISTRATION',
    })
      .then(() => setAttach('done'))
      .catch(() => setAttach('failed'))
  }, [state.createdId, file, attach])

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

  /** What the card says, or by hand with what was seen. */
  const fact = (name: RegistrationFormField) => {
    const verdict = verdictFor(verdicts, name)
    if (verdict.read) return prefill[name] ?? ''
    return verdict.printed
      ? `${labels.byHand} — ${labels.seen.replace('{printed}', verdict.printed)}`
      : labels.byHand
  }
  const hint = (name: RegistrationFormField) => {
    const verdict = verdictFor(verdicts, name)
    if (verdict.read) return undefined
    return verdict.printed
      ? `${labels.byHand} — ${labels.seen.replace('{printed}', verdict.printed)}`
      : labels.byHand
  }

  const proposed = match.kind === 'one' ? match.truck : null
  const offered = match.kind === 'several' ? match.trucks : trucks
  const typed = state.typed

  const addIt = async () => {
    setHanding(true)
    // The slot may be unavailable (private window); Add truck then opens
    // empty with its own drop zone, which is still the right page.
    if (file) await holdCard(file, { verdicts, prefill })
    router.push(HELD_CARD_HREF)
  }

  return (
    <form action={act} className="flex flex-col gap-z3">
      <input type="hidden" name="registration" value="yes" />
      <input type="hidden" name="plate" value={prefill.plate ?? ''} />
      <input type="hidden" name="plateState" value={prefill.plateState ?? ''} />
      <div className="rounded-card border border-border bg-surface px-z3 py-z3">
        <p className="mb-z2 text-xs uppercase tracking-wide text-ink-3">
          {labels.heading}
        </p>

        <dl className="mb-z3 grid grid-cols-[max-content_1fr] gap-x-z3 gap-y-z1 text-sm">
          <dt className="text-ink-3">{labels.vin}</dt>
          <dd className="font-mono text-ink">{fact('vin')}</dd>
          <dt className="text-ink-3">{labels.unitNumber}</dt>
          <dd className="font-mono text-ink">{fact('unitNumber')}</dd>
          <dt className="text-ink-3">{labels.plate}</dt>
          <dd className="font-mono text-ink">
            {verdicts.plate.read
              ? [prefill.plate, prefill.plateState].filter(Boolean).join(' · ')
              : fact('plate')}
          </dd>
          <dt className="text-ink-3">{labels.owner}</dt>
          <dd className="text-ink">{fact('ownerName')}</dd>
        </dl>

        {match.kind === 'none' ? (
          <p className="mb-z3 text-sm">
            <a
              href={HELD_CARD_HREF}
              onClick={(event) => {
                event.preventDefault()
                if (!handing) void addIt()
              }}
              className="font-medium text-accent underline underline-offset-2"
            >
              {labels.noTruck}
            </a>
          </p>
        ) : null}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
          <div className="flex flex-col gap-z1">
            <Select
              id="registration-truckId"
              name="truckId"
              label={labels.truck}
              required
              defaultValue={typed?.truckId ?? proposed?.id ?? ''}
              options={[
                { value: '', label: labels.chooseTruck },
                ...offered.map((truck) => ({
                  value: truck.id,
                  label: truck.unitNumber,
                })),
              ]}
            />
            {proposed && match.kind === 'one' ? (
              <p className="text-xs text-ink-3">
                {labels.matchedBy[match.by].replace(
                  '{unit}',
                  proposed.unitNumber,
                )}
              </p>
            ) : match.kind === 'several' ? (
              <p className="text-xs text-warning">{labels.several}</p>
            ) : null}
          </div>
          <Input
            id="registration-expiresAt"
            name="registrationExpiresAt"
            label={labels.expires}
            inputMode="numeric"
            required
            defaultValue={
              typed?.registrationExpiresAt ??
              prefill.registrationExpiresAt ??
              ''
            }
            hint={hint('registrationExpiresAt')}
          />
          <Input
            id="registration-issuedAt"
            name="registrationIssuedAt"
            label={labels.issued}
            inputMode="numeric"
            defaultValue={
              typed?.registrationIssuedAt ?? prefill.registrationIssuedAt ?? ''
            }
            hint={hint('registrationIssuedAt')}
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
