// ---------------------------------------------------------------------------
// THE BROWSER HALF OF AN UPLOAD: compress → hash → mint → PUT.
//
// The order is not arbitrary, and every step depends on the one before it:
//
//   COMPRESS  first, because the bytes change. A phone camera produces 8MB of
//             JPEG for a page of a POD; the driver is standing in a yard on
//             one bar of signal. Compressing after hashing would invalidate
//             the hash, and compressing after minting would invalidate the
//             signature, because the URL is bound to an exact length and an
//             exact digest.
//   HASH      of the FINAL bytes. This is what the presigned PUT is signed
//             against, so it has to be the thing that gets uploaded.
//   MINT      the URL, declaring that length, type and digest. The server
//             authorises here — the URL is a capability the moment it exists.
//   PUT       straight to R2. The file never passes through the Worker.
//
// TWO VISIBLE STATES, and they are distinct on purpose. "Preparing" covers
// compress and hash: local CPU work on a phone, which on a big scan is several
// seconds of a frozen-looking screen. "Uploading" covers the network. Merging
// them into one spinner means a driver on bad signal cannot tell a slow phone
// from a stalled upload, and the two call for completely different responses —
// wait, versus walk twenty feet toward the window.
//
// No UI here. §9 says plumbing only, and Phase 1 ships no upload screen. This
// is the state machine that screen will drive, so that when it is built the
// sequence is not reinvented in a component.
// ---------------------------------------------------------------------------

export type UploadPhase = 'idle' | 'preparing' | 'uploading' | 'done' | 'failed'

export interface UploadProgress {
  phase: UploadPhase
  /** 0–1 through the current phase, where the phase can report it. */
  fraction: number
}

export interface UploadTarget {
  entity: string
  entityId: string
  documentType: string
  /**
   * Park the document as NOT READ, for a named reason.
   *
   * `NEEDS_ROTATION` only, and the server ignores anything else — a client may
   * say nobody read this, never that somebody did.
   *
   * The cancel path of the rotation step sets it (owner's ruling,
   * 2026-09-12): the card is kept rather than dropped, so it lands on the
   * driver as work outstanding instead of disappearing.
   */
  unread?: 'NEEDS_ROTATION'
}

export interface UploadResult {
  documentId: string
  r2Key: string
}

export interface CompressionOptions {
  /** Longest edge, in pixels. Beyond this a scan gains size, not legibility. */
  maxDimension: number
  /** JPEG quality. 0.82 is where a page of text stops improving visibly. */
  quality: number
}

const DEFAULT_COMPRESSION: CompressionOptions = {
  maxDimension: 2400,
  quality: 0.82,
}

/**
 * Shrink an image before it leaves the device. PDFs pass through untouched —
 * re-encoding one loses its text layer, and the text layer is what makes a
 * rate confirmation searchable.
 */
export async function compressImage(
  file: File,
  options: CompressionOptions = DEFAULT_COMPRESSION,
): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(
    1,
    options.maxDimension / Math.max(bitmap.width, bitmap.height),
  )

  // Already small enough. Re-encoding would cost quality for nothing.
  if (scale === 1 && file.size < 1_500_000) {
    bitmap.close()
    return file
  }

  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  )
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    return file
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await canvas.convertToBlob({
    type: 'image/jpeg',
    quality: options.quality,
  })

  // If compression made it bigger — already-optimised JPEGs sometimes do —
  // keep the original. The point is fewer bytes over a bad link.
  if (blob.size >= file.size) return file

  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
    type: 'image/jpeg',
  })
}

/** Base64 SHA-256 of the exact bytes, which is what the PUT is signed against. */
export async function digestOf(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  let binary = ''
  for (const byte of new Uint8Array(hash)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

interface MintResponse {
  pendingUploadId: string
  url: string
  headers: Record<string, string>
}

/**
 * The whole sequence, reporting each phase as it starts.
 *
 * `onProgress` is called at every transition so a component can render
 * "Preparing" and "Uploading" as two different things without knowing why they
 * are two different things.
 */
export async function uploadDocument(
  file: File,
  target: UploadTarget,
  onProgress: (progress: UploadProgress) => void = () => {},
  options: { compression?: CompressionOptions; signal?: AbortSignal } = {},
): Promise<UploadResult> {
  try {
    // --- preparing: local CPU, no network yet ------------------------------
    onProgress({ phase: 'preparing', fraction: 0 })
    const prepared = await compressImage(
      file,
      options.compression ?? DEFAULT_COMPRESSION,
    )
    onProgress({ phase: 'preparing', fraction: 0.5 })
    const sha256 = await digestOf(prepared)
    onProgress({ phase: 'preparing', fraction: 1 })

    const mintResponse = await fetch('/api/documents/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(options.signal ? { signal: options.signal } : {}),
      body: JSON.stringify({
        entity: target.entity,
        entityId: target.entityId,
        filename: prepared.name,
        mimeType: prepared.type,
        sizeBytes: prepared.size,
        sha256,
        documentType: target.documentType,
        ...(target.unread ? { unread: target.unread } : {}),
      }),
    })

    if (!mintResponse.ok) {
      throw new Error(`Could not start the upload (${mintResponse.status}).`)
    }
    const minted = (await mintResponse.json()) as MintResponse

    // --- uploading: the network, and the only slow part on a good phone ----
    onProgress({ phase: 'uploading', fraction: 0 })
    const put = await fetch(minted.url, {
      method: 'PUT',
      // Verbatim. The signature covers these, so changing or dropping one is
      // a 403 from R2 before a byte is stored.
      headers: minted.headers,
      body: prepared,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!put.ok) {
      throw new Error(`The file was refused by storage (${put.status}).`)
    }
    onProgress({ phase: 'uploading', fraction: 1 })

    const confirmResponse = await fetch('/api/documents/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(options.signal ? { signal: options.signal } : {}),
      body: JSON.stringify({ pendingUploadId: minted.pendingUploadId }),
    })
    if (!confirmResponse.ok) {
      // The object is in R2 but no Document row exists. That is the tolerated
      // side of the phantom-row ruling: an orphan object, never a row pointing
      // at nothing. Reconciliation sweeps it.
      throw new Error(`The upload did not finish (${confirmResponse.status}).`)
    }

    const result = (await confirmResponse.json()) as UploadResult
    onProgress({ phase: 'done', fraction: 1 })
    return result
  } catch (error) {
    onProgress({ phase: 'failed', fraction: 0 })
    throw error
  }
}
