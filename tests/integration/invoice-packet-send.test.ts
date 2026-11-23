import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg, type TxClient } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createLoad, LOAD_WRITE_TIMEOUT_MS, type StopInput } from '@/lib/loads'
import { renderInvoicePdf, remitToFor } from '@/lib/invoice-pdf'
import type { EmailMessage, SendResult } from '@/lib/email'
import {
  PACKET_RESEND_WINDOW_MS,
  sendInvoicePacket,
  type PacketSendIo,
} from '@/lib/invoice-packet-send'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// MERGE & SEND AGAINST POSTGRES (TMS §7.14 item 6; BROKER-LOAD-BRIEF step 5,
// R4, R5). The bucket is a Map and Resend is a list — what is under test is
// the rows: the slot claimed in one conditional write, the same packet to the
// same address refused inside 24 hours with the first send's time, a refused
// send releasing the slot, the audit row naming who sent what to whom, and an
// existing invoice marked sent with the address.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let factorId = ''
const nonce = Math.random().toString(36).slice(2, 8)
const BILLING = `ap-${nonce}@broker.example`
const FACTOR = `funding-${nonce}@factor.example`

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'invoice-packet-send' },
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

/** The bucket, Resend as a list, and a clock the test moves. */
function rig(answer: () => SendResult = () => ({ ok: true, id: 're_1' })) {
  const objects = new Map<string, Uint8Array>()
  const sent: EmailMessage[] = []
  let clock = new Date(Date.UTC(2026, 11, 3, 9))
  let next = 0
  const io: PacketSendIo = {
    read: (fn) => inOrg(fn),
    write: (fn) => inOrg((tx) => fn(tx, userId)),
    fetchBytes: async (key) => objects.get(key) ?? null,
    putBytes: async (key, bytes) => {
      objects.set(key, bytes)
    },
    newId: () => `packet-${nonce}-${++next}`,
    send: async (message) => {
      sent.push(message)
      return answer()
    },
    now: () => clock,
  }
  return {
    objects,
    sent,
    io,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms)
    },
  }
}

