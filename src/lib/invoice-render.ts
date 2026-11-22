import { remitToFor, renderInvoicePdf } from './invoice-pdf'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// ONE INVOICE, ONE RENDERING.
//
// Moved out of `GET /api/invoices/{id}/pdf` when the broker load's invoice
// packet (TMS §7.14 item 5) needed the same page: two renderings of one
// invoice would be two documents that can disagree about the money. The
// route and the packet both call this.
//
// Rendered from rows, never stored: the lines are snapshots, so the PDF is a
// pure function of rows that do not change after issue.
// ---------------------------------------------------------------------------

/** The invoice's PDF, or null when there is no such invoice here. */
export async function invoicePdfFor(
  tx: TxClient,
  invoiceId: string,
): Promise<Uint8Array | null> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
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
      // The invoice's OWN factor, where the factoring flow has already sold
      // it. More specific than the authority's default and therefore
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
  // broker must pay the factor; an invoice that omits that gets paid into the
  // wrong account.
  //
  // The invoice's own factor wins where the factoring flow has set one, then
  // the authority's configured factor, then the authority's own address. The
  // block is never empty.
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
}
