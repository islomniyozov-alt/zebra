import { NextResponse } from 'next/server'
import { withCurrentOrg } from '@/lib/auth-context'
import { can } from '@/lib/permissions'
import { supersedeDocument } from '@/lib/document-supersession'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// POST /api/documents/{id}/superseded-by  { documentId }
//
// Records that a better copy of this document exists — see
// `document-supersession.ts` for why that is a link and not a status change.
//
// THE PERMISSION IS THE ONE THAT MADE THE REPLACEMENT. Rotate-and-read is
// reachable only by somebody who may file compliance, and this is its last
// step; a weaker check here would let a reader who cannot act on a card
// silence the list that says somebody should.
//
// THE RULE IS NOT IN THIS FILE. A route reads the request, calls one function
// and answers — the standing rule, and it earns itself here: every refusal
// `supersedeDocument` makes is about rows, and testing those through an HTTP
// handler would mean standing up the whole auth context to assert that two ids
// name documents on different drivers.

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const body = (await request.json().catch(() => ({}))) as {
      documentId?: unknown
    }
    const replacementId =
      typeof body.documentId === 'string' ? body.documentId : null
    if (!replacementId) {
      return apiError(400, 'invalid_body', 'documentId is required.')
    }

    const outcome = await withCurrentOrg(
      'update',
      'document',
      async (tx, session) => {
        if (!can(session, 'create', 'compliance')) return null
        return supersedeDocument(tx, id, replacementId)
      },
    )

    if (outcome === null) {
      return apiError(403, 'forbidden', 'You may not file compliance records.')
    }
    if (!outcome.ok) {
      // NAMED, NOT COLLAPSED. "Could not link" sends somebody to look at the
      // wrong thing; `different_subject` says the two documents are not about
      // the same driver, which is a different mistake entirely.
      const status =
        outcome.reason === 'original_not_found' ||
        outcome.reason === 'replacement_not_found'
          ? 404
          : 400
      return apiError(status, outcome.reason, 'That link was refused.')
    }

    return NextResponse.json({ ok: true, alreadyLinked: outcome.alreadyLinked })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    console.error('[zebra.documents] superseded-by failed', error)
    return apiError(500, 'unavailable', 'That link could not be recorded.')
  }
}