let docSeq = 0
async function rateCon(objects: Map<string, Uint8Array>, loadId: string) {
  docSeq += 1
  const bytes = onePagePdf()
  const r2Key = `${organizationId}/load/${loadId}/${nonce}-${docSeq}`
  objects.set(r2Key, bytes)
  await owner.document.create({
    data: {
      organizationId,
      companyId,
      loadId,
      type: 'RATE_CONFIRMATION',
      r2Key,
      filename: `ratecon-${docSeq}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256: `sha-${nonce}-${docSeq}`,
    },
  })
}

const brokerLoad = (extra: { paymentType?: string } = {}) =>
  inOrg((tx) =>
    createLoad(tx, organizationId, {
      companyId,
      customerId: brokerId,
      stops,
    }),
  ).then(async (load) => {
    if (extra.paymentType) {
      await owner.load.update({
        where: { id: load.id },
        data: { paymentType: extra.paymentType },
      })
    }
    return load
  })

const packetRow = (loadId: string) =>
  owner.document.findFirstOrThrow({
    where: { loadId, type: 'INVOICE_PACKET', deletedAt: null },
    select: { id: true, packetSentAt: true, packetSentTo: true },
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Send ${nonce}`,
      slug: `send-${nonce}`,
      companies: {
        create: {
          name: `Authority ${nonce}`,
          email: `office-${nonce}@carrier.example`,
        },
      },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  userId = (
    await owner.user.create({
      data: { email: `send-${nonce}@example.test`, name: 'Send Tester' },
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
  await owner.customer.update({
    where: { id: brokerId },
    data: { billingEmail: BILLING },
  })
  factorId = (
    await owner.factoringCompany.create({
      data: { organizationId, name: `Factor ${nonce}`, email: FACTOR },
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

describe('Merge & send (R4, R5)', () => {
  it('sends to the billing email, claims the slot, and refuses the same send inside 24 hours', async () => {
    const { objects, sent, io, advance } = rig()
    const load = await brokerLoad()
    await rateCon(objects, load.id)

    const first = await sendInvoicePacket(io, load.id)
    expect(first).toMatchObject({ ok: true, to: BILLING })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: BILLING,
      replyTo: `office-${nonce}@carrier.example`,
    })
    expect(sent[0]!.attachments![0]!.filename).toBe(
      `packet-${load.loadNumber}.pdf`,
    )
    const row = await packetRow(load.id)
    expect(row.packetSentTo).toBe(BILLING)

    // THE AUDIT ROW names who, which packet, and the address.
    const audit = await owner.auditLog.findMany({
      where: { organizationId, entityId: row.id, action: 'UPDATE' },
      select: { userId: true, changes: true },
    })
    const sendRow = audit.find((entry) =>
      JSON.stringify(entry.changes).includes(BILLING),
    )
    expect(sendRow?.userId).toBe(userId)

    // SAME PACKET, SAME ADDRESS, AN HOUR LATER: refused with the first time.
    advance(60 * 60 * 1000)
    const again = await sendInvoicePacket(io, load.id)
    expect(again).toMatchObject({
      ok: false,
      reason: { kind: 'sent_recently', to: BILLING },
    })
    if (!again.ok && again.reason.kind === 'sent_recently') {
      expect(again.reason.at.getTime()).toBe(row.packetSentAt!.getTime())
    }
    expect(sent).toHaveLength(1)

    // A DAY AND A MINUTE AFTER THE FIRST: allowed again.
    advance(PACKET_RESEND_WINDOW_MS - 60 * 60 * 1000 + 60_000)
    expect((await sendInvoicePacket(io, load.id)).ok).toBe(true)
    expect(sent).toHaveLength(2)
  }, 120_000)

  it('two clicks at once send once', async () => {
    const { objects, sent, io } = rig()
    const load = await brokerLoad()
    await rateCon(objects, load.id)
    const results = await Promise.all([
      sendInvoicePacket(io, load.id),
      sendInvoicePacket(io, load.id),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(sent).toHaveLength(1)
  }, 120_000)

  it('a refused send releases the slot, so the retry is not blocked for a day', async () => {
    let refuse = true
    const { objects, sent, io } = rig(() =>
      refuse ? { ok: false, reason: 'rejected' } : { ok: true, id: 're_2' },
    )
    const load = await brokerLoad()
    await rateCon(objects, load.id)

    expect(await sendInvoicePacket(io, load.id)).toMatchObject({
      ok: false,
      reason: { kind: 'send_failed', why: 'rejected' },
    })
    const released = await packetRow(load.id)
    expect(released.packetSentAt).toBeNull()
    expect(released.packetSentTo).toBeNull()

    refuse = false
    expect((await sendInvoicePacket(io, load.id)).ok).toBe(true)
    expect(sent).toHaveLength(2)
  }, 120_000)

  it('an existing invoice rides in the packet and is marked sent with the address', async () => {
    const { objects, io } = rig()
    const load = await brokerLoad()
    await rateCon(objects, load.id)
    const invoice = await owner.invoice.create({
      data: {
        organizationId,
        companyId,
        customerId: brokerId,
        invoiceNumber: `INV-${nonce}`,
        status: 'DRAFT',
        subtotalCents: 100_000,
        totalCents: 100_000,
        balanceCents: 100_000,
        lines: {
          create: {
            organizationId,
            loadId: load.id,
            description: 'Linehaul - FLAT',
            unitCents: 100_000,
            amountCents: 100_000,
          },
        },
      },
      select: { id: true },
    })

    const outcome = await sendInvoicePacket(io, load.id)
    expect(outcome).toMatchObject({ ok: true, invoiceMarked: true })
    expect(
      await owner.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        select: { status: true, sentToEmail: true },
      }),
    ).toEqual({ status: 'SENT', sentToEmail: BILLING })
  }, 120_000)

  it('Factored goes to the factor; Direct is not offered; no address names the field', async () => {
    const { objects, sent, io } = rig()

    const factored = await brokerLoad({ paymentType: 'Factored' })
    await owner.load.update({
      where: { id: factored.id },
      data: { factoringCompanyId: factorId },
    })
    await rateCon(objects, factored.id)
    expect(await sendInvoicePacket(io, factored.id)).toMatchObject({
      ok: true,
      to: FACTOR,
    })

    const direct = await brokerLoad({ paymentType: 'Direct' })
    await rateCon(objects, direct.id)
    expect(await sendInvoicePacket(io, direct.id)).toMatchObject({
      ok: false,
      reason: { kind: 'not_offered' },
    })

    const orphan = await brokerLoad({ paymentType: 'Factored' })
    await rateCon(objects, orphan.id)
    expect(await sendInvoicePacket(io, orphan.id)).toMatchObject({
      ok: false,
      reason: { kind: 'no_address', field: 'factoring_company' },
    })
    expect(sent).toHaveLength(1)
  }, 120_000)
})
