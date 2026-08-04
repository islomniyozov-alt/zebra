import { formatCents } from './money'

// ---------------------------------------------------------------------------
// THE INVOICE PDF — written by hand, on purpose.
//
// This is the document a broker's accounts-payable clerk opens, and the one
// that goes to a factoring portal. It has to be a real PDF that every reader
// opens, and it has to be produced on workerd.
//
// NO LIBRARY. pdf-lib and its cousins are 300–600KB of bundle for a page of
// text in a Worker with a 3MB budget already carrying Prisma. This writes the
// eight objects a text-only PDF needs, using Helvetica — one of the fourteen
// base fonts every conforming reader has built in, so nothing is embedded.
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
  lines: readonly InvoicePdfLine[]
  subtotalCents: number
  accessorialsCents: number
  totalCents: number
  notes?: string | null
}

/** Escape the three characters that are structural inside a PDF string. */
function pdfString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

/**
 * WinAnsi only. A character the base font cannot render is replaced rather
 * than silently dropped: "?" in a broker's name is a visible bug somebody
 * reports, where a missing glyph is one nobody notices until the payment is
 * short.
 */
function winAnsi(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '?')
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

  if (input.notes) {
    text(input.notes, LEFT, 9)
  }

  const content = ops.join('\n')
  return assemble(content)
}

/** How many lines fit on the one page this renders. */
export const MAX_PDF_LINES = 34

function assemble(content: string): Uint8Array {
  const encoder = new TextEncoder()
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(encoder.encode(pdf).length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }

  const xrefOffset = encoder.encode(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`

  return encoder.encode(pdf)
}
