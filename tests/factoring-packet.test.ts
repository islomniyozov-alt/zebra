import { describe, expect, it } from 'vitest'
import {
  REQUIRED_PACKET_DOCUMENTS,
  buildFactoringPacket,
  packetReadiness,
  type PacketDocument,
  type PacketPart,
} from '@/lib/factoring-packet'
import { renderInvoicePdf, remitToFor } from '@/lib/invoice-pdf'
import { jpegSize } from '@/lib/pdf'
import type { DocumentType } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE FACTORING PACKET, GRADED AGAINST DT-015981.
//
// The real packet, measured page by page before any of this was written:
//
//   page 1     the invoice, text
//   pages 2-4  three 960x1280 JPEG scans with no text layer
//   pages 5-8  the Werner rate confirmation, four pages
//
// Zebra's packet reproduces that ORDER — invoice, then the proof the freight
// moved, then the agreement it moved under — for one load in one PDF.
//
// THE ACCEPTANCE READS THE PDF BACK. Not "the function returned 5" but the
// bytes: how many `/Type /Page` objects are in the file, which of them carry
// an image, and what the invoice page actually says. A page count from the
// function that produced it is that function agreeing with itself.
// ---------------------------------------------------------------------------

const doc = (
  type: DocumentType,
  mimeType = 'application/pdf',
): PacketDocument => ({
  id: type,
  type,
  filename: `${type}.pdf`,
  mimeType,
})

/**
 * A JPEG small enough to inline and real enough to measure.
 *
 * Hand-built: SOI, an APP0, a SOF0 declaring 960x1280 — the dimensions of the
 * real packet's scans — then EOI. `jpegSize` reads its SOF exactly as it reads
 * a camera's.
 */
const jpeg = (width = 960, height = 1280): Uint8Array =>
  new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00, // APP0
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01, // SOF0
    0xff,
    0xd9, // EOI
  ])

const invoice = () =>
  renderInvoicePdf({
    invoiceNumber: 'INV-1042',
    issueDate: '2026-09-07',
    dueDate: '2026-10-07',
    termsDays: 30,
    carrier: {
      name: 'Dolphins Transport',
      dotNumber: '2544585',
      mcNumber: 'MC-885668',
    },
    billTo: {
      name: 'WERNER ENTERPRISES INC',
      address: 'PO BOX 45308, OMAHA, NE 68145-0308',
    },
    remitTo: remitToFor({
      company: { name: 'Dolphins Transport' },
      authorityFactor: {
        name: 'RTS Financial',
        remitAddressLine1: 'PO Box 840267',
        // THE LINE WERNER PRINTS AS `0`. It must not reach the page.
        remitAddressLine2: '0',
        remitCity: 'Dallas',
        remitState: 'TX',
        remitPostalCode: '75284-0267',
        noticeOfAssignment:
          'This invoice has been assigned to RTS Financial. Payment must be made to RTS Financial.',
      },
    }),
    lines: [{ description: 'Linehaul - FLAT', amountCents: 148806 }],
    subtotalCents: 148806,
    accessorialsCents: 0,
    totalCents: 148806,
  })

/** Every `/Type /Page` object in a rendered PDF. */
const pagesIn = (pdf: Uint8Array): number =>
  (new TextDecoder('latin1').decode(pdf).match(/\/Type\s*\/Page[^s]/g) ?? [])
    .length

const textOf = (pdf: Uint8Array): string =>
  [
    ...new TextDecoder('latin1')
      .decode(pdf)
      .matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g),
  ]
    .map((m) => m[1]!.replace(/\\([()\\])/g, '$1'))
    .join('\n')

describe('the button is disabled until all four pieces exist', () => {
  const all: PacketDocument[] = [
    doc('INVOICE_PDF'),
    doc('POD', 'image/jpeg'),
    doc('BOL'),
    doc('RATE_CONFIRMATION'),
  ]

  it('is ready when all four are there', () => {
    const readiness = packetReadiness(all)
    expect(readiness.ready).toBe(true)
    expect(readiness.missing).toEqual([])
    expect(readiness.because).toBeNull()
  })

  // ── EACH OF THE FOUR, WATCHED FAILING INDIVIDUALLY ──────────────────
  //
  // Four separate cases rather than one "some are missing", because the
  // disabled state has to NAME the piece — the one somebody has to go and get.
  for (const missing of REQUIRED_PACKET_DOCUMENTS) {
    it(`refuses, by name, when ${missing} is the only piece absent`, () => {
      const readiness = packetReadiness(all.filter((d) => d.type !== missing))
      expect(readiness.ready).toBe(false)
      expect(readiness.missing).toEqual([missing])
      expect(readiness.because).toContain(
        {
          INVOICE_PDF: 'the invoice',
          POD: 'the POD',
          BOL: 'the BOL',
          RATE_CONFIRMATION: 'the rate confirmation',
        }[missing],
      )
      expect(readiness.because).toContain('is missing')
    })
  }

  it('names every missing piece when several are absent', () => {
    const readiness = packetReadiness([doc('INVOICE_PDF')])
    expect(readiness.missing).toEqual(['POD', 'BOL', 'RATE_CONFIRMATION'])
    expect(readiness.because).toContain('the POD')
    expect(readiness.because).toContain('the BOL')
    expect(readiness.because).toContain('the rate confirmation')
    expect(readiness.because).toContain('are missing')
  })

  // A YARD DROP'S POD IS PHOTOGRAPHS. A rule that wanted a PDF would refuse
  // the only proof that exists for a whole class of freight.
  it('accepts an image as the POD', () => {
    expect(packetReadiness(all).ready).toBe(true)
    const asPdf = all.map((d) =>
      d.type === 'POD' ? doc('POD', 'application/pdf') : d,
    )
    expect(packetReadiness(asPdf).ready).toBe(true)
  })
})

