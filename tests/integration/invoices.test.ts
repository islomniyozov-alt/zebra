import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { transitionOperational } from '@/lib/load-status'
import { setLoadRate } from '@/lib/rates'
import { generateInvoice, readyToInvoice } from '@/lib/invoices'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Invoice generation against real Postgres.
//
// The pure arithmetic is covered in tests/invoices.test.ts. What can only be
// asserted here: the number really comes from the counter, the lines really
// snapshot, a load really cannot reach two invoices, and a direct-settled load
// really never appears in the queue.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let relayId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'invoices.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

const labels = {
  linehaul: 'Linehaul',
  fuelSurcharge: 'Fuel surcharge',
  accessorial: (type: string) => type,
}

const day = (d: number) => new Date(Date.UTC(2026, 8, d, 8, 0, 0))

/** A load taken all the way to POD received, with a rate on it. */
async function deliveredLoad(
  customerId: string,
  linehaul: string,
  fuel: string,
  offset: number,
) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId,
        stops: [
          {
            type: 'PICKUP',
            city: 'Chicago',
            state: 'IL',
            scheduledAt: day(offset),
          },
          {
            type: 'DELIVERY',
            city: 'Dallas',
            state: 'TX',
            scheduledAt: day(offset + 1),
          },
        ],
      },
      { byUserId: userId },
    ),
  )

  await inOrg((tx) =>
    setLoadRate(tx, load.id, { linehaul, fuelSurcharge: fuel }),
  )
  await inOrg((tx) =>
    transitionOperational(tx, load.id, 'POD_RECEIVED', {
      source: 'AUTOMATIC',
      userId,
    }),
  )
  return load
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Invoices ${nonce}`,
      slug: `invoices-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: { email: `invoices-${nonce}@example.test`, name: 'Invoice Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Broker ${nonce}` }),
    )
  ).id

  // The Amazon Relay shape: settles directly, by weekly ACH statement.
  relayId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Relay ${nonce}` }),
    )
  ).id
  await owner.customer.update({
    where: { id: relayId },
    data: { settlesDirectly: true },
  })
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('generating an invoice from delivered loads', () => {
  it('numbers it from the counter and snapshots the lines', async () => {
    const first = await deliveredLoad(brokerId, '2450', '380', 1)
    const second = await deliveredLoad(brokerId, '1900', '295', 3)

    const outcome = await inOrg((tx) =>
      generateInvoice(tx, organizationId, {
        loadIds: [first.id, second.id],
        labels,
      }),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // 2450 + 380 + 1900 + 295 = 5025.00
    expect(outcome.totalCents).toBe(502500)
    expect(outcome.invoiceNumber).toMatch(/^INV-\d+$/)

    const invoice = await owner.invoice.findUnique({
      where: { id: outcome.invoiceId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    })
    expect(invoice?.lines).toHaveLength(4)
    expect(invoice?.subtotalCents).toBe(502500)
    expect(invoice?.balanceCents).toBe(502500)
    expect(invoice?.status).toBe('DRAFT')

    // THE SNAPSHOT. Move the load's rate afterwards; the invoice must not
    // follow it — a broker holding a document for $5,025.00 is owed that.
    await inOrg((tx) =>
      setLoadRate(tx, first.id, { linehaul: '9999', fuelSurcharge: '0' }),
    )
    const after = await owner.invoice.findUnique({
      where: { id: outcome.invoiceId },
      select: { totalCents: true },
    })
    expect(after?.totalCents).toBe(502500)
  }, 300_000)

  it('will not put one load on two invoices', async () => {
    const load = await deliveredLoad(brokerId, '1500', '0', 6)

    const first = await inOrg((tx) =>
      generateInvoice(tx, organizationId, { loadIds: [load.id], labels }),
    )
    expect(first.ok).toBe(true)

    // The same call again. Double-billing is the failure that gets a carrier
    // accused of fraud rather than of sloppiness.
    const again = await inOrg((tx) =>
      generateInvoice(tx, organizationId, { loadIds: [load.id], labels }),
    )
    expect(again).toMatchObject({ ok: false, reason: 'not_ready' })
    if (!again.ok) expect(again.loadNumbers).toEqual([load.loadNumber])
  }, 300_000)

  it('refuses to mix two brokers on one invoice', async () => {
    const other = await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Other ${nonce}` }),
    )
    const mine = await deliveredLoad(brokerId, '1000', '0', 9)
    const theirs = await deliveredLoad(other.id, '1000', '0', 11)

    expect(
      await inOrg((tx) =>
        generateInvoice(tx, organizationId, {
          loadIds: [mine.id, theirs.id],
          labels,
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'mixed_customers' })

    // The pair: each alone goes through, so the refusal is about mixing.
    expect(
      (
        await inOrg((tx) =>
          generateInvoice(tx, organizationId, { loadIds: [mine.id], labels }),
        )
      ).ok,
    ).toBe(true)
  }, 300_000)
})

describe('what never reaches the queue', () => {
  it('a load with no rate', async () => {
    const load = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId,
          customerId: brokerId,
          stops: [
            {
              type: 'PICKUP',
              city: 'Chicago',
              state: 'IL',
              scheduledAt: day(14),
            },
            {
              type: 'DELIVERY',
              city: 'Dallas',
              state: 'TX',
              scheduledAt: day(15),
            },
          ],
        },
        { byUserId: userId },
      ),
    )
    await inOrg((tx) =>
      transitionOperational(tx, load.id, 'POD_RECEIVED', {
        source: 'AUTOMATIC',
        userId,
      }),
    )

    const ready = await inOrg((tx) => readyToInvoice(tx))
    expect(ready.map((row) => row.id)).not.toContain(load.id)

    // The pair: give it a rate and it appears, so the absence was the rate.
    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '800', fuelSurcharge: '0' }),
    )
    const afterRate = await inOrg((tx) => readyToInvoice(tx))
    expect(afterRate.map((row) => row.id)).toContain(load.id)
  }, 300_000)

  it('a direct-settled load, however delivered and rated it is', async () => {
    const relay = await deliveredLoad(relayId, '1200', '0', 17)
    await owner.load.update({
      where: { id: relay.id },
      data: { directSettled: true },
    })

    const ready = await inOrg((tx) => readyToInvoice(tx))
    expect(ready.map((row) => row.id)).not.toContain(relay.id)

    // And it cannot be forced onto one by naming its id.
    expect(
      await inOrg((tx) =>
        generateInvoice(tx, organizationId, { loadIds: [relay.id], labels }),
      ),
    ).toMatchObject({ ok: false, reason: 'not_ready' })

    // The pair: the same load, direct-settled cleared, is immediately ready —
    // so the exclusion is the flag and nothing else about it.
    await owner.load.update({
      where: { id: relay.id },
      data: { directSettled: false },
    })
    const now = await inOrg((tx) => readyToInvoice(tx))
    expect(now.map((row) => row.id)).toContain(relay.id)
  }, 300_000)

  it('a load that has not delivered', async () => {
    const load = await deliveredLoad(brokerId, '1100', '0', 20)
    await owner.load.update({
      where: { id: load.id },
      data: { operationalStatus: 'IN_TRANSIT' },
    })

    const ready = await inOrg((tx) => readyToInvoice(tx))
    expect(ready.map((row) => row.id)).not.toContain(load.id)
  }, 300_000)
})
