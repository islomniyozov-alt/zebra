// ---------------------------------------------------------------------------
// THE PDF MACHINERY BOTH DOCUMENTS SHARE.
//
// Extracted when the settlement became the second hand-written PDF. What is
// here is the part that is identical because the FILE FORMAT says so — object
// numbering, byte offsets, the cross-reference table, the two base fonts. What
// is deliberately NOT here is layout: an invoice and a settlement have to look
// different, and one renderer with a mode flag would make them look the same
// while pretending otherwise.
//
// NO LIBRARY, and the reasoning has not changed since Step 2: pdf-lib and its
// cousins are 300-600KB of bundle for a page of text, in a Worker whose 3MB
// budget already carries Prisma.
//
// THE XREF IS THE PART THAT BREAKS. Every offset is the byte position of an
// object's header, and a reader that finds one wrong reports a corrupt file
// with no clue which. They are measured with TextEncoder rather than
// `String.length` because the two disagree the moment a single non-ASCII byte
// appears — and `winAnsi` keeps that from happening, which is belt and braces
// rather than redundancy: the test asserts the offsets independently.
//
// Deterministic: the same input produces byte-identical output, which is what
// makes "regenerate it" a safe thing to say about a financial document.
// ---------------------------------------------------------------------------

/** Escape the three characters that are structural inside a PDF string. */
export function pdfString(value: string): string {
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
export function winAnsi(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '?')
}

/**
 * Wrap a content stream in the eight objects a text-only PDF needs.
 *
 * F1 is Helvetica and F2 Helvetica-Bold — two of the fourteen base fonts every
 * conforming reader has built in, so nothing is embedded and the file stays a
 * few kilobytes.
 */
export function assemblePdf(content: string): Uint8Array {
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
