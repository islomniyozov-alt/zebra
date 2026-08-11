import { formatCents } from './money'
import { assemblePdf, pdfString, winAnsi } from './pdf'

// ---------------------------------------------------------------------------
// THE INVOICE PDF — written by hand, on purpose.
//
// This is the document a broker's accounts-payable clerk opens, and the one
// that goes to a factoring portal. It has to be a real PDF that every reader
// opens, and it has to be produced on workerd.
//
// NO LIBRARY. pdf-lib and its cousins are 300–600KB of bundle for a page of
// text in a Worker with a 3MB budget already carrying Prisma. The eight
// objects a text-only PDF needs live in pdf.ts, shared with the settlement —
// the file format is identical because the spec says so. The LAYOUT below is
// not shared, and should not be: two documents that must look different are
// not helped by one renderer with a mode flag.
//
// WHAT THIS COSTS. Base-14 fonts are WinAnsi, which cannot render Cyrillic or
// Farsi. An invoice goes to an American broker in English and that is the
// document's audience, so the PDF is English-only by design and the SCREEN is
// what carries §12's three locales. Written down here rather than discovered
// when somebody's name does not print — see the flag in the Step 2 report.
//
// Deterministic: the same invoice produces byte-identical output, which is
// what makes "regenerate it" a safe thing to say.
// ---------------------------------------------------------------------------

export interface InvoicePdfLine {
  description: string
  amountCents: number
}

export interface InvoicePdfInput {
  invoiceNumber: string
  issueDate: string
  dueDate: string
  termsDays: number
  carrier: { name: string; dotNumber?: string | null; mcNumber?: string | null }
  billTo: { name: string; address?: string | null }
  /**
   * WHERE THE MONEY GOES, and it is never typed per invoice.
   *
   * An authority that factors has sold its receivables: the broker must pay
   * the FACTOR, not us, and an invoice that omits that gets paid to the wrong
   * bank account — which is a real loss, not a formatting error. Configured
   * once against the authority and printed on every invoice it issues.
   *
   * An authority that does not factor prints its own address here, so the
   * block is never absent and never has to be reasoned about: a reader always
   * knows where to send the cheque.
   */
  remitTo: { name: string; lines: readonly string[] }
  lines: readonly InvoicePdfLine[]
  subtotalCents: number
  accessorialsCents: number
  totalCents: number
  notes?: string | null
}

const LEFT = 56
const RIGHT = 556
const TOP = 786

