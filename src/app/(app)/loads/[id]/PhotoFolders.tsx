'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadDocument } from '@/lib/upload-client'
import { setPhotoStageAction } from './actions'

// PHOTOS, IN TWO FOLDERS (TMS §7.14 item 4). Pickup and Delivery, each a list
// of the load's PHOTO documents in that folder and an upload into it. The
// upload is the ordinary document path (compress → hash → mint → PUT →
// confirm); the folder is set on the confirmed document right after, by the
// one writer that checks it is this load's photo.

export interface FolderPhoto {
  id: string
  filename: string
  uploadedAt: string
}

type Stage = 'PICKUP' | 'DELIVERY'

export function PhotoFolders({
  loadId,
  folders,
  mayUpload,
  labels,
}: {
  loadId: string
  folders: Record<Stage, readonly FolderPhoto[]>
  mayUpload: boolean
  labels: {
    title: string
    pickup: string
    delivery: string
    upload: string
    empty: string
    uploading: string
    failed: string
    downloadFailed: string
  }
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<Stage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const attach = async (stage: Stage, files: FileList) => {
    setBusy(stage)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const { documentId } = await uploadDocument(file, {
          entity: 'load',
          entityId: loadId,
          documentType: 'PHOTO',
        })
        const filed = await setPhotoStageAction(loadId, documentId, stage)
        if (!filed.ok) throw new Error(labels.failed)
      }
      router.refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : labels.failed)
    } finally {
      setBusy(null)
    }
  }

  const open = async (documentId: string) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/download-url`)
      if (!response.ok) throw new Error(String(response.status))
      const { url } = (await response.json()) as { url: string }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setError(labels.downloadFailed)
    }
  }

  const folder = (stage: Stage, title: string) => (
    <details
      key={stage}
      data-folder={stage}
      className="rounded-control border border-border p-z3"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-z2 text-sm font-medium text-ink">
        <span>
          {title} ({folders[stage].length})
        </span>
        {mayUpload ? (
          <label className="cursor-pointer text-sm font-medium text-accent hover:text-accent-hover">
            {busy === stage ? labels.uploading : labels.upload}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy !== null}
              onChange={(event) => {
                const files = event.target.files
                if (files && files.length > 0) void attach(stage, files)
              }}
            />
          </label>
        ) : null}
      </summary>
      {folders[stage].length === 0 ? (
        <p className="mt-z2 text-sm text-ink-3">{labels.empty}</p>
      ) : (
        <ul className="mt-z2 flex flex-col gap-z1">
          {folders[stage].map((photo) => (
            <li key={photo.id} className="flex items-baseline gap-z2 text-sm">
              <button
                type="button"
                onClick={() => open(photo.id)}
                className="font-mono text-ink underline decoration-border-strong underline-offset-2 hover:text-accent"
              >
                {photo.filename}
              </button>
              <span className="text-xs text-ink-3">{photo.uploadedAt}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <div className="mt-z3 flex flex-col gap-z2">
        {folder('PICKUP', labels.pickup)}
        {folder('DELIVERY', labels.delivery)}
      </div>
      {error ? (
        <p role="alert" className="mt-z2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
