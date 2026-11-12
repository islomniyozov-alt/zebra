import { NextResponse } from 'next/server'
import { withCurrentOrg } from '@/lib/auth-context'
import { mintDownloadUrl } from '@/lib/documents'
import { isOwnDocument, ownDriver } from '@/lib/portal'
import { apiError, authFailureResponse } from '../../../../_lib/respond'

// GET /api/portal/documents/{id}/download-url
//
// The portal's own door to the bucket (Phase 7 step 2). The operator's route
// asks `document:read` and the permission of the entity the document hangs
// off; a DRIVER holds neither. This one asks `portal.document:read` and THE
// OWN-DOCUMENTS PREDICATE — on the driver's own load, or filed under the
// driver — and a document outside it is a 404, not a 403, because the
// difference is the fact worth hiding.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const signed = await withCurrentOrg(
      'read',
      'portal.document',
      async (tx, session) => {
        const driver = await ownDriver(tx, session)
        if (!driver) return null
        if (!(await isOwnDocument(tx, driver.id, id))) return null
        return mintDownloadUrl(tx, id)
      },
    )

    if (!signed) return apiError(404, 'not_found', 'No such document.')

    return NextResponse.json({
      url: signed.url,
      filename: signed.filename,
      expiresAt: signed.expiresAt.toISOString(),
    })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    throw error
  }
}
