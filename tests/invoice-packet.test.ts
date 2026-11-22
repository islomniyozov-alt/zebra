import { describe, expect, it } from 'vitest'
import { renderInvoicePdf, remitToFor } from '@/lib/invoice-pdf'
import {
  MAX_PACKET_SOURCE_BYTES,
  buildInvoicePacket,
  orderSources,
  packetInputsHash,
  type InvoicePacketSource,
} from '@/lib/invoice-packet'

// ---------------------------------------------------------------------------
// BROKER-LOAD-BRIEF step 4 (TMS §7.14 item 5; R1, R4, R9). The sample is
// DT-018987's shape — three POD photographs, a one-page rate con, the invoice
// — built from synthetic inputs, because the corpus packet carries personal
// data and stays out of the repository. The fixtures are the factoring
// packet test's, copied rather than imported: a test file exports nothing.
// ---------------------------------------------------------------------------

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

const pagesIn = (pdf: Uint8Array): number =>
  (new TextDecoder('latin1').decode(pdf).match(/\/Type\s*\/Page[^s]/g) ?? [])
    .length

let seq = 0
const source = (
  type: string,
  mimeType: string,
  bytes: Uint8Array,
): InvoicePacketSource => ({
  type: type as InvoicePacketSource['type'],
  mimeType,
  bytes,
  filename: `${type}-${++seq}`,
  sha256: `sha-${type}-${seq}`,
})

const rateCon = () => {
  const pdf = invoice()
  return source('RATE_CONFIRMATION', 'application/pdf', pdf)
}

describe('the DT-018987 shape', () => {
  it('three POD photos, the rate con, the invoice: five pages, proof first', () => {
    // Given out of order, with paper that is not packet paper among it.
    const built = buildInvoicePacket({
      sources: [
        rateCon(),
        source('POD', 'image/jpeg', jpeg()),
        source('PHOTO', 'image/jpeg', jpeg()),
        source('POD', 'image/jpeg', jpeg()),
        source('LUMPER_RECEIPT', 'image/jpeg', jpeg()),
        source('POD', 'image/jpeg', jpeg()),
      ],
      invoicePdf: invoice(),
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.order).toEqual([
      'POD_PHOTO',
      'POD_PHOTO',
      'POD_PHOTO',
      'RATE_CONFIRMATION',
      'INVOICE',
    ])
    expect(built.pageCount).toBe(5)
    expect(pagesIn(built.pdf)).toBe(5)
  })

  it('a POD PDF and a BOL sit between the photos and the rate con', () => {
    const ordered = orderSources([
      { type: 'RATE_CONFIRMATION', mimeType: 'application/pdf' },
      { type: 'BOL', mimeType: 'image/jpeg' },
      { type: 'POD', mimeType: 'application/pdf' },
      { type: 'POD', mimeType: 'image/jpeg' },
    ])
    expect(ordered.map((row) => `${row.type} ${row.mimeType}`)).toEqual([
      'POD image/jpeg',
      'POD application/pdf',
      'BOL image/jpeg',
      'RATE_CONFIRMATION application/pdf',
    ])
  })

  it('no invoice yet: the packet is the paper alone', () => {
    const built = buildInvoicePacket({
      sources: [source('POD', 'image/jpeg', jpeg()), rateCon()],
      invoicePdf: null,
    })
    expect(built.ok && built.order).toEqual(['POD_PHOTO', 'RATE_CONFIRMATION'])
  })
})

describe('refusals, by name', () => {
  it('nothing to merge', () => {
    expect(
      buildInvoicePacket({
        sources: [source('PHOTO', 'image/jpeg', jpeg())],
        invoicePdf: invoice(),
      }),
    ).toEqual({ ok: false, reason: { kind: 'nothing_to_merge' } })
  })

  it('R9: over 20 MB of source, before anything is read', () => {
    const big = new Uint8Array(MAX_PACKET_SOURCE_BYTES) // not even a JPEG
    const built = buildInvoicePacket({
      sources: [source('POD', 'image/jpeg', big)],
      invoicePdf: invoice(),
    })
    expect(built.ok).toBe(false)
    expect(!built.ok && built.reason.kind).toBe('too_large')
  })

  it('a photo that is not a JPEG', () => {
    expect(
      buildInvoicePacket({
        sources: [source('POD', 'image/png', new Uint8Array([1, 2, 3]))],
        invoicePdf: null,
      }),
    ).toEqual({ ok: false, reason: { kind: 'unreadable_image', type: 'POD' } })
  })
})

describe('R4: a packet is its inputs', () => {
  it('the same inputs hash the same; order, content and invoice each change it', async () => {
    const base = await packetInputsHash(['a', 'b'], 'inv-1')
    expect(await packetInputsHash(['a', 'b'], 'inv-1')).toBe(base)
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    expect(await packetInputsHash(['b', 'a'], 'inv-1')).not.toBe(base)
    expect(await packetInputsHash(['a', 'c'], 'inv-1')).not.toBe(base)
    expect(await packetInputsHash(['a', 'b'], null)).not.toBe(base)
    expect(await packetInputsHash(['a', 'b'], 'inv-2')).not.toBe(base)
  })
})
