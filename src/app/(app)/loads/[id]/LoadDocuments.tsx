'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { cx } from '@/lib/cx'
import { uploadDocument, type UploadPhase } from '@/lib/upload-client'

// §7.8 — documents group by TYPE, not by upload order, and a missing required
// document renders as a dashed placeholder in warning rather than as absence.
// "An empty space communicates nothing": a dispatcher scanning forty loads for
// the one missing its POD needs the gap to be visible, not inferable.
//
// The POD slot is where §7's automatic transition actually happens. Confirming
// a POD moves the load to POD received on the server; this component's only
// job afterwards is to ask the page to re-read, because the status stripe two
// panels up is now out of date.

export interface DocumentRow {
  id: string
  type: string
  filename: string
  size: string
  uploadedAt: string
  uploadedBy: string | null
}

export interface DocumentSlot {
  type: string
  label: string
  /** Required at the load's CURRENT stage — rate con always, POD once Delivered. */
  required: boolean
  documents: DocumentRow[]
}

interface Props {
  loadId: string
  slots: readonly DocumentSlot[]
  mayUpload: boolean
  onUploaded: () => Promise<void>
  labels: {
    title: string
    missing: string
    upload: string
    preparing: string
    uploading: string
    done: string
    failed: string
    none: string
    by: string
  }
}

export function LoadDocuments({
  loadId,
  slots,
  mayUpload,
  onUploaded,
  labels,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [error, setError] = useState<string | null>(null)

  const attach = async (type: string, file: File) => {
    setBusy(type)
    setError(null)
    try {
      await uploadDocument(
        file,
        { entity: 'load', entityId: loadId, documentType: type },
        (progress) => setPhase(progress.phase),
      )
      // A POD confirm has just moved the load to POD received, server-side.
      // Nothing here knows that; it just asks for the page again, and the
      // stripe, the badge and the timeline all come back correct together.
      await onUploaded()
      router.refresh()
    } catch (failure) {
      setPhase('failed')
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>

      <div className="mt-z3 flex flex-col gap-z3">
        {slots.map((slot) => {
          const empty = slot.documents.length === 0
          const active = busy === slot.type

          return (
            <div key={slot.type}>
              <div className="flex items-center justify-between gap-z2">
                <h3 className="text-sm font-medium text-ink-2">{slot.label}</h3>
                {mayUpload ? (
                  <label className="cursor-pointer text-sm font-medium text-accent hover:text-accent-hover">
                    {labels.upload}
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      className="sr-only"
                      disabled={active}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void attach(slot.type, file)
                      }}
                    />
                  </label>
                ) : null}
              </div>

              {empty ? (
                /* §7.8 — a dashed placeholder in warning, not an empty space,
                 * when the load's stage requires this document. */
                <p
                  className={cx(
                    'mt-z1 rounded-control border border-dashed px-z2 py-z2 text-sm',
                    slot.required
                      ? 'border-warning bg-warning-soft text-warning'
                      : 'border-border text-ink-3',
                  )}
                >
                  {slot.required ? labels.missing : labels.none}
                </p>
              ) : (
                <ul className="mt-z1 flex flex-col gap-z1">
                  {slot.documents.map((document) => (
                    <li
                      key={document.id}
                      className="flex flex-wrap items-baseline gap-z2 border-b border-border pb-z1 text-sm last:border-b-0"
                    >
                      <span className="font-mono text-ink">
                        {document.filename}
                      </span>
                      <span className="font-mono text-xs text-ink-3">
                        {document.size}
                      </span>
                      <span className="text-xs text-ink-3">
                        {document.uploadedAt}
                      </span>
                      {document.uploadedBy ? (
                        <span className="text-xs text-ink-3">
                          {labels.by} {document.uploadedBy}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {active ? (
                <p role="status" className="mt-z1 text-sm text-ink-3">
                  {phase === 'preparing'
                    ? labels.preparing
                    : phase === 'uploading'
                      ? labels.uploading
                      : labels.done}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      {error ? (
        <p role="alert" className="mt-z3 text-base text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
