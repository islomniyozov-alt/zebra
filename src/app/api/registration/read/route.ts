import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-context'
import { can } from '@/lib/permissions'
import { DOCUMENT_TYPES, IMAGE_TYPES } from '@/lib/claude'
import { readRegistration } from '@/lib/vehicle-registration'
import { apiError, authFailureResponse } from '../../_lib/respond'
import { recordUsageQuietly } from '../../_lib/record-usage'

// ---------------------------------------------------------------------------
// READ A REGISTRATION FOR ADD TRUCK / ADD TRAILER (TMS §6.5 part 4, v11.55).
//
// The type is STATED by the screen — the drop zone says "registration" — so
// there is no classifier here. It reads, judges and answers; it NEVER WRITES.
// The form fills from the answer and the person's Save is the write.
//
// WHO MAY ASK: whoever may add a truck or a trailer, because that is the only
// screen that sends here, and a read costs money — a role that cannot add a
// unit has no reason to spend one.
// ---------------------------------------------------------------------------

/** Stated here rather than inherited; the compliance read path's judgement. */
export const MAX_REGISTRATION_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  let session
  try {
    session = await requireSession()
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    console.error('[zebra.registration] read failed before the session', error)
    return apiError(500, 'unavailable', 'The document could not be read.')
  }

  if (!can(session, 'create', 'truck') && !can(session, 'create', 'trailer')) {
    return apiError(403, 'forbidden', 'You may not add trucks or trailers.')
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
  if (file.size > MAX_REGISTRATION_BYTES) {
    return apiError(413, 'too_large', 'That file is too large to read.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }

  const outcome = await readRegistration({
    base64: btoa(binary),
    mimeType: file.type,
  })
  if (!outcome.ok) {
    await recordUsageQuietly(outcome.cost, {
      documentType: 'REGISTRATION',
      refused: outcome.reason,
    })
    return NextResponse.json({
      reading: null,
      notice:
        outcome.reason === 'call_failed'
          ? 'fleet.registration.failed'
          : 'fleet.registration.unreadable',
    })
  }
  await recordUsageQuietly(outcome.cost, { documentType: 'REGISTRATION' })

  return NextResponse.json({
    reading: { verdicts: outcome.verdicts, prefill: outcome.prefill },
    notice: null,
  })
}
