'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadDocument, type UploadPhase } from '@/lib/upload-client'
import { cx } from '@/lib/cx'

// ---------------------------------------------------------------------------
// THREE SMALL DOCUMENT CONTROLS, ONE HOME (§6.4 part 2 v11.30).
//
// The compliance panel had the link and the attach control as private
// functions; the driver's Documents tab and the DQF rows need the same two,
// and an upload on a stated kind. A copy per screen is a copy per screen that
// opens a file differently — so they live here and the panel imports them.
// ---------------------------------------------------------------------------

/**
 * A document link that fetches its own signed URL on click.
 *
 * The URL is short-lived and minted per request, so it cannot be rendered into
 * the page ahead of time — the same pattern the load screen's documents use.
 */
export function DocumentLink({
  id,
  filename,
  failedLabel,
}: {
  id: string
  filename: string
  failedLabel: string
}) {
  const [failed, setFailed] = useState(false)

  return (
    <button
      type="button"
      className="font-mono text-xs text-accent hover:underline"
      onClick={async () => {
        try {
          const response = await fetch(`/api/documents/${id}/download-url`)
          if (!response.ok) throw new Error(String(response.status))
          const { url } = (await response.json()) as { url: string }
          window.open(url, '_blank', 'noopener')
        } catch {
          setFailed(true)
        }
      }}
    >
      {failed ? failedLabel : filename}
    </button>
  )
}

export interface UploadLabels {
  attach: string
  preparing: string
  uploading: string
  failed: string
}

function captionFor(phase: UploadPhase, labels: UploadLabels): string {
  return phase === 'preparing'
    ? labels.preparing
    : phase === 'uploading'
      ? labels.uploading
      : phase === 'failed'
        ? labels.failed
        : labels.attach
}

/**
 * A file picker that uploads to one stated target and re-reads the page.
 *
 * THE TARGET IS STATED BY THE SERVER-RENDERED CALLER: a compliance record
 * (Attach), or the driver with a kind (the DQF row's Upload, the Documents
 * tab). The server's document rules decide whether it lands.
 */
export function UploadTo({
  target,
  labels,
}: {
  target: {
    entity: 'complianceItem' | 'driver'
    entityId: string
    documentType: string
  }
  labels: UploadLabels
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<UploadPhase>('idle')

  return (
    <label
      className={cx(
        'cursor-pointer text-xs',
        phase === 'failed' ? 'text-danger' : 'text-accent hover:underline',
      )}
    >
      {captionFor(phase, labels)}
      <input
        type="file"
        className="sr-only"
        disabled={phase === 'preparing' || phase === 'uploading'}
        onChange={async (event) => {
          const file = event.target.files?.[0]
          if (!file) return
          try {
            await uploadDocument(file, target, (progress) =>
              setPhase(progress.phase),
            )
            setPhase('done')
            // The lists are server-rendered, so the page has to re-read
            // before the new file appears.
            router.refresh()
          } catch {
            setPhase('failed')
          }
        }}
      />
    </label>
  )
}

/** Attach a file to one compliance record. */
export function AttachDocument({
  recordId,
  documentType,
  labels,
}: {
  recordId: string
  documentType: string
  labels: UploadLabels
}) {
  return (
    <UploadTo
      target={{ entity: 'complianceItem', entityId: recordId, documentType }}
      labels={labels}
    />
  )
}
