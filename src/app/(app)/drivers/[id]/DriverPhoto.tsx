'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadDocument } from '@/lib/upload-client'

// ---------------------------------------------------------------------------
// THE DRIVER'S PHOTO (§6.4 part 2, v11.22).
//
// A `PHOTO` document like any other — the newest live one, chosen on the
// server by `photoOf` — fetched through the same short-lived download URL the
// documents list uses, so the bucket never appears in a page's markup or in
// browser history. Upload goes through the one pipeline (compress → hash →
// mint → PUT → confirm) as a `PHOTO` on this driver; the server's document
// rules decide whether it lands, not this component.
// ---------------------------------------------------------------------------

export function DriverPhoto({
  driverId,
  documentId,
  initials,
  mayUpload,
  labels,
}: {
  driverId: string
  /** The newest live PHOTO document, or null. */
  documentId: string | null
  /** Shown in the frame when there is no photo. */
  initials: string
  mayUpload: boolean
  labels: { photo: string; upload: string; failed: string }
}) {
  const router = useRouter()
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (documentId === null) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(
          `/api/documents/${documentId}/download-url`,
        )
        if (!response.ok) return
        const { url: signed } = (await response.json()) as { url: string }
        if (!cancelled) setUrl(signed)
      } catch {
        // The initials stay; a photo that will not load is not an error the
        // office has to act on.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [documentId])

  const attach = async (file: File) => {
    setBusy(true)
    setFailed(false)
    try {
      await uploadDocument(file, {
        entity: 'driver',
        entityId: driverId,
        documentType: 'PHOTO',
      })
      router.refresh()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-z3">
      <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 text-lg font-medium text-ink-2">
        {url ? (
          // A signed, short-lived URL to the bucket: next/image would need
          // the bucket's host configured and would cache past the URL's life.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={labels.photo}
            className="size-full object-cover"
          />
        ) : (
          <span aria-hidden>{initials}</span>
        )}
      </div>
      {mayUpload ? (
        <div className="flex flex-col gap-z1">
          <label className="inline-flex h-control cursor-pointer items-center rounded-control border border-border-strong px-z3 text-sm font-medium text-ink hover:bg-surface-3">
            {labels.upload}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void attach(file)
              }}
            />
          </label>
          {failed ? (
            <p role="alert" className="text-xs text-danger">
              {labels.failed}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