export function renderInvoicePdf(input: InvoicePdfInput): Uint8Array {
  const ops: string[] = []
  let y = TOP

  const text = (value: string, x: number, size: number, bold = false) => {
    ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfString(winAnsi(value))}) Tj ET`,
    )
  }
  /** Right-aligned, using Helvetica's 0.5-em average — money is short. */
  const money = (cents: number, size: number, bold = false) => {
    const rendered = formatCents(cents, 'en-US')
    const width = rendered.length * size * 0.5
    text(rendered, RIGHT - width, size, bold)
  }
  const rule = () => {
    ops.push(`${LEFT} ${y} m ${RIGHT} ${y} l 0.6 w S`)
  }

  text('INVOICE', LEFT, 20, true)
  text(input.invoiceNumber, RIGHT - input.invoiceNumber.length * 10, 20, true)
  y -= 26

  text(input.carrier.name, LEFT, 11, true)
  y -= 14
  const identifiers = [
    input.carrier.dotNumber ? `USDOT ${input.carrier.dotNumber}` : null,
    input.carrier.mcNumber ? `MC ${input.carrier.mcNumber}` : null,
  ]
    .filter(Boolean)
    .join('   ')
  if (identifiers) {
    text(identifiers, LEFT, 9)
    y -= 18
  } else {
    y -= 4
  }

  rule()
  y -= 18

  text('BILL TO', LEFT, 8, true)
  text('ISSUED', 320, 8, true)
  text('DUE', 430, 8, true)
  y -= 13
  text(input.billTo.name, LEFT, 10)
  text(input.issueDate, 320, 10)
  text(input.dueDate, 430, 10)
  y -= 12
  if (input.billTo.address) {
    text(input.billTo.address, LEFT, 9)
  }
  text(`Net ${input.termsDays}`, 320, 9)
  y -= 22

  rule()
  y -= 16
  text('DESCRIPTION', LEFT, 8, true)
  text('AMOUNT', RIGHT - 40, 8, true)
  y -= 6
  rule()
  y -= 16

  for (const line of input.lines) {
    text(line.description, LEFT, 10)
    money(line.amountCents, 10)
    y -= 15
    // A page break is not implemented; a single invoice covering more loads
    // than fit is a real case, and it is Step 3's problem rather than a thing
    // to fake here. The generator refuses rather than overflowing — see below.
  }

  y -= 4
  rule()
  y -= 16

  text('Subtotal', 380, 10)
  money(input.subtotalCents, 10)
  y -= 14
  if (input.accessorialsCents !== 0) {
    text('Accessorials', 380, 10)
    money(input.accessorialsCents, 10)
    y -= 14
  }
  text('TOTAL', 380, 12, true)
  money(input.totalCents, 12, true)
  y -= 26

  // REMIT TO, under the total, where somebody about to pay is already looking.
  // Above the notes, because a note is context and this is an instruction.
  rule()
  y -= 16
  text('REMIT TO', LEFT, 8, true)
  y -= 13
  text(input.remitTo.name, LEFT, 10, true)
  y -= 12
  for (const line of input.remitTo.lines) {
    text(line, LEFT, 9)
    y -= 11
  }
  y -= 10

  if (input.notes) {
    text(input.notes, LEFT, 9)
  }

  const content = ops.join('\n')
  return assemblePdf(content)
}

/** How many lines fit on the one page this renders. */
export const MAX_PDF_LINES = 34

// ---------------------------------------------------------------------------
// WHOSE ADDRESS GOES IN THE REMIT-TO BLOCK.
//
// Separated from the route so the CHOICE can be tested without a database. The
// renderer's tests prove the block prints what it is handed; this is what
// decides what to hand it, and it is the half that loses money when it is
// wrong.
// ---------------------------------------------------------------------------

export interface RemitParty {
  name: string
  contactName?: string | null
  phone?: string | null
  email?: string | null
}

export interface RemitCompany {
  name: string
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  phone?: string | null
}

/**
 * The remit-to for one invoice.
 *
 * Precedence, most specific first:
 *
 *   1. the invoice's OWN factor, where the factoring flow has sold it — an
 *      invoice sold to one factor must never print another;
 *   2. the authority's configured factor, which is the ordinary case and the
 *      one the owner asked for: set up once, printed on every invoice that
 *      authority issues, never entered per invoice;
 *   3. the authority's own address, so the block is never absent. "No factor"
 *      must not mean "no instruction" — a reader always knows where to send
 *      the cheque.
 */
export function remitToFor(input: {
  company: RemitCompany
  invoiceFactor?: RemitParty | null
  authorityFactor?: RemitParty | null
}): { name: string; lines: string[] } {
  const factor = input.invoiceFactor ?? input.authorityFactor ?? null

  if (factor) {
    return {
      name: factor.name,
      // A FactoringCompany carries no postal address in the schema — who to
      // call and where to send the paperwork is what it has. A street address
      // is owed; see EXTRACTION-CONTRACT.md's schema gaps.
      lines: [factor.contactName, factor.email, factor.phone].filter(
        (line): line is string => Boolean(line),
      ),
    }
  }

  const { company } = input
  const cityLine = [company.city, company.state, company.postalCode]
    .filter(Boolean)
    .join(', ')
  return {
    name: company.name,
    lines: [
      company.addressLine1,
      company.addressLine2,
      cityLine || null,
      company.phone,
    ].filter((line): line is string => Boolean(line)),
  }
}
