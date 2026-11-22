import { assemblePacketPdf, type PacketPage } from './pdf'
import {
  partPages,
  type PacketPart,
  type PacketRefusal,
} from './factoring-packet'
import { importPdfPages } from './pdf-import'

// ---------------------------------------------------------------------------
// THE BROKER LOAD'S INVOICE PACKET (TMS §7.14 item 5; BROKER-LOAD-BRIEF step
// 4, rulings R1, R4, R9).
//
// ── THE TRUTH SET IS DT-018987 ───────────────────────────────────────────
//
// `corpus/datatruck/packet-DT-018987.pdf`, five pages: three POD photographs,
// each a full letter page, then the rate confirmation, then the invoice. So
// this order is PROOF FIRST — unlike the factoring packet (DT-015981), which
// leads with the invoice because the factor is being asked to fund it. Two
// packets, two readers, two orders; one page reader (`partPages`) between
// them so a file never reads differently in one than in the other.
//
// ── R1: THE HAND-WRITTEN ASSEMBLER, NO LIBRARY ───────────────────────────
//
// `assemblePacketPdf` already carries a JPEG as a page and a foreign PDF's
// pages whole. pdf-lib was refused in `pdf.ts` for bundle size on a Worker at
// its memory ceiling (GAPS 44).
//
// ── R9: 20 MB OF SOURCE, REFUSED BY NAME ABOVE IT ────────────────────────
//
// The isolate is 128 MB and the packet is built in it. The cap is on what
// goes IN, checked before a byte is assembled.
//
// ── R4: A PACKET IS ITS INPUTS ───────────────────────────────────────────
//
// `packetInputsHash` is the SHA-256 of each source's own hash in packet
// order, then the invoice id. The same inputs reuse the stored packet;
// changed inputs make a new one. Pure here; stored by the caller.
// ---------------------------------------------------------------------------

export const MAX_PACKET_SOURCE_BYTES = 20 * 1024 * 1024

/** The stages of the packet, in order. */
export const INVOICE_PACKET_ORDER = [
  'POD_PHOTO',
  'POD_PDF',
  'BOL',
  'RATE_CONFIRMATION',
  'INVOICE',
] as const

export type InvoicePacketStage = (typeof INVOICE_PACKET_ORDER)[number]

/** A source document as the packet sees it: its bytes and its own hash. */
export interface InvoicePacketSource extends PacketPart {
  /** The stored document's SHA-256 — its identity in `packetInputsHash`. */
  sha256: string
}

/** Which stage a source belongs to, or null when it is not packet paper. */
export function stageOf(source: {
  type: string
  mimeType: string
}): Exclude<InvoicePacketStage, 'INVOICE'> | null {
  if (source.type === 'POD') {
    return source.mimeType.startsWith('image/') ? 'POD_PHOTO' : 'POD_PDF'
  }
  if (source.type === 'BOL') return 'BOL'
  if (source.type === 'RATE_CONFIRMATION') return 'RATE_CONFIRMATION'
  return null
}

/** The sources in packet order; within a stage, as given (oldest first). */
export function orderSources<T extends { type: string; mimeType: string }>(
  sources: readonly T[],
): T[] {
  const rank = (source: T) => {
    const stage = stageOf(source)
    return stage === null ? -1 : INVOICE_PACKET_ORDER.indexOf(stage)
  }
  return sources
    .map((source, index) => ({ source, index, rank: rank(source) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.source)
}

/** R4 — the packet's identity: its inputs' hashes in order, then the invoice. */
export async function packetInputsHash(
  orderedSha256: readonly string[],
  invoiceId: string | null,
): Promise<string> {
  const text = [...orderedSha256, `invoice:${invoiceId ?? ''}`].join('\n')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export type InvoicePacketRefusal =
  | PacketRefusal
  | { kind: 'nothing_to_merge' }
  | { kind: 'too_large'; bytes: number; limit: number }

export type InvoicePacketOutcome =
  | {
      ok: true
      pdf: Uint8Array
      pageCount: number
      order: InvoicePacketStage[]
    }
  | { ok: false; reason: InvoicePacketRefusal }

/**
 * Build the packet from sources already fetched and the invoice PDF when one
 * exists. Sources that are not packet paper are ignored; order is decided
 * here, not by the caller.
 */
export function buildInvoicePacket(input: {
  sources: readonly InvoicePacketSource[]
  invoicePdf: Uint8Array | null
}): InvoicePacketOutcome {
  const ordered = orderSources(input.sources)
  if (ordered.length === 0) {
    return { ok: false, reason: { kind: 'nothing_to_merge' } }
  }
  const bytes =
    ordered.reduce((sum, source) => sum + source.bytes.byteLength, 0) +
    (input.invoicePdf?.byteLength ?? 0)
  if (bytes > MAX_PACKET_SOURCE_BYTES) {
    return {
      ok: false,
      reason: { kind: 'too_large', bytes, limit: MAX_PACKET_SOURCE_BYTES },
    }
  }

  const pages: PacketPage[] = []
  const order: InvoicePacketStage[] = []
  for (const source of ordered) {
    const read = partPages(source)
    if (!read.ok) return read
    for (const page of read.pages) {
      pages.push(page)
      order.push(stageOf(source)!)
    }
  }

  if (input.invoicePdf) {
    const invoice = importPdfPages(input.invoicePdf)
    if (!invoice.ok) {
      return {
        ok: false,
        reason: {
          kind: 'unimportable',
          type: 'INVOICE_PDF',
          filename: 'invoice.pdf',
          why: invoice.reason.kind,
        },
      }
    }
    for (let page = 0; page < invoice.document.pages.length; page++) {
      pages.push({ kind: 'imported', document: invoice.document, page })
      order.push('INVOICE')
    }
  }

  return {
    ok: true,
    pdf: assemblePacketPdf(pages),
    pageCount: pages.length,
    order,
  }
}
