import { withCurrentOrg } from '@/lib/auth-context'
import { isOwnSettlement, ownDriver } from '@/lib/portal'
import { statementPdfFor } from '@/lib/statement-document'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/portal/statements/{settlementId}
//
// The driver's own statement PDF (Phase 7 step 2) — the same document the
// office sends, rendered by the same function (`statementPdfFor`, extracted
// from the operator's route so the two cannot drift), behind the portal's
// gate: `portal.settlement:read` and THE OWN-SETTLEMENTS PREDICATE, which is
// finalised only (§4.2). A DRAFT, or another driver's, is a 404.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const bytes = await withCurrentOrg(
      'read',
      'portal.settlement',
      async (tx, session) => {
        const driver = await ownDriver(tx, session)
        if (!driver) return null
        if (!(await isOwnSettlement(tx, driver.id, id))) return null
        return statementPdfFor(tx, id)
      },
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
