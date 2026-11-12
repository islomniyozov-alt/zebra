'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Select } from '@/components/ui/Select'
import { isNetworkFailure, newQueueId } from '@/lib/offline-queue'
import { enqueue } from '@/lib/offline-queue-store'
import {
  compressImage,
  PORTAL_ENDPOINTS,
  uploadDocument,
  type UploadPhase,
} from '@/lib/upload-client'

// CAMERA-FIRST UPLOAD (§9; Phase 7 step 5). **Take photo** is the primary
// control — 52 px, the camera opened directly by `capture="environment"` —
// and the file picker is secondary. The sequence is the office's own
// `uploadDocument`: compress on the device (a POD page from a phone camera is
// 8 MB before and under 1 MB after), hash, mint through the PORTAL's route,
// PUT straight to R2, confirm through the portal's route. Two visible states,
// preparing and uploading, because on one bar of signal a slow phone and a
// stalled upload call for different responses.
//
// ONE CAPTURE PER UPLOAD — ruled (flag 9, 2026-11-12): no assembler; a
// second page is a second upload of the same type, and the office sees them
// grouped by type on the load (§7.8).
//
// OFFLINE, THE CAPTURE IS KEPT (step 6; §9). If the phone says it is
// offline, or the upload dies before the office answers, the compressed
// bytes go to the phone's queue — under a megabyte, not the camera's 8 — and
// the shell replays them through the same mint → PUT → confirm. A refusal
// the office answered (a type it will not take, a load that is not the
// driver's) is shown here in words and never kept.

interface Props {
  loadId: string
  loadNumber: string
  types: { value: string; label: string }[]
  defaultType: string
  labels: {
    title: string
    hint: string
    type: string
    takePhoto: string
    chooseFile: string
    preparing: string
    uploading: string
    done: string
    queued: string
    failed: string
  }
}

type Phase = UploadPhase | 'queued'

export function CaptureUpload({
  loadId,
  loadNumber,
  types,
  defaultType,
  labels,
}: Props) {
  const router = useRouter()
  const [type, setType] = useState(defaultType)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = phase === 'preparing' || phase === 'uploading'

  const keep = async (file: File) => {
    setPhase('preparing')
    const prepared = await compressImage(file)
    await enqueue({
      kind: 'upload',
      id: newQueueId(),
      loadId,
      documentType: type,
      label: types.find((option) => option.value === type)?.label ?? type,
      filename: prepared.name,
      mimeType: prepared.type,
      bytes: prepared,
      queuedAt: new Date().toISOString(),
      failure: null,
    })
    setPhase('queued')
  }

  const send = async (file: File) => {
    setError(null)
    try {
      if (!navigator.onLine) {
        await keep(file)
        return
      }
      try {
        await uploadDocument(
          file,
          { entity: 'load', entityId: loadId, documentType: type },
          (progress) => setPhase(progress.phase),
          { endpoints: PORTAL_ENDPOINTS, mintBody: { loadId } },
        )
        router.refresh()
      } catch (failure) {
        if (!isNetworkFailure(failure)) throw failure
        await keep(file)
      }
    } catch (failure) {
      setPhase('failed')
      setError(failure instanceof Error ? failure.message : labels.failed)
    }
  }

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void send(file)
  }

  return (
    <section className="flex flex-col gap-z3 rounded-card border border-border bg-surface p-z4">
      <div>
        <h2 className="text-base font-medium">{labels.title}</h2>
        <p className="text-xs text-ink-3">
          <span dir="ltr">{loadNumber}</span> · {labels.hint}
        </p>
      </div>
      <Select
        name="documentType"
        label={labels.type}
        options={types}
        value={type}
        onChange={(event) => setType(event.target.value)}
        disabled={busy}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={onPick}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        className="sr-only"
        onChange={onPick}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => cameraRef.current?.click()}
        className="flex min-h-[52px] w-full items-center justify-center rounded-control bg-accent px-z4 text-base font-medium text-white disabled:opacity-60"
      >
        {phase === 'preparing'
          ? labels.preparing
          : phase === 'uploading'
            ? labels.uploading
            : labels.takePhoto}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="flex min-h-[44px] w-full items-center justify-center rounded-control border border-border-strong bg-surface px-z4 text-base font-medium text-ink disabled:opacity-60"
      >
        {labels.chooseFile}
      </button>
      {phase === 'done' && !error ? (
        <p role="status" className="text-sm text-ink-2">
          {labels.done}
        </p>
      ) : null}
      {phase === 'queued' && !error ? (
        <p
          role="status"
          className="rounded-card border border-border bg-warning-soft p-z3 text-sm text-ink"
        >
          {labels.queued}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
