'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DropZone } from '@/components/forms/DropZone'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { UprightCard, needsUprightStep } from '@/components/UprightCard'
import { uploadDocument } from '@/lib/upload-client'
import { downscaleImage } from '../new/downscale'
import { recordRenewalAction } from '../../_reference/compliance-actions'
import {
  COMPLIANCE_INITIAL,
  type ComplianceState,
} from '../../_reference/compliance-state'

// ---------------------------------------------------------------------------
// READ A LICENCE FOR A DRIVER WHO ALREADY EXISTS (§6.4 part 2 v11.30).
//
// `/api/cdl/read` was reachable only from Add driver, where the reading fills
// the form that creates the person. On the Documents tab the person exists, so
// the reading proposes the CDL COMPLIANCE RECORD instead: number, state and
// expiry, shown for a person to confirm, then filed through `recordRenewal` —
// the compliance panel's own writer — and the image kept on the driver as the
// copy of the CDL, which is the DQF's document half of that row.
//
// READ, THEN CONFIRM. Nothing is written by the read. And Main's licence
// fields are Main's: a reading that disagrees with them is SHOWN beside them
// ("Main: …"), never written over them — deciding which is right is the
// office's call, not this screen's. An EMPTY Main field is filled from what
// is filed (`driver-cdl.ts`, 2026-11-18).
// ---------------------------------------------------------------------------

interface Reading {
  cdlNumber: string
  cdlState: string
  cdlClass: string
  cdlExpiresAt: string
}

interface Props {
  driverId: string
  /** What Main holds today, to show beside a reading that differs. */
  onMain: { cdlNumber: string; cdlState: string; cdlClass: string }
  /** The compliance writer's error keys in words. */
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    drop: { title: string; body: string; hint: string; busy: string }
    number: string
    state: string
    class: string
    expires: string
    onMain: string
    file: string
    discard: string
    filed: string
    keptFailed: string
    failed: string
    unreadable: string
    upright: {
      title: string
      hint: string
      rotateLeft: string
      rotateRight: string
      read: string
      cancel: string
    }
  }
}

export function CdlReader({ driverId, onMain, translate, labels }: Props) {
  const router = useRouter()
  const [reading, setReading] = useState(false)
  const [awaitingUpright, setAwaitingUpright] = useState<File | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Reading | null>(null)
  /** The bytes that were read, kept so the confirmed record keeps its image. */
  const kept = useRef<File | null>(null)
  const [state, formAction, pending] = useActionState<
    ComplianceState,
    FormData
  >(recordRenewalAction.bind(null, 'driver', driverId), COMPLIANCE_INITIAL)
  const [done, setDone] = useState<'filed' | 'keptFailed' | null>(null)

  // ONCE THE RECORD EXISTS, THE IMAGE GOES ON THE DRIVER as the copy of the
  // CDL. A failed upload is said, not hidden: the record is filed either way.
  useEffect(() => {
    if (!state.createdId || done !== null) return
    const file = kept.current
    void (async () => {
      try {
        if (file) {
          await uploadDocument(file, {
            entity: 'driver',
            entityId: driverId,
            documentType: 'CDL_COPY',
          })
        }
        setDone('filed')
      } catch {
        setDone('keptFailed')
      } finally {
        router.refresh()
      }
    })()
  }, [state.createdId, done, driverId, router])

  const read = async (chosen: File, quarterTurns: number) => {
    setAwaitingUpright(null)
    setReading(true)
    setNotice(null)
    setProposal(null)
    try {
      const file = await downscaleImage(chosen, { quarterTurns })
      kept.current = file
      const body = new FormData()
      body.append('file', file)
      const response = await fetch('/api/cdl/read', { method: 'POST', body })
      if (!response.ok) {
        setNotice(labels.failed)
        return
      }
      const result = (await response.json()) as {
        values: Record<string, string>
        notice: string | null
      }
      const values = result.values ?? {}
      if (!values.cdlExpiresAt && !values.cdlNumber) {
        setNotice(labels.unreadable)
        return
      }
      setProposal({
        cdlNumber: values.cdlNumber ?? '',
        cdlState: values.cdlState ?? '',
        cdlClass: values.cdlClass ?? '',
        cdlExpiresAt: values.cdlExpiresAt ?? '',
      })
    } catch {
      setNotice(labels.failed)
    } finally {
      setReading(false)
    }
  }

  const take = async (chosen: File) => {
    // ORIENTATION IS SETTLED BEFORE THE READ, as on Add driver and the
    // medical card (owner's ruling, 2026-09-12).
    if (await needsUprightStep(chosen)) {
      setAwaitingUpright(chosen)
      return
    }
    await read(chosen, 0)
  }

  if (awaitingUpright) {
    return (
      <UprightCard
        file={awaitingUpright}
        labels={labels.upright}
        onConfirm={(turns) => void read(awaitingUpright, turns)}
        onCancel={() => setAwaitingUpright(null)}
      />
    )
  }

  const differs = (read: string, main: string) =>
    main !== '' && read !== '' && read.toUpperCase() !== main.toUpperCase()

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      {done ? (
        <p
          role="status"
          className="mt-z3 rounded-card border border-ok bg-ok-soft px-z3 py-z2 text-sm text-ok"
        >
          {done === 'filed' ? labels.filed : labels.keptFailed}
        </p>
      ) : proposal ? (
        <form action={formAction} className="mt-z3 flex flex-col gap-z3">
          <input type="hidden" name="type" value="CDL" />
          {/* The record has no class column; filing fills Main's empty one. */}
          <input type="hidden" name="cdlClass" value={proposal.cdlClass} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-z3">
            <Input
              name="identifier"
              label={labels.number}
              defaultValue={proposal.cdlNumber}
              className="font-mono"
              hint={
                differs(proposal.cdlNumber, onMain.cdlNumber)
                  ? `${labels.onMain} ${onMain.cdlNumber}`
                  : undefined
              }
            />
            <Input
              name="issuer"
              label={labels.state}
              defaultValue={proposal.cdlState}
              hint={
                differs(proposal.cdlState, onMain.cdlState)
                  ? `${labels.onMain} ${onMain.cdlState}`
                  : undefined
              }
            />
            <Input
              name="expiresAt"
              label={labels.expires}
              defaultValue={proposal.cdlExpiresAt}
              required
              inputMode="numeric"
            />
          </div>
          {proposal.cdlClass ? (
            <p className="text-sm text-ink-2">
              {labels.class} {proposal.cdlClass}
              {differs(proposal.cdlClass, onMain.cdlClass) ? (
                <span className="ms-z2 text-ink-3">
                  {labels.onMain} {onMain.cdlClass}
                </span>
              ) : null}
            </p>
          ) : null}
          <div className="flex items-center gap-z3">
            <Button type="submit" variant="primary" disabled={pending}>
              {labels.file}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setProposal(null)
                kept.current = null
              }}
            >
              {labels.discard}
            </Button>
            {state.error ? (
              <p role="alert" className="text-sm text-danger">
                {translate[state.error] ?? state.error}
              </p>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="mt-z3">
          <DropZone
            labels={labels.drop}
            busy={reading}
            onFile={(file) => void take(file)}
          />
          {notice ? (
            <p role="status" className="mt-z2 text-sm text-ink-2">
              {notice}
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
