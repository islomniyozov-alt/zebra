import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { remitToFor, renderInvoicePdf } from '@/lib/invoice-pdf'
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
          companyId: true,
          company: {
            select: {
              name: true,
              dotNumber: true,
              mcNumber: true,
              addressLine1: true,
              addressLine2: true,
              city: true,
              state: true,
              postalCode: true,
              phone: true,
            },
          },
          // The invoice's OWN factor, where the factoring flow has already
          // sold it. More specific than the authority's default and therefore
          // preferred — an invoice sold to one factor must not print another.
          factoringCompany: {
            select: {
              name: true,
              contactName: true,
              phone: true,
              email: true,
              remitAddressLine1: true,
              remitAddressLine2: true,
              remitCity: true,
              remitState: true,
              remitPostalCode: true,
            },
          },
          customer: { select: { name: true, billingEmail: true } },
          lines: {
            orderBy: { sortOrder: 'asc' },
            select: { description: true, amountCents: true },
          },
        },
      })
      if (!invoice) return null

      // REMIT TO — configured once against the authority, never entered per
      // invoice. An authority that factors has SOLD its receivables and the
      // broker must pay the factor; an invoice that omits that gets paid into
      // the wrong account.
      //
      // The invoice's own factor wins where the factoring flow has set one,
      // then the authority's configured factor, then the authority's own
      // address. The block is never empty.
      const authorityFactor = invoice.factoringCompany
        ? null
        : await tx.factoringCompany.findFirst({
            where: { companyId: invoice.companyId, deletedAt: null },
            orderBy: { createdAt: 'asc' },
            select: {
              name: true,
              contactName: true,
              phone: true,
              email: true,
              remitAddressLine1: true,
              remitAddressLine2: true,
              remitCity: true,
              remitState: true,
              remitPostalCode: true,
            },
          })

      const remitTo = remitToFor({
        company: invoice.company,
        invoiceFactor: invoice.factoringCompany,
        authorityFactor,
      })

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
        remitTo,
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
