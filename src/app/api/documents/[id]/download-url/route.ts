import { NextResponse } from 'next/server'
import { withCurrentOrg } from '@/lib/auth-context'
import { mintDownloadUrl } from '@/lib/documents'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/documents/{id}/download-url
//
// The bucket is never public, so this is the only way to read a document. The
// URL it returns is short-lived (60s) and minted only after the tenant-scoped
// lookup found the row — a document in another organization is a 404 here, not
// a 403, because the difference is the fact worth hiding.
//
// Returns the URL rather than redirecting to it: a redirect would put a signed
// R2 URL in the browser's history and in any referrer log along the way.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const signed = await withCurrentOrg('read', 'document', (tx) =>
      mintDownloadUrl(tx, id),
    )

    if (!signed) {
      return apiError(404, 'not_found', 'No such document.')
    }

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
