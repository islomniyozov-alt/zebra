import { NextResponse } from 'next/server'
import { withCurrentOrg } from '@/lib/auth-context'
import { mintDownloadUrl } from '@/lib/documents'
import { ENTITY_RESOURCE, entityOfDocument } from '@/lib/document-browser'
import { can } from '@/lib/permissions'
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
//
// `document:read` IS NOT ENOUGH, and was until Phase 4 step 6. A DISPATCHER
// holds it — they upload PODs all day — so with an id they could mint a URL for
// a settlement PDF, which is driver pay. The documents browser made that
// reachable by listing what exists, and a browser that hides a row while this
// endpoint still serves it is the CSS-hiding bug in a different coat. So the
// permission on the THING IT HANGS OFF is checked here too, from the same map
// the browser uses.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const signed = await withCurrentOrg(
      'read',
      'document',
      async (tx, session) => {
        const entity = await entityOfDocument(tx, id)
        // No entity means no permission covers it: not in this tenant, or
        // attached to nothing. Both are a 404 below.
        if (!entity) return null
        if (!can(session, 'read', ENTITY_RESOURCE[entity])) return null

        return mintDownloadUrl(tx, id)
      },
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
