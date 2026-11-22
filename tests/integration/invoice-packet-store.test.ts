import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg, type TxClient } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createLoad, LOAD_WRITE_TIMEOUT_MS, type StopInput } from '@/lib/loads'
import { renderInvoicePdf, remitToFor } from '@/lib/invoice-pdf'
import { MAX_PACKET_SOURCE_BYTES } from '@/lib/invoice-packet'
import {
  invoicePacketForLoad,
  invoicePacketPlanFor,
  storeInvoicePacket,
  type InvoicePacketIo,
} from '@/lib/invoice-packet-store'
import type { DocumentType, PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// MERGE DOWNLOAD AGAINST POSTGRES (TMS §7.14 item 5; BROKER-LOAD-BRIEF step
// 4b, R4 and R9). The bucket is a Map — what is under test is the rows: one
// live packet per load, the same inputs answered from storage with nothing
// built or written, changed inputs superseding the old packet in history, a
// racing second click settled inside the write, and the refusals named before
// a byte is fetched.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let amazonId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'invoice-packet-store' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 15_000,
  })

const stops: StopInput[] = [
  {
    type: 'PICKUP',
    city: 'Chicago',
    state: 'IL',
    scheduledAt: new Date(Date.UTC(2026, 11, 1, 8)),
  },
  {
    type: 'DELIVERY',
    city: 'Dallas',
    state: 'TX',
    scheduledAt: new Date(Date.UTC(2026, 11, 2, 8)),
  },
]

/** A JPEG header real enough for the page reader: SOI, APP0, SOF0, EOI. */
const jpeg = (): Uint8Array =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
    0x08, 0x05, 0x00, 0x03, 0xc0, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01,
    0x03, 0x11, 0x01, 0xff, 0xd9,
  ])

/** A one-page PDF this system writes, standing in for a broker's rate con. */
const onePagePdf = () =>
  renderInvoicePdf({
    invoiceNumber: 'RC-1',
    issueDate: '2026-12-01',
    dueDate: '2026-12-31',
    termsDays: 30,
    carrier: { name: 'Carrier', dotNumber: '1', mcNumber: 'MC-1' },
    billTo: { name: 'Broker', address: null },
    remitTo: remitToFor({ company: { name: 'Carrier' } }),
    lines: [{ description: 'Linehaul - FLAT', amountCents: 100_000 }],
    subtotalCents: 100_000,
    accessorialsCents: 0,
    totalCents: 100_000,
  })

/** The bucket, and a count of every call into it. */
function bucket() {
  const objects = new Map<string, Uint8Array>()
  const calls = { fetched: [] as string[], put: [] as string[] }
  let next = 0
  const io: InvoicePacketIo = {
    read: (fn) => inOrg(fn),
    write: (fn) => inOrg((tx) => fn(tx, userId)),
    fetchBytes: async (key) => {
      calls.fetched.push(key)
      return objects.get(key) ?? null
    },
    putBytes: async (key, bytes) => {
      calls.put.push(key)
      objects.set(key, bytes)
    },
    newId: () => `packet-${++next}`,
  }
  return { objects, calls, io }
}

let docSeq = 0
/** A document row on the load, and its object in the bucket. */
async function file(
  objects: Map<string, Uint8Array> | null,
  loadId: string,
  type: DocumentType,
  options: { image?: boolean; sizeBytes?: number } = {},
) {
  docSeq += 1
  const bytes = options.image ? jpeg() : onePagePdf()
  const r2Key = `${organizationId}/load/${loadId}/${nonce}-${docSeq}`
  objects?.set(r2Key, bytes)
  return owner.document.create({
    data: {
      organizationId,
      companyId,
      loadId,
      type,
      r2Key,
      filename: `${type.toLowerCase()}-${docSeq}.${options.image ? 'jpg' : 'pdf'}`,
      mimeType: options.image ? 'image/jpeg' : 'application/pdf',
      sizeBytes: options.sizeBytes ?? bytes.byteLength,
      sha256: `sha-${nonce}-${docSeq}`,
      uploadedAt: new Date(Date.UTC(2026, 11, 1, 0, docSeq)),
    },
    select: { id: true },
  })
}

const packets = (loadId: string) =>
  owner.document.findMany({
    where: { loadId, type: 'INVOICE_PACKET' },
    orderBy: { uploadedAt: 'asc' },
    select: {
      id: true,
      deletedAt: true,
      supersededByDocumentId: true,
      packetInputsHash: true,
      uploadedByUserId: true,
      pageCount: true,
      mimeType: true,
    },
  })

