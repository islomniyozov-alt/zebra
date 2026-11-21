import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { loadWarningFacts, loadWarnings } from '@/lib/warnings'
import { rateConMissingForDispatch } from '@/lib/dispatch'
import { dropOrganization, seedOrganization, type OrgFixture } from './fixtures'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// BROKER FREIGHT'S PAPER, AGAINST REAL POSTGRES (TMS §7.14 items 2 and 3;
// BROKER-LOAD-BRIEF step 2).
//
// The list's one load-facts statement now reads the customer's name and
// whether a live rate con and POD are on file; the dispatch board's hold reads
// the same rate con. A broker load and an Amazon load, each with no paper,
// then each document filed and one deleted — so a column that read nothing,
// or a predicate that ignored `deletedAt`, cannot pass.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let org: OrgFixture
let broker = ''
let amazon = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(org.organizationId, fn, {
    attribution: { userId: org.userId, ip: null, userAgent: 'broker-paper' },
    maxWaitMs: 15_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const customer = async (name: string) =>
  (
    await owner.customer.create({
      data: { organizationId: org.organizationId, name },
      select: { id: true },
    })
  ).id

const load = async (customerId: string, tag: string) =>
  (
    await owner.load.create({
      data: {
        organizationId: org.organizationId,
        companyId: org.companyId,
        customerId,
        loadNumber: `BP-${tag}-${nonce}`,
        operationalStatus: 'DELIVERED',
        totalRevenueCents: 40_248,
      },
      select: { id: true },
    })
  ).id

const file = (loadId: string, type: 'RATE_CONFIRMATION' | 'POD') =>
  owner.document.create({
    data: {
      organizationId: org.organizationId,
      companyId: org.companyId,
      loadId,
      type,
      r2Key: `${org.organizationId}/paper/${type}-${loadId}-${Math.random()}`,
      filename: `${type}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 10,
    },
    select: { id: true },
  })

const names = async (loadId: string) => {
  const facts = await inOrg((tx) => loadWarningFacts(tx, [loadId]))
  return loadWarnings(facts.get(loadId)!, new Date()).map((w) => w.name)
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  org = await seedOrganization(owner, 'paper', nonce)
  broker = await load(await customer(`Werner ${nonce}`), 'broker')
  amazon = await load(await customer('Amazon Relay'), 'amazon')
}, 180_000)

afterAll(async () => {
  // The organization's delete cascades to its loads, customers and documents.
  await dropOrganization(owner, org)
  await owner.$disconnect()
})

describe('broker freight with no paper', () => {
  it('warns both, and holds dispatch', async () => {
    expect(await names(broker)).toEqual(
      expect.arrayContaining(['rate_con_missing', 'pod_missing']),
    )
    expect(await inOrg((tx) => rateConMissingForDispatch(tx, broker))).toBe(
      true,
    )
  }, 120_000)

  it('the Amazon load beside it says neither and is not held', async () => {
    const amazonNames = await names(amazon)
    expect(amazonNames).not.toContain('rate_con_missing')
    expect(amazonNames).not.toContain('pod_missing')
    expect(await inOrg((tx) => rateConMissingForDispatch(tx, amazon))).toBe(
      false,
    )
  }, 120_000)
})

describe('filing the paper', () => {
  it('a rate con clears the warning and the hold; a POD clears its own', async () => {
    await file(broker, 'RATE_CONFIRMATION')
    expect(await names(broker)).not.toContain('rate_con_missing')
    expect(await names(broker)).toContain('pod_missing')
    expect(await inOrg((tx) => rateConMissingForDispatch(tx, broker))).toBe(
      false,
    )

    const pod = await file(broker, 'POD')
    expect(await names(broker)).not.toContain('pod_missing')

    // A deleted POD is not on file.
    await owner.document.update({
      where: { id: pod.id },
      data: { deletedAt: new Date() },
    })
    expect(await names(broker)).toContain('pod_missing')
  }, 180_000)
})
