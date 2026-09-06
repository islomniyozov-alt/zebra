import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-context'
import { can } from '@/lib/permissions'
import { DOCUMENT_TYPES, IMAGE_TYPES } from '@/lib/claude'
import { NOTHING_READ, cdlPrefill, readCdl } from '@/lib/cdl'
import { apiError, authFailureResponse } from '../../_lib/respond'

// POST /api/cdl/read — read a licence that belongs to nobody yet.
//
// ── WHY A ROUTE HANDLER AND NOT A SERVER ACTION ────────────────────────────
//
// The first version posted the file as base64 in a hidden field to a server
// action, and Next rejected the body at its 1MB default. Base64 inflates by
// 4/3, so the real ceiling on a dropped file was ~750KB: every phone photo
// failed, and the failure arrived as the generic error boundary with the
// exception only in the Worker log — `Error: Body exceeded 1 MB limit.`
//
// RAISING `serverActions.bodySizeLimit` WOULD HAVE FIXED IT AND WAS REFUSED.
// That setting is GLOBAL: it would make every server action in the application
// accept multi-megabyte bodies to solve one upload's problem, with workerd's
// own request ceiling behind it. A file upload that cannot use a presigned URL
// — because no driver exists to mint one against — is still a file upload, and
// a route handler is the honest shape for one. The limit belongs on this path
// and is stated below, where it can be reasoned about on its own.
//
// MULTIPART, NOT BASE64. The 4/3 inflation was pure cost: the bytes were
// encoded so they could ride in a form field, and a real upload does not need
// them to.
//
// NOTHING IS PERSISTED. The card is read and dropped. Filing it against the
// driver is a document upload against a driver that exists, which is the
// existing R2 path and belongs after the confirm step.
// ---------------------------------------------------------------------------

/**
 * What this path accepts, stated here rather than inherited.
 *
 * 8MB, and the number is a judgement rather than a limit somebody found: the
 * browser downscales images to 1600px before sending — a licence is legible
 * well below that — so an image arriving here is a few hundred kilobytes. The
 * headroom is for PDFs, which cannot be downscaled client-side and are the
 * only reason this is not much smaller.
 */
export const MAX_CDL_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  let session
  try {
    session = await requireSession()
  } catch (error) {
    // NOTHING LEAVES THIS ROUTE WITHOUT A RESPONSE. `authFailureResponse`
    // returns null for anything that is not an auth failure, and the first
    // version of this handler returned that null — which is not a Response,
    // and Next turns it into a 500 with an empty body. The same shape the
    // extract route already carries a note about: the worker knowing exactly
    // what happened and saying none of it.
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    console.error('[zebra.cdl] read failed before the session resolved', error)
    return apiError(500, 'unavailable', 'The licence could not be read.')
  }

  // THE SAME PERMISSION THE CREATE NEEDS. Reading a licence to prefill a form
  // the reader may not submit is work done for a refusal.
  if (!can(session, 'create', 'driver')) {
    return apiError(403, 'forbidden', 'You may not add drivers.')
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return apiError(400, 'invalid_body', 'Expected a file upload.')
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return apiError(400, 'no_file', 'No file arrived.')
  }
  if (!DOCUMENT_TYPES.has(file.type) && !IMAGE_TYPES.has(file.type)) {
    return apiError(415, 'wrong_type', 'That file is not a photo or a PDF.')
  }
  // CHECKED BEFORE THE BYTES ARE READ, and that ordering is the point: the
  // guard this replaces sat inside an action that a stricter check upstream
  // never let run. A limit is only a limit where nothing rejects first.
  if (file.size > MAX_CDL_BYTES) {
    return apiError(413, 'too_large', 'That file is too large to read.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }

  const outcome = await readCdl({
    base64: btoa(binary),
    mimeType: file.type,
  })

  // `not_implemented` IS A DISTINCT ANSWER from "read it and found nothing".
  // One means enter the driver by hand; the other means take a better
  // photograph. Collapsing them costs a dispatcher a second trip to the driver.
  if (!outcome.ok) {
    return NextResponse.json({
      values: cdlPrefill(NOTHING_READ),
      notice:
        outcome.reason === 'not_implemented'
          ? 'drivers.cdl.notReadingYet'
          : 'drivers.cdl.unreadable',
    })
  }

  return NextResponse.json({ values: cdlPrefill(outcome.fields), notice: null })
}