describe('the packet, read back out of its own bytes', () => {
  const parts = (): PacketPart[] => [
    { type: 'POD', mimeType: 'image/jpeg', bytes: jpeg() },
    { type: 'POD', mimeType: 'image/jpeg', bytes: jpeg() },
    { type: 'BOL', mimeType: 'image/jpeg', bytes: jpeg() },
    {
      type: 'RATE_CONFIRMATION',
      mimeType: 'application/pdf',
      bytes: renderInvoicePdf({
        invoiceNumber: 'RATECON',
        issueDate: '2026-09-05',
        dueDate: '2026-10-05',
        termsDays: 30,
        carrier: { name: 'Werner Logistics' },
        billTo: { name: 'DOLPHINS TRANSPORT INC' },
        remitTo: { name: 'Werner', lines: [] },
        lines: [{ description: 'Route 2004467733', amountCents: 148806 }],
        subtotalCents: 148806,
        accessorialsCents: 0,
        totalCents: 148806,
      }),
    },
  ]

  it('builds one PDF whose page count and order match the artefact', () => {
    const built = buildFactoringPacket({
      invoicePdf: invoice(),
      parts: parts(),
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    // Invoice, three scans, one rate-confirmation page.
    expect(built.order).toEqual([
      'INVOICE_PDF',
      'POD',
      'POD',
      'BOL',
      'RATE_CONFIRMATION',
    ])
    expect(built.pageCount).toBe(5)

    // AND THE BYTES AGREE. A page count from the function that built it is
    // that function agreeing with itself.
    expect(pagesIn(built.pdf)).toBe(5)
    expect(
      (new TextDecoder('latin1').decode(built.pdf).match(/\/DCTDecode/g) ?? [])
        .length,
    ).toBe(3)
  })

  it('starts with the invoice and ends with the agreement', () => {
    const built = buildFactoringPacket({
      invoicePdf: invoice(),
      parts: parts(),
    })
    if (!built.ok) throw new Error('not built')
    expect(built.order[0]).toBe('INVOICE_PDF')
    expect(built.order[built.order.length - 1]).toBe('RATE_CONFIRMATION')
  })

  it('refuses to build when a piece is missing', () => {
    const built = buildFactoringPacket({
      invoicePdf: invoice(),
      parts: parts().filter((part) => part.type !== 'BOL'),
    })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.reason).toEqual({ kind: 'not_ready', missing: ['BOL'] })
  })

  it('refuses an image it cannot measure rather than emitting a broken page', () => {
    const built = buildFactoringPacket({
      invoicePdf: invoice(),
      parts: [
        ...parts(),
        {
          type: 'POD',
          mimeType: 'image/jpeg',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
    })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.reason.kind).toBe('unreadable_image')
  })
})

describe('the invoice, as printed', () => {
  const printed = textOf(invoice())

  it('carries the carrier, the broker and the factor', () => {
    expect(printed).toContain('Dolphins Transport')
    expect(printed).toContain('WERNER ENTERPRISES INC')
    expect(printed).toContain('RTS Financial')
  })

  it('prints the notice of assignment from the factor record', () => {
    expect(printed).toContain('assigned to RTS Financial')
  })

  it('prints terms 30 and a due date thirty days out', () => {
    expect(printed).toContain('2026-09-07')
    expect(printed).toContain('2026-10-07')
  })

  it('prints one charge row', () => {
    expect(printed).toContain('Linehaul - FLAT')
  })

  // ── THE `, 0,` BUG, NOT REPRODUCED ─────────────────────────────────────
  //
  // The fixture deliberately supplies `remitAddressLine2: '0'`, which is what
  // Werner's own invoice prints. It must not reach the page.
  it('never renders an empty address line as a zero', () => {
    expect(printed).toContain('PO Box 840267')
    expect(printed.split('\n')).not.toContain('0')
  })
})

describe('a jpeg measures itself', () => {
  it('reads the dimensions the real scans have', () => {
    expect(jpegSize(jpeg())).toEqual({ width: 960, height: 1280 })
  })

  // WATCHED FAILING. A measurer that returned a default would scale every
  // photograph by a wrong aspect ratio and nothing would say so.
  it('returns null for bytes that are not a JPEG', () => {
    expect(jpegSize(new Uint8Array([0, 1, 2, 3]))).toBeNull()
    expect(jpegSize(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})
