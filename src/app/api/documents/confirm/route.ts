import { NextResponse } from 'next/server'
import { requireSession, withCurrentOrg } from '@/lib/auth-context'
import { ConfirmError, confirmUpload } from '@/lib/documents'
import { apiError, authFailureResponse, readJson } from '../../_lib/respond'

// POST /api/documents/confirm — turn a landed object into a Document row.
//
// The HEAD inside confirmUpload is the load-bearing part. Confirm without it
// produces a row pointing at nothing, and the person who discovers that is
// whoever clicks the POD that proves delivery, mid-dispute.

interface Body {
  pendingUploadId?: unknown
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await readJson<Body>(request)
  if (!parsed.ok) return parsed.response

  const { pendingUploadId } = parsed.value
  if (typeof pendingUploadId !== 'string') {
    return apiError(400, 'invalid_body', 'pendingUploadId is required.')
  }

  try {
    // A RUNNER, NOT A TRANSACTION. `confirmUpload` asks R2 whether the object
    // really landed, and that HTTPS round trip must not sit inside a Postgres
    // transaction — see the note on the function.
    const session = await requireSession()
    const document = await confirmUpload(
      (fn) => withCurrentOrg('create', 'document', fn),
      session.organizationId,
      pendingUploadId,
      { uploadedByUserId: session.userId },
    )

    return NextResponse.json(document, { status: 201 })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure

    if (error instanceof ConfirmError) {
      const status = error.code === 'unknown_mint' ? 404 : 409
      return apiError(status, error.code, error.message)
    }
    throw error
  }
}
