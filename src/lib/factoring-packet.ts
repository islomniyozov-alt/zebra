import { assemblePacketPdf, jpegSize, type PacketPage } from './pdf'
import type { DocumentType } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// ONE LOAD, ONE PDF, IN THE ORDER THE FACTOR EXPECTS IT.
//
// ── THE TRUTH SET IS DT-015981 ───────────────────────────────────────────
//
// `corpus/datatruck/DT-015981-documents.pdf`, measured page by page:
//
//   page 1     the invoice, text
//   pages 2-4  three 960x1280 JPEG scans, no text layer
//   pages 5-8  the Werner carrier rate confirmation, four pages
//
// So the packet order is INVOICE, then the proof of what happened, then the
// agreement it happened under. Zebra reproduces that order for one load.
//
// ── RENDERED ON DEMAND FROM IMMUTABLE ROWS ───────────────────────────────
//
// The Phase 3 rule. Nothing here stores a PDF: the packet is assembled from
// the invoice's own figures and the documents already on the load, every time
// it is asked for. A stored packet is a document that silently disagrees with
// the rows behind it the first time anything is corrected.
//
// ── POD ACCEPTS IMAGES, AND THAT IS NOT A CONCESSION ─────────────────────
//
// A yard drop's POD is phone photographs of the trailer — that is what pages
// 2-4 of the real packet are. A readiness rule that demanded a PDF would
// refuse the only proof that exists for a whole class of freight.
//
// ── FACTORING MONEY STAYS OUT ────────────────────────────────────────────
//
// No funded amount, no fee, no reserve, anywhere in this file. Filing sets the
// load to FILED_WITH_FACTOR and it stays there until a PERSON clicks PAID.
// ---------------------------------------------------------------------------

/** The four pieces a packet cannot be built without. */
export const REQUIRED_PACKET_DOCUMENTS = [
  'INVOICE_PDF',
  'POD',
  'BOL',
  'RATE_CONFIRMATION',
] as const

export type RequiredPacketDocument = (typeof REQUIRED_PACKET_DOCUMENTS)[number]

/** What a person is told when the button is disabled. */
export const PACKET_PIECE_LABEL: Record<RequiredPacketDocument, string> = {
  INVOICE_PDF: 'the invoice',
  POD: 'the POD',
  BOL: 'the BOL',
  RATE_CONFIRMATION: 'the rate confirmation',
}

/** A document on the load, as the readiness check needs it. */
export interface PacketDocument {
  id: string
  type: DocumentType
  filename: string
  mimeType: string
}

export interface PacketReadiness {
  ready: boolean
  /** Which of the four are absent, in the packet's own order. */
  missing: RequiredPacketDocument[]
  /**
   * The disabled state's sentence, naming the missing piece.
   *
   * NAMED, NEVER COUNTED. "3 of 4 documents" sends somebody to open the load
   * and work out which — and the one they are missing is the one they have to
   * go and get. Null when nothing is missing.
   */
  because: string | null
}

/**
 * Is this load ready to file?
 *
 * ── IMAGES COUNT AS A POD, PDFS COUNT AS EVERYTHING ─────────────────────
 *
 * The check is on the document's TYPE, not its format, with one exception
 * written down rather than implied: a POD may be an image and frequently is.
 * Nothing here inspects a rate confirmation's bytes, because a rate
 * confirmation that arrived as a photograph is still the agreement.
 */
