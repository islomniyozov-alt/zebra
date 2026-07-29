import { NextResponse } from 'next/server'
import { withCurrentOrg } from '@/lib/auth-context'
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
    const document = await withCurrentOrg('create', 'document', (tx, session) =>
      confirmUpload(tx, session.organizationId, pendingUploadId, {
        uploadedByUserId: session.userId,
      }),
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
