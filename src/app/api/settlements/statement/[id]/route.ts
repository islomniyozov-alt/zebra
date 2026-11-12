import { withCurrentOrg } from '@/lib/auth-context'
import { statementPdfFor } from '@/lib/statement-document'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/settlements/statement/{settlementId}
//
// The driver pay statement, in Datatruck's layout. Rendered on demand from the
// FROZEN rows — the load lines and deduction lines written at FINAL — and not
// recomputed, which is the difference between a document and a view.
//
// EVERY SETTLEMENT RENDERS, DRAFTS INCLUDED. Owner's ruling, 2026-09-30,
// reversing this route's own earlier one.
//
// It used to answer 409 for a draft: no number, lines thrown away and rebuilt
// on every refresh, so a PDF of one is a figure that will be different
// tomorrow. Every clause of that is still true — and it is an argument for
// SAYING SO ON THE SHEET rather than withholding it, because the people who
// print a draft are the ones checking it before it is posted.
//
// So a draft renders with DRAFT across the page and an empty Settlement line,
// and a settlement with no batch renders too, on its own frozen dates. There
// is no 409 left in this file.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    // ONE RENDERER FOR BOTH DOORS (Phase 7 step 2): the body that lived here
    // is `statementPdfFor`, which the driver portal's route calls under its
    // own gate. This file keeps the office's gate and the response.
    const bytes = await withCurrentOrg('read', 'settlement', (tx) =>
      statementPdfFor(tx, id),
    )

    if (bytes === null) return apiError(404, 'not_found', 'No such settlement.')

    return new Response(bytes as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline',
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    throw error
  }
}
