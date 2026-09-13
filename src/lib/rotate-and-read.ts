import type { UploadResult, UploadTarget } from './upload-client'

// ---------------------------------------------------------------------------
// TURN A PARKED CARD UPRIGHT AND READ IT, WITHOUT ASKING FOR IT AGAIN.
//
// ── WHAT THIS COMPLETES ───────────────────────────────────────────────────
//
// Cancelling the rotation step keeps the card on the driver as "not read —
// needs rotation" (owner's ruling, 2026-09-12). Keeping it is only half an
// answer: the bytes are in the bucket and nobody can do anything with them
// except photograph the card a second time, which is the trip the whole
// feature exists to save.
//
// So: the stored object is fetched through a SIGNED GET, turned in the
// browser, and the turned image is POSTED AS A NEW OBJECT. The original is
// never overwritten — owner's ruling, 2026-09-13 — and the read runs against
// the rotated copy.
//
// ── WHY THE ORIGINAL IS LEFT ALONE ───────────────────────────────────────
//
// A document is evidence. DOT and FMCSA retention is statutory, the schema
// soft-deletes anything document-shaped for that reason, and a system that
// silently replaced the bytes somebody uploaded would be rewriting the record
// to make it more convenient to read. The rotated copy is a DERIVED artefact
// and is stored as one, beside the original rather than over it.
//
// ── WHY THE ORCHESTRATION IS HERE AND NOT IN THE COMPONENT ───────────────
//
// Standing rule: domain logic lives in `src/lib`. This one earns it twice
// over — every step is a call that can fail, the ORDER is the substance (a
// read that ran against the original would be the bug this is fixing), and an
// orchestration inside a click handler is one nobody can test without a
// browser. The dependencies are injected so the whole chain runs in the node
// project against a fake fetch.
// ---------------------------------------------------------------------------

export interface RotateAndReadDeps {
  /** Injected in tests. The real one is `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  /**
   * Apply the turns. The browser's canvas, in production.
   *
   * INJECTED RATHER THAN IMPORTED because it is the one step that genuinely
   * needs a DOM — and because a test that had to stand up a canvas to assert
   * the ORDER of four network calls would be testing the wrong thing.
   */
  rotate: (file: File, quarterTurns: number) => Promise<File>
  /** The mint/PUT/confirm dance. `uploadDocument` in production. */
  upload: (file: File, target: UploadTarget) => Promise<UploadResult>
}

export interface RotateAndReadInput {
  /** The parked document, which is read and never written. */
  documentId: string
  /** Whose page this is. The new object hangs off the same driver. */
  driverId: string
  /** What kind of document the new object is. Copied from the original. */
  documentType: string
  /** Clockwise quarter-turns the person chose. */
  quarterTurns: number
  /** Where the rotated copy is sent to be read. */
  readRoute: string
}

export type RotateAndReadOutcome =
  | { ok: true; rotatedDocumentId: string; status: number; body: string }
  | {
      ok: false
      /** Which step failed, so a notice can say something useful. */
      step: 'sign' | 'download' | 'upload' | 'read'
      status?: number
    }

/**
 * Fetch, turn, store as new, read.
 *
 * THE ORDER IS THE CONTRACT. The read must run against the ROTATED bytes: a
 * version of this that uploaded the rotation and then read the original would
 * pass every "did it upload" check and reproduce the exact defect the rotation
 * step exists to prevent — four invented examiner names, at high confidence.
 *
 * IT STOPS AT THE FIRST FAILURE. A download that 404s must not be followed by
 * an upload of nothing, and a failed upload must not be followed by a read
 * that would then be the only record of a rotation nobody can find again.
 */
export async function rotateAndRead(
  input: RotateAndReadInput,
  deps: RotateAndReadDeps,
): Promise<RotateAndReadOutcome> {
  const call = deps.fetchImpl ?? fetch

  // 1. A SIGNED URL, NOT THE BUCKET. The bucket is never public; this is the
  //    only way in, and it is minted behind the same permission check the
  //    document browser makes.
  const signedResponse = await call(
    `/api/documents/${input.documentId}/download-url`,
  )
  if (!signedResponse.ok) {
    return { ok: false, step: 'sign', status: signedResponse.status }
  }
  const signed = (await signedResponse.json()) as {
    url?: string
    filename?: string
  }
  if (!signed.url) return { ok: false, step: 'sign' }

  // 2. THE BYTES, from R2 directly. No worker in the path — the same shape the
  //    download link already takes.
  const objectResponse = await call(signed.url)
  if (!objectResponse.ok) {
    return { ok: false, step: 'download', status: objectResponse.status }
  }
  const blob = await objectResponse.blob()
  const original = new File([blob], signed.filename ?? 'document.jpg', {
    type: blob.type || 'image/jpeg',
  })

  // 3. TURNED IN THE BROWSER.
  const rotated = await deps.rotate(original, input.quarterTurns)

  // 4. STORED AS A NEW OBJECT. Never over the original — see the header.
  let uploaded: UploadResult
  try {
    uploaded = await deps.upload(rotated, {
      entity: 'driver',
      entityId: input.driverId,
      documentType: input.documentType,
    })
  } catch {
    return { ok: false, step: 'upload' }
  }

  // 5. AND READ FROM THE ROTATED COPY, which is the whole point.
  const body = new FormData()
  body.append('file', rotated)
  body.append('driverId', input.driverId)
  const readResponse = await call(input.readRoute, { method: 'POST', body })
  if (!readResponse.ok) {
    return { ok: false, step: 'read', status: readResponse.status }
  }

  return {
    ok: true,
    rotatedDocumentId: uploaded.documentId,
    status: readResponse.status,
    body: await readResponse.text(),
  }
}
