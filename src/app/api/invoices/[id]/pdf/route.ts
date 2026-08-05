import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { renderInvoicePdf } from '@/lib/invoice-pdf'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/invoices/{id}/pdf
//
// Rendered on demand rather than stored. The PDF is a pure function of rows
// that never change after issue — the lines are snapshots — so there is
// nothing to keep in R2 that could drift from the invoice it claims to be.
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
    const bytes = await withCurrentOrg('read', 'invoice', async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id },
        select: {
          invoiceNumber: true,
          issueDate: true,
          dueDate: true,
          termsDays: true,
          subtotalCents: true,
          accessorialsCents: true,
          totalCents: true,
          notes: true,
          company: {
            select: { name: true, dotNumber: true, mcNumber: true },
          },
          customer: { select: { name: true, billingEmail: true } },
          lines: {
            orderBy: { sortOrder: 'asc' },
            select: { description: true, amountCents: true },
          },
        },
      })
      if (!invoice) return null

      const day = (value: Date | null) =>
        value ? value.toISOString().slice(0, 10) : '—'

      return renderInvoicePdf({
        invoiceNumber: invoice.invoiceNumber,
        issueDate: day(invoice.issueDate),
        dueDate: day(invoice.dueDate),
        termsDays: invoice.termsDays,
        carrier: {
          name: invoice.company.name,
          dotNumber: invoice.company.dotNumber,
          mcNumber: invoice.company.mcNumber,
        },
        billTo: {
          name: invoice.customer.name,
          address: invoice.customer.billingEmail,
        },
        lines: invoice.lines,
        subtotalCents: invoice.subtotalCents,
        accessorialsCents: invoice.accessorialsCents,
        totalCents: invoice.totalCents,
        notes: invoice.notes,
      })
    })

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