export function packetReadiness(input: {
  documents: readonly PacketDocument[]
  /**
   * Whether an invoice covers this load.
   *
   * A ROW, NOT A STORED PDF, and that is the P3 rule rather than a shortcut.
   * The invoice page is rendered from immutable rows every time the packet is
   * asked for; a stored invoice PDF is a document that silently disagrees with
   * its own invoice the first time anything is corrected. So three of the four
   * pieces are documents and the fourth is an `Invoice`.
   */
  hasInvoice: boolean
}): PacketReadiness {
  const present = new Set<string>(input.documents.map((row) => row.type))
  if (input.hasInvoice) present.add('INVOICE_PDF')
  const missing = REQUIRED_PACKET_DOCUMENTS.filter(
    (required) => !present.has(required),
  )

  if (missing.length === 0) {
    return { ready: true, missing: [], because: null }
  }

  const names = missing.map((piece) => PACKET_PIECE_LABEL[piece])
  const listed =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`

  return {
    ready: false,
    missing: [...missing],
    because: `Cannot file yet — ${listed} ${missing.length === 1 ? 'is' : 'are'} missing.`,
  }
}

/** A document's bytes, fetched by the caller from object storage. */
export interface PacketPart {
  type: DocumentType
  mimeType: string
  bytes: Uint8Array
  /** Named in a refusal, so somebody knows which file to look at. */
  filename?: string
}

export type PacketRefusal =
  | { kind: 'not_ready'; missing: RequiredPacketDocument[] }
  | { kind: 'unreadable_image'; type: DocumentType }
  /**
   * A document is on the load and contributed no pages.
   *
   * ── SILENT WAS THE FIRST BEHAVIOUR AND IT WAS WRONG ───────────────────
   *
   * `contentStreamsOf` reads the PDFs this system writes — uncompressed, one
   * stream per page. A broker's rate confirmation is usually neither, so it
   * yielded nothing and the packet was assembled WITHOUT it: five pages
   * instead of the eight the real artefact carries, no error, and a factor
   * receiving a packet with no agreement in it.
   *
   * A packet that is missing the thing it is required to contain must refuse.
   * The load looked ready — the document is there — so nothing upstream could
   * have caught it; only the assembler knows how many pages it actually got.
   */
  | { kind: 'no_pages_from'; type: DocumentType; filename: string }

export type PacketOutcome =
  | { ok: true; pdf: Uint8Array; pageCount: number; order: DocumentType[] }
  | { ok: false; reason: PacketRefusal }

/**
 * THE ORDER, STATED ONCE. Invoice, then proof, then agreement.
 *
 * Taken from the real packet rather than invented: DT-015981 puts the invoice
 * first because it is what the factor is being asked to fund, the scans next
 * because they are the evidence the freight moved, and the rate confirmation
 * last because it is the contract somebody refers back to.
 */
const PACKET_ORDER: DocumentType[] = [
  'INVOICE_PDF',
  'POD',
  'BOL',
  'RATE_CONFIRMATION',
]

/**
 * Build the packet.
 *
 * `invoicePdf` is rendered by the caller through `renderInvoicePdf`, so this
 * file assembles and does not lay out — the same separation `pdf.ts` records
 * for the two documents that already existed.
 */
export function buildFactoringPacket(input: {
  invoicePdf: Uint8Array
  parts: readonly PacketPart[]
}): PacketOutcome {
  const documents: PacketDocument[] = input.parts.map((part, index) => ({
    id: String(index),
    type: part.type,
    filename: '',
    mimeType: part.mimeType,
  }))
  // The invoice always exists here: the caller rendered it. `hasInvoice` says
  // so rather than a synthetic document row pretending to be one.
  const readiness = packetReadiness({ documents, hasInvoice: true })
  if (!readiness.ready) {
    return {
      ok: false,
      reason: { kind: 'not_ready', missing: readiness.missing },
    }
  }

  const pages: PacketPage[] = []
  const order: DocumentType[] = []

  // THE INVOICE'S OWN PAGES, carried through as text rather than re-rendered.
  // `renderInvoicePdf` produces a single page today; splicing its content
  // stream keeps the packet honest if it ever produces more.
  for (const content of contentStreamsOf(input.invoicePdf)) {
    pages.push({ kind: 'text', content })
    order.push('INVOICE_PDF')
  }

  for (const type of PACKET_ORDER) {
    if (type === 'INVOICE_PDF') continue
    for (const part of input.parts.filter(
      (candidate) => candidate.type === type,
    )) {
      if (part.mimeType.startsWith('image/')) {
        if (!jpegSize(part.bytes)) {
          return { ok: false, reason: { kind: 'unreadable_image', type } }
        }
        pages.push({ kind: 'image', jpeg: part.bytes })
        order.push(type)
        continue
      }
      // A PDF part contributes its pages as text streams — and if it
      // contributes none, the packet REFUSES rather than shipping without it.
      const streams = contentStreamsOf(part.bytes)
      if (streams.length === 0) {
        return {
          ok: false,
          reason: {
            kind: 'no_pages_from',
            type,
            filename: part.filename ?? '',
          },
        }
      }
      for (const content of streams) {
        pages.push({ kind: 'text', content })
        order.push(type)
      }
    }
  }

  return {
    ok: true,
    pdf: assemblePacketPdf(pages),
    pageCount: pages.length,
    order,
  }
}

/**
 * The uncompressed content streams of a PDF this system wrote.
 *
 * NARROW ON PURPOSE. It reads the documents `pdf.ts` produces — uncompressed,
 * one stream per page — and nothing else. A general PDF importer would be a
 * parser for every file a broker ever emailed, which is a far larger promise
 * than a packet needs.
 *
 * ── AND ITS LIMIT IS A REFUSAL, NOT A SHORTFALL ─────────────────────────
 *
 * A part this cannot read contributes NO pages, and `buildFactoringPacket`
 * refuses on that rather than assembling a packet without it. The first
 * version let the page count carry the news, which meant a factor could
 * receive a packet whose rate confirmation was simply absent.
 *
 * EMBEDDING A FOREIGN PDF IS OWED — see MONEY-DESIGN.md §7. Until it is built,
 * a compressed or multi-stream rate confirmation cannot go in a packet at all,
 * and the refusal says so by name.
 */
export function contentStreamsOf(bytes: Uint8Array): string[] {
  const text = new TextDecoder('latin1').decode(bytes)
  const found: string[] = []
  const marker = /stream\r?\n/g
  let match
  while ((match = marker.exec(text)) !== null) {
    const start = match.index + match[0].length
    const end = text.indexOf('\nendstream', start)
    if (end === -1) continue
    const body = text.slice(start, end)
    // Only the text streams. An image stream is binary and is carried as an
    // image, never spliced into somebody else's page.
    if (/\bTj\b|\bTd\b|\bTf\b/.test(body)) found.push(body)
  }
  return found
}