const brokerLoad = () =>
  inOrg((tx) =>
    createLoad(tx, organizationId, {
      companyId,
      customerId: brokerId,
      stops,
    }),
  )

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Packet ${nonce}`,
      slug: `packet-${nonce}`,
      companies: { create: { name: `Authority ${nonce}` } },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  userId = (
    await owner.user.create({
      data: { email: `packet-${nonce}@example.test`, name: 'Packet Tester' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Werner ${nonce}` }),
    )
  ).id
  amazonId = (
    await owner.customer.create({
      data: { organizationId, name: 'Amazon Relay' },
      select: { id: true },
    })
  ).id
}, 180_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('one live packet per inputs (R4)', () => {
  it('builds and stores the first, reuses it, supersedes it when an input changes', async () => {
    const { objects, calls, io } = bucket()
    const load = await brokerLoad()
    await file(objects, load.id, 'RATE_CONFIRMATION')
    await file(objects, load.id, 'POD', { image: true })

    // FIRST: built (photo first, then the rate con's page) and stored.
    const first = await invoicePacketForLoad(io, load.id)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.reused).toBe(false)
    expect(first.filename).toBe(`packet-${load.loadNumber}.pdf`)
    expect(calls.put).toHaveLength(1)
    const [stored] = await packets(load.id)
    expect(stored).toMatchObject({
      id: first.documentId,
      deletedAt: null,
      supersededByDocumentId: null,
      uploadedByUserId: userId,
      pageCount: 2,
      mimeType: 'application/pdf',
    })
    expect(stored!.packetInputsHash).toMatch(/^[0-9a-f]{64}$/)

    // SECOND, SAME INPUTS: the stored bytes, nothing fetched but the packet,
    // nothing put, nothing written.
    calls.fetched.length = 0
    const second = await invoicePacketForLoad(io, load.id)
    expect(second.ok && second.reused).toBe(true)
    expect(second.ok && second.documentId).toBe(first.documentId)
    expect(calls.put).toHaveLength(1)
    expect(calls.fetched).toEqual([calls.put[0]])
    expect(await packets(load.id)).toHaveLength(1)

    // A NEW INPUT: a new packet; the old one soft-deleted, pointing at it.
    await file(objects, load.id, 'BOL')
    const third = await invoicePacketForLoad(io, load.id)
    expect(third.ok && third.reused).toBe(false)
    if (!third.ok) return
    const rows = await packets(load.id)
    expect(rows).toHaveLength(2)
    expect(rows.filter((row) => row.deletedAt === null)).toEqual([
      expect.objectContaining({ id: third.documentId, pageCount: 3 }),
    ])
    expect(rows.find((row) => row.id === first.documentId)).toMatchObject({
      supersededByDocumentId: third.documentId,
    })
    expect(rows[0]!.deletedAt).not.toBeNull()
  }, 120_000)

  it('a racing second click finds the first one’s row and writes nothing', async () => {
    const { objects, io } = bucket()
    const load = await brokerLoad()
    await file(objects, load.id, 'RATE_CONFIRMATION')
    const first = await invoicePacketForLoad(io, load.id)
    expect(first.ok).toBe(true)

    // The second click planned before the first stored: same hash, no reuse.
    const planned = await inOrg((tx) => invoicePacketPlanFor(tx, load.id))
    expect(planned.ok).toBe(true)
    if (!planned.ok || !first.ok) return
    const raced = await inOrg((tx) =>
      storeInvoicePacket(tx, {
        plan: { ...planned.plan, reuse: null },
        userId,
        r2Key: `${organizationId}/load/${load.id}/raced`,
        filename: 'packet.pdf',
        sha256: 'x',
        sizeBytes: 1,
        pageCount: 1,
      }),
    )
    expect(raced).toEqual({ documentId: first.documentId, raced: true })
    expect(await packets(load.id)).toHaveLength(1)
  }, 120_000)

  it('a stored packet whose object is gone is rebuilt, not served as nothing', async () => {
    const { objects, calls, io } = bucket()
    const load = await brokerLoad()
    await file(objects, load.id, 'RATE_CONFIRMATION')
    const first = await invoicePacketForLoad(io, load.id)
    expect(first.ok).toBe(true)
    objects.delete(calls.put[0]!)
    const again = await invoicePacketForLoad(io, load.id)
    expect(again.ok && again.reused).toBe(true) // the row stands; bytes rebuilt
    expect(calls.put).toHaveLength(2)
  }, 120_000)
})

describe('refused by name', () => {
  it('Amazon freight has no packet', async () => {
    const { objects, io } = bucket()
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId,
        customerId: amazonId,
        stops,
      }),
    )
    await file(objects, load.id, 'RATE_CONFIRMATION')
    const outcome = await invoicePacketForLoad(io, load.id)
    expect(outcome).toEqual({ ok: false, reason: { kind: 'not_broker' } })
  }, 120_000)

  it('nothing to merge when no POD, BOL or rate con is on file', async () => {
    const { io } = bucket()
    const load = await brokerLoad()
    expect(await invoicePacketForLoad(io, load.id)).toEqual({
      ok: false,
      reason: { kind: 'nothing_to_merge' },
    })
  }, 120_000)

  it('over 20 MB on the rows, refused before a byte is fetched (R9)', async () => {
    const { objects, calls, io } = bucket()
    const load = await brokerLoad()
    await file(objects, load.id, 'RATE_CONFIRMATION', {
      sizeBytes: MAX_PACKET_SOURCE_BYTES + 1,
    })
    const outcome = await invoicePacketForLoad(io, load.id)
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason.kind).toBe('too_large')
    expect(calls.fetched).toEqual([])
    expect(calls.put).toEqual([])
  }, 120_000)

  it('a row whose object is missing names the file and stores nothing', async () => {
    const { calls, io } = bucket()
    const load = await brokerLoad()
    await file(null, load.id, 'POD', { image: true })
    const outcome = await invoicePacketForLoad(io, load.id)
    expect(!outcome.ok && outcome.reason.kind).toBe('no_pages_from')
    expect(calls.put).toEqual([])
    expect(await packets(load.id)).toEqual([])
  }, 120_000)
})
