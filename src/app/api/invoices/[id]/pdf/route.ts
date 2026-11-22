import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { invoicePdfFor } from '@/lib/invoice-render'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/invoices/{id}/pdf
//
// Rendered on demand rather than stored. The PDF is a pure function of rows
// that never change after issue — the lines are snapshots — so there is
// nothing to keep in R2 that could drift from the invoice it claims to be.
// The rendering is `invoicePdfFor`, which the broker load's invoice packet
// reads too: one invoice, one page.
//
// An invoice in another organization is a 404, not a 403: the difference is
// the fact worth hiding.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const { locale } = await getLocaleContext()
    const bytes = await withCurrentOrg('read', 'invoice', (tx) =>
      invoicePdfFor(tx, id),
    )

    if (!bytes) return apiError(404, 'not_found', 'No such invoice.')

    // `locale` is read above and deliberately unused: the document is
    // English-only because base-14 fonts are WinAnsi. Named rather than
    // silently absent — see the flag on src/lib/invoice-pdf.ts.
    void locale

    return new Response(bytes as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline',
        // Never cached by a shared cache: an invoice is tenant data behind a
        // permission check, and a CDN holding one is a leak waiting for a
        // second reader.
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    throw error
  }
}
