import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { invoicePacketRefusalDetail } from '@/lib/invoice-packet-store'

// ---------------------------------------------------------------------------
// MERGE DOWNLOAD, the parts that read source (TMS §7.14 item 5; step 4b). The
// store itself is proven against Postgres in
// tests/integration/invoice-packet-store.test.ts.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, 'utf8')

describe('the route', () => {
  const route = read('src/app/api/loads/[id]/invoice-packet/route.ts')

  it('reads under load.financials and stores under document:create', () => {
    expect(route).toContain(
      "read: (fn) => withCurrentOrg('read', 'load.financials', (tx) => fn(tx)),",
    )
    expect(route).toMatch(
      /write: \(fn\) =>\s*withCurrentOrg\('create', 'document', \(tx, session\) =>\s*fn\(tx, session\.userId\),/,
    )
  })

  it('touches R2 only through the io, outside both transactions', () => {
    expect(route).toContain('fetchBytes: (key) => objectBytes(config, key),')
    // The enforcer is in r2.ts: each call refuses inside a transaction.
    const r2 = read('src/lib/r2.ts')
    expect(r2).toContain("assertOutsideTransaction('R2 objectBytes')")
    expect(r2).toContain("assertOutsideTransaction('R2 putObject')")
  })

  it('downloads as an attachment, never cached', () => {
    expect(route).toContain('attachment; filename=')
    expect(route).toContain("'cache-control': 'private, no-store'")
  })
})

describe('the button', () => {
  it('is on broker freight, for a role that sees the money and files documents', () => {
    const page = read('src/app/(app)/loads/[id]/page.tsx')
    expect(page).toContain('view.brokerShape && maySeeRate && mayUpload ? (')
    expect(page).toContain('href={`/api/loads/${id}/invoice-packet`}')
  })
})

describe('one invoice, one rendering', () => {
  it('the invoice route and the packet both call invoicePdfFor', () => {
    expect(read('src/app/api/invoices/[id]/pdf/route.ts')).toContain(
      'invoicePdfFor(tx, id)',
    )
    expect(read('src/lib/invoice-packet-store.ts')).toContain(
      'await invoicePdfFor(tx, invoiceId)',
    )
  })
})

describe('every refusal is a sentence', () => {
  it('names what to go and do', () => {
    expect(invoicePacketRefusalDetail({ kind: 'nothing_to_merge' })).toMatch(
      /upload the POD, the BOL or the rate con/,
    )
    expect(
      invoicePacketRefusalDetail({
        kind: 'too_large',
        bytes: 21 * 1_048_576,
        limit: 20 * 1_048_576,
      }),
    ).toContain('21.0 MB, over the 20 MB')
    expect(
      invoicePacketRefusalDetail({
        kind: 'no_pages_from',
        type: 'POD',
        filename: 'pod.jpg',
      }),
    ).toContain('pod.jpg (POD)')
    expect(invoicePacketRefusalDetail({ kind: 'not_broker' })).toContain(
      'Amazon Relay',
    )
  })
})
