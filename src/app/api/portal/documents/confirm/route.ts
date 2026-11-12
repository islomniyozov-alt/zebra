import { NextResponse } from 'next/server'
import { requireSession, withCurrentOrg } from '@/lib/auth-context'
import { ConfirmError, confirmUpload } from '@/lib/documents'
import { ownPendingUpload } from '@/lib/portal-documents'
import { apiError, authFailureResponse, readJson } from '../../../_lib/respond'

// POST /api/portal/documents/confirm — the landed object becomes a Document
// row on the driver's own load, through the office's own `confirmUpload`
// (HEAD first, never a row pointing at nothing; a POD moves the load to POD
// received, AUTOMATIC, exactly as the office's upload does — so the office
// sees it on the load the same minute). The portal's gate: the pending
// upload must be one the driver minted onto a load they are on.

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
    const session = await requireSession()
    // THE OWN-LOAD CHECK, BEFORE THE HEAD. Its own short transaction; the R2
    // round trip inside confirmUpload stays outside any transaction, as that
    // function requires.
    const own = await withCurrentOrg('read', 'portal.document', (tx, current) =>
      ownPendingUpload(tx, current, pendingUploadId),
    )
    if (!own) return apiError(404, 'unknown_mint', 'No such pending upload.')

    const document = await confirmUpload(
      (fn) => withCurrentOrg('create', 'portal.document', fn),
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
