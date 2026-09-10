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

// ---------------------------------------------------------------------------
// A MULTI-PAGE PACKET, INCLUDING PAGES THAT ARE PHOTOGRAPHS.
//
// ── WHY `assemblePdf` COULD NOT BE REUSED ────────────────────────────────
//
// It writes one page, text only, and builds the file as a STRING. A factoring
// packet is eight pages on the real artefact and three of them are 960x1280
// JPEGs — a yard drop's POD is phone photos of the trailer, so the packet has
// to carry images or it cannot carry a POD at all.
//
// Bytes, not characters, for the same reason the xref is measured with
// TextEncoder: a JPEG put through a string is a JPEG with its high bytes
// rewritten. The assembler below works in `Uint8Array` throughout and the
// offsets are counted off the real buffer.
//
// ── THE IMAGE IS EMBEDDED, NOT RE-ENCODED ───────────────────────────────
//
// `/DCTDecode` hands the JPEG to the reader exactly as it arrived. Decoding
// and re-encoding it here would cost bundle, cost fidelity, and make the
// packet a different document from the photograph somebody took — which for
// a POD is the whole point of it.
// ---------------------------------------------------------------------------

/** One page of a packet: rendered text, or a photograph. */
export type PacketPage =
  | { kind: 'text'; content: string }
  | { kind: 'image'; jpeg: Uint8Array }

/**
 * A JPEG's pixel dimensions, from its own SOF marker.
 *
 * READ FROM THE FILE rather than taken as an argument. A caller that had to
 * supply them would be a caller that could supply the wrong ones, and a page
 * scaled by a wrong aspect ratio is a POD nobody can read.
 *
 * Returns null when the bytes are not a JPEG this can measure, so the caller
 * refuses rather than emitting a page of garbage.
 */
export function jpegSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++
      continue
    }
    const marker = bytes[at + 1]!
    // Every SOFn except the four that are not frame headers.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      const height = (bytes[at + 5]! << 8) | bytes[at + 6]!
      const width = (bytes[at + 7]! << 8) | bytes[at + 8]!
      return width > 0 && height > 0 ? { width, height } : null
    }
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!
    if (length < 2) return null
    at += 2 + length
  }
  return null
}

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792

export function assemblePacketPdf(pages: readonly PacketPage[]): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let length = 0
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
    return bytes.length
  }

  // Object numbering, decided up front so /Kids can name pages before they are
  // written. 1 catalog, 2 pages, 3 and 4 the fonts, then three objects per
  // page at most: the page, its content, and an image where there is one.
  const FIRST_PAGE_OBJECT = 5
  const perPage = pages.map((page, index) => {
    const base = FIRST_PAGE_OBJECT + index * 3
    return {
      page,
      pageObject: base,
      contentObject: base + 1,
      imageObject: page.kind === 'image' ? base + 2 : null,
    }
  })

  const bodies: string[] = []
  const binaries = new Map<number, Uint8Array>()

  bodies[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  bodies[2] = `<< /Type /Pages /Kids [${perPage
    .map((entry) => `${String(entry.pageObject)} 0 R`)
    .join(' ')}] /Count ${String(pages.length)} >>`
  bodies[3] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  bodies[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'

  for (const entry of perPage) {
    if (entry.page.kind === 'text') {
      const content = entry.page.content
      bodies[entry.pageObject] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${String(entry.contentObject)} 0 R >>`
      bodies[entry.contentObject] =
        `<< /Length ${String(encoder.encode(content).length)} >>\nstream\n${content}\nendstream`
      continue
    }

    const jpeg = entry.page.jpeg
    const size = jpegSize(jpeg)
    if (!size) throw new Error('a packet page is not a JPEG this can measure')

    // FITTED, NEVER STRETCHED. The scan is 960x1280 — taller than the page is
    // wide — and a photograph squashed to fill A4 is a POD an auditor cannot
    // read. The smaller ratio wins and the image is centred in what is left.
    const scale = Math.min(PAGE_WIDTH / size.width, PAGE_HEIGHT / size.height)
    const drawWidth = size.width * scale
    const drawHeight = size.height * scale
    const x = (PAGE_WIDTH - drawWidth) / 2
    const y = (PAGE_HEIGHT - drawHeight) / 2
    const content = `q ${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`

    bodies[entry.pageObject] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] ` +
      `/Resources << /XObject << /Im0 ${String(entry.imageObject!)} 0 R >> >> ` +
      `/Contents ${String(entry.contentObject)} 0 R >>`
    bodies[entry.contentObject] =
      `<< /Length ${String(encoder.encode(content).length)} >>\nstream\n${content}\nendstream`
    bodies[entry.imageObject!] =
      `<< /Type /XObject /Subtype /Image /Width ${String(size.width)} /Height ${String(size.height)} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${String(jpeg.length)} >>`
    binaries.set(entry.imageObject!, jpeg)
  }

  const count = bodies.length - 1
  push('%PDF-1.4\n')
  const offsets: number[] = []
  for (let number = 1; number <= count; number++) {
    offsets.push(length)
    const body = bodies[number] ?? '<< >>'
    push(`${String(number)} 0 obj\n${body}`)
    const binary = binaries.get(number)
    if (binary) {
      push('\nstream\n')
      push(binary)
      push('\nendstream')
    }
    push('\nendobj\n')
  }

  const xrefOffset = length
  push(`xref\n0 ${String(count + 1)}\n0000000000 65535 f \n`)
  for (const offset of offsets) {
    push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  }
  push(
    `trailer\n<< /Size ${String(count + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`,
  )

  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
