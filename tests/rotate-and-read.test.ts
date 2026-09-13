import { describe, expect, it, vi } from 'vitest'
import { rotateAndRead } from '@/lib/rotate-and-read'
import type { UploadTarget } from '@/lib/upload-client'

// ---------------------------------------------------------------------------
// THE ORDER IS THE SUBSTANCE.
//
// Every step here is a call that can fail, and the one that matters is the
// last: THE READ MUST RUN AGAINST THE ROTATED BYTES. A version that uploaded
// the rotation and then read the original would pass every "did it upload"
// check and reproduce the exact defect the rotation step exists to prevent —
// four invented examiner names across four reads, at high confidence, measured
// 2026-09-12.
//
// No DOM. The rotation is injected precisely so that asserting the order of
// four network calls does not require standing up a canvas.
// ---------------------------------------------------------------------------

const ORIGINAL_BYTES = new Uint8Array([1, 2, 3, 4])
const ROTATED_BYTES = new Uint8Array([9, 9, 9, 9])

const SIGNED_URL = 'https://r2.example.com/signed?sig=abc'

interface Call {
  url: string
  method: string
  body?: BodyInit | null
}

/** A fetch that answers the three URLs this orchestration knows about. */
function harness(
  over: {
    signStatus?: number
    objectStatus?: number
    readStatus?: number
  } = {},
) {
  const calls: Call[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ?? null })

    if (url.includes('/download-url')) {
      return new Response(
        JSON.stringify({ url: SIGNED_URL, filename: 'card.jpg' }),
        {
          status: over.signStatus ?? 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
    if (url === SIGNED_URL) {
      return new Response(ORIGINAL_BYTES as unknown as BodyInit, {
        status: over.objectStatus ?? 200,
        headers: { 'content-type': 'image/jpeg' },
      })
    }
    return new Response('{"proposal":{}}', { status: over.readStatus ?? 200 })
  }) as unknown as typeof fetch

  const rotate = vi.fn(
    async (_file: File, _turns: number) =>
      new File([ROTATED_BYTES], 'card.jpg', { type: 'image/jpeg' }),
  )
  const upload = vi.fn(async (_file: File, _target: UploadTarget) => ({
    documentId: 'doc-rotated',
    r2Key: 'org/driver/d1/rotated.jpg',
  }))

  return { calls, impl, rotate, upload }
}

const input = {
  documentId: 'doc-parked',
  driverId: 'driver-1',
  documentType: 'MEDICAL_CARD',
  quarterTurns: 3,
  readRoute: '/api/med/read',
}

describe('turning a parked card and reading it', () => {
  it('signs, downloads, rotates, stores a NEW object, then reads', async () => {
    const { calls, impl, rotate, upload } = harness()
    const outcome = await rotateAndRead(input, {
      fetchImpl: impl,
      rotate,
      upload,
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.rotatedDocumentId).toBe('doc-rotated')

    // THE SIGNED URL, NOT THE BUCKET. The bucket is never public.
    expect(calls[0]!.url).toBe('/api/documents/doc-parked/download-url')
    expect(calls[1]!.url).toBe(SIGNED_URL)
    expect(calls[2]!.url).toBe('/api/med/read')

    // The person's turns reached the rotation, unchanged.
    expect(rotate).toHaveBeenCalledTimes(1)
    expect(rotate.mock.calls[0]![1]).toBe(3)
  })

  it('reads the ROTATED bytes, never the original', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. Reading the original would upload a
    // correct rotation and then ask the engine to read a sideways card — the
    // defect that produced four different doctors.
    const { calls, impl, rotate, upload } = harness()
    await rotateAndRead(input, { fetchImpl: impl, rotate, upload })

    const read = calls.find((call) => call.url === '/api/med/read')
    const sent = (read!.body as FormData).get('file') as File
    const bytes = new Uint8Array(await sent.arrayBuffer())
    expect([...bytes]).toEqual([...ROTATED_BYTES])
    expect([...bytes]).not.toEqual([...ORIGINAL_BYTES])
  })

  it('uploads the ROTATED bytes as the new object', async () => {
    const { impl, rotate, upload } = harness()
    await rotateAndRead(input, { fetchImpl: impl, rotate, upload })

    const stored = upload.mock.calls[0]![0]
    const bytes = new Uint8Array(await stored.arrayBuffer())
    expect([...bytes]).toEqual([...ROTATED_BYTES])
  })

  it('never writes over the original — no PUT to its key', async () => {
    // THE ORIGINAL IS EVIDENCE. Document retention is statutory and the schema
    // soft-deletes for that reason; replacing the bytes somebody uploaded
    // would be rewriting the record to make it easier to read.
    const { calls, impl, rotate, upload } = harness()
    await rotateAndRead(input, { fetchImpl: impl, rotate, upload })

    expect(calls.every((call) => call.method !== 'PUT')).toBe(true)
    // And the new object hangs off the driver, not off the old document.
    expect(upload.mock.calls[0]![1]).toEqual({
      entity: 'driver',
      entityId: 'driver-1',
      documentType: 'MEDICAL_CARD',
    })
  })

  it('stops at a failed download rather than uploading nothing', async () => {
    const { impl, rotate, upload } = harness({ objectStatus: 404 })
    const outcome = await rotateAndRead(input, {
      fetchImpl: impl,
      rotate,
      upload,
    })

    expect(outcome).toEqual({ ok: false, step: 'download', status: 404 })
    expect(rotate).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('stops at a refused signature, naming the step', async () => {
    const { impl, rotate, upload } = harness({ signStatus: 403 })
    const outcome = await rotateAndRead(input, {
      fetchImpl: impl,
      rotate,
      upload,
    })
    expect(outcome).toEqual({ ok: false, step: 'sign', status: 403 })
    expect(upload).not.toHaveBeenCalled()
  })

  it('says the read failed without losing the stored copy', async () => {
    // The rotated object IS stored by then, and that is correct: somebody can
    // try the read again against a card that is now the right way up. What
    // must not happen is a success reported for a read that did not happen.
    const { impl, rotate, upload } = harness({ readStatus: 500 })
    const outcome = await rotateAndRead(input, {
      fetchImpl: impl,
      rotate,
      upload,
    })
    expect(outcome).toEqual({ ok: false, step: 'read', status: 500 })
    expect(upload).toHaveBeenCalledTimes(1)
  })
})
