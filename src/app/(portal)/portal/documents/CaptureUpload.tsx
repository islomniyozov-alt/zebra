'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Select } from '@/components/ui/Select'
import { isNetworkFailure, newQueueId } from '@/lib/offline-queue'
import { enqueue } from '@/lib/offline-queue-store'
import {
  MAX_PAGES,
  photoPagesRefusalKey,
  type PhotoPagesRefusal,
} from '@/lib/photo-pages'
import {
  compressImage,
  photosAsDocument,
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
// SEVERAL PHOTOS, ONE DOCUMENT (§9 v11.50, owner's ruling 2026-11-23, which
// overturns flag 9's "one capture per upload"). Take photo adds a page; Add
// another page takes the next; Send sends them. One page goes as the photo it
// is; two or more are assembled HERE, on the phone, into one PDF
// (`photosAsDocument`, `pdf.ts`'s own writer) and go up as one Document, so
// the reader reads every page and the office sees one row. A PDF picked from
// the files is sent as it is, and never merged with photos.
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
    addPage: string
    send: string
    /** "Send {n} pages". */
    sendPages: string
    /** "Pages: {n} of {max}". */
    pages: string
    removePage: string
    pageErrors: Record<
      ReturnType<typeof photoPagesRefusalKey> | 'pages.error.pdfAmong',
      string
    >
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
  /** The photos taken for the document being built, in the order taken. */
  const [pages, setPages] = useState<File[]>([])
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

  /** True when the document left the phone or was kept for later. */
  const send = async (file: File): Promise<boolean> => {
    setError(null)
    try {
      if (!navigator.onLine) {
        await keep(file)
        return true
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
      return true
    } catch (failure) {
      setPhase('failed')
      setError(failure instanceof Error ? failure.message : labels.failed)
      return false
    }
  }

  const refuse = (reason: PhotoPagesRefusal | 'pdf_among') => {
    setPhase('failed')
    setError(
      labels.pageErrors[
        reason === 'pdf_among'
          ? 'pages.error.pdfAmong'
          : photoPagesRefusalKey(reason)
      ],
    )
  }

  // The pages are cleared only once the document has left the phone or been
  // kept, so a refusal never costs the driver the photos already taken.
  const sendPages = async () => {
    setError(null)
    setPhase('preparing')
    let built: Awaited<ReturnType<typeof photosAsDocument>>
    try {
      built = await photosAsDocument(pages)
    } catch (failure) {
      setPhase('failed')
      setError(failure instanceof Error ? failure.message : labels.failed)
      return
    }
    if (!built.ok) {
      refuse(built.reason)
      return
    }
    if (await send(built.file)) setPages([])
  }

  const addPages = (files: readonly File[]) => {
    setError(null)
    if (pages.length + files.length > MAX_PAGES) {
      refuse('too_many_pages')
      return
    }
    if (!busy) setPhase('idle')
    setPages((current) => [...current, ...files])
  }

  const onCamera = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) addPages([file])
  }

  // A PDF picked on its own goes as it is; photos picked join the pages; a PDF
  // among photos, or onto pages already taken, is refused by name — pages are
  // never merged into somebody else's PDF.
  const onFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    if (files.some((file) => !file.type.startsWith('image/'))) {
      if (files.length === 1 && pages.length === 0) void send(files[0]!)
      else refuse('pdf_among')
      return
    }
    addPages(files)
  }

  const working =
    phase === 'preparing'
      ? labels.preparing
      : phase === 'uploading'
        ? labels.uploading
        : null

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
        onChange={onCamera}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        multiple
        className="sr-only"
        onChange={onFiles}
      />
      {pages.length === 0 ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          className="flex min-h-[52px] w-full items-center justify-center rounded-control bg-accent px-z4 text-base font-medium text-white disabled:opacity-60"
        >
          {working ?? labels.takePhoto}
        </button>
      ) : (
        <>
          <p role="status" className="text-sm text-ink-2">
            {labels.pages
              .replace('{n}', String(pages.length))
              .replace('{max}', String(MAX_PAGES))}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void sendPages()}
            className="flex min-h-[52px] w-full items-center justify-center rounded-control bg-accent px-z4 text-base font-medium text-white disabled:opacity-60"
          >
            {working ??
              (pages.length === 1
                ? labels.send
                : labels.sendPages.replace('{n}', String(pages.length)))}
          </button>
          <button
            type="button"
            disabled={busy || pages.length >= MAX_PAGES}
            onClick={() => cameraRef.current?.click()}
            className="flex min-h-[44px] w-full items-center justify-center rounded-control border border-border-strong bg-surface px-z4 text-base font-medium text-ink disabled:opacity-60"
          >
            {labels.addPage}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPages((current) => current.slice(0, -1))}
            className="min-h-[44px] text-sm text-ink-2 underline decoration-border-strong underline-offset-2 disabled:opacity-60"
          >
            {labels.removePage}
          </button>
        </>
      )}
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
