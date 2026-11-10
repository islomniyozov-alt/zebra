import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg, type TxClient } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createTruck } from '@/lib/fleet'
import { createLoad, LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { loadWarningFacts, loadWarnings } from '@/lib/warnings'
import {
  planSeedPlaceholderRetirement,
  retireSeedPlaceholderTrucks,
  SEED_INACTIVE_REASON,
} from '@/lib/truck-retirement'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE SEED'S PLACEHOLDERS BECOME REMOVED, AGAINST REAL POSTGRES (§6.5 part 1,
// owner's ruling (b) of 2026-11-10).
//
// Four trucks the seed never makes: a placeholder exactly as the all-trucks
// seed wrote it (OUT_OF_SERVICE, no asset-history period, untouched); one
// with the same shape that a person has edited since (an audit UPDATE); one
// OUT_OF_SERVICE through the application, which opened its period; and an
// AVAILABLE one. Only the first is the seed's. An open load and a delivered
// load name it: the open one warns "truck inactive" afterwards, the finished
// one says nothing.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
const nonce = Math.random().toString(36).slice(2, 8)
const NOW = new Date('2026-11-10T16:00:00Z')

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'truck-retirement.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const ids: Record<string, string> = {}

async function placeholder(
  key: string,
  status: 'OUT_OF_SERVICE' | 'AVAILABLE',
) {
  // AS THE SEED WROTE IT: a bare create, no period, no audit scope.
  const row = await owner.truck.create({
    data: {
      organizationId,
      companyId,
      unitNumber: `${key}-${nonce}`,
      status,
      notes: key === 'seed' ? 'FRHT, from the 113-row export' : null,
    },
    select: { id: true },
  })
  ids[key] = row.id
  return row.id
}

async function load(key: string, truckId: string, finished: boolean) {
  const created = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        referenceNumber: `R-${key}-${nonce}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: new Date('2026-11-20T15:00:00Z'),
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: new Date('2026-11-21T15:00:00Z'),
          },
        ],
        linehaulCents: 100_000,
      },
      { byUserId: userId },
    ),
  )
  await owner.load.update({
    where: { id: created.id },
    data: {
      truckId,
      operationalStatus: finished ? 'DELIVERED' : 'DISPATCHED',
    },
  })
  ids[key] = created.id
  return created.id
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Retire ${nonce}`,
      slug: `retire-${nonce}`,
      maxCompanies: 2,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  const user = await owner.user.create({
    data: { email: `retire-${nonce}@example.test`, name: 'Retire Tester' },
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

  await placeholder('seed', 'OUT_OF_SERVICE')
  await placeholder('touched', 'OUT_OF_SERVICE')
  await owner.auditLog.create({
    data: {
      organizationId,
      companyId,
      action: 'UPDATE',
      entityType: 'Truck',
      entityId: ids['touched']!,
      changes: { status: { from: 'AVAILABLE', to: 'OUT_OF_SERVICE' } },
    },
  })
  await placeholder('available', 'AVAILABLE')
  // Through the application: `createTruck` opens the asset-history period.
  ids['withPeriod'] = (
    await inOrg((tx) =>
      createTruck(
        tx,
        organizationId,
        {
          companyId,
          unitNumber: `period-${nonce}`,
          status: 'OUT_OF_SERVICE',
        },
        { byUserId: userId },
      ),
    )
  ).id
  await load('open', ids['seed']!, false)
  await load('done', ids['seed']!, true)
})

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe("the seed's signature", () => {
  it('finds the untouched placeholder, names the touched one, counts by the views', async () => {
    const plan = await inOrg((tx) => planSeedPlaceholderRetirement(tx))
    expect(plan.candidates.map((t) => t.unitNumber)).toEqual([`seed-${nonce}`])
    expect(plan.candidates[0]!.openLoads).toHaveLength(1)
    expect(plan.touched.map((t) => t.unitNumber)).toEqual([`touched-${nonce}`])
    // The one with a period and the AVAILABLE one match nothing.
    expect(plan.before).toEqual({ active: 4, inactive: 0 })
  }, 120_000)

  it('a preview writes nothing', async () => {
    const plan = await inOrg((tx) =>
      retireSeedPlaceholderTrucks(tx, { write: false, now: NOW }),
    )
    expect(plan.after).toBeNull()
    expect(plan.written).toBe(0)
    const seed = await owner.truck.findUnique({
      where: { id: ids['seed']! },
      select: { deletedAt: true, notes: true },
    })
    expect(seed?.deletedAt).toBeNull()
    expect(seed?.notes).toBe('FRHT, from the 113-row export')
  }, 120_000)
})

describe('the removal', () => {
  it('retires the placeholder with the reason, through the application, and counts again', async () => {
    const plan = await inOrg((tx) =>
      retireSeedPlaceholderTrucks(tx, { write: true, now: NOW }),
    )
    expect(plan.written).toBe(1)
    expect(plan.before).toEqual({ active: 4, inactive: 0 })
    expect(plan.after).toEqual({ active: 3, inactive: 1 })

    const seed = await owner.truck.findUnique({
      where: { id: ids['seed']! },
      select: { deletedAt: true, notes: true },
    })
    expect(seed?.deletedAt).not.toBeNull()
    // The reason on the record itself, under what was there.
    expect(seed?.notes).toBe(
      `FRHT, from the 113-row export\nRemoved 2026-11-10: ${SEED_INACTIVE_REASON} (owner's ruling 2026-11-10)`,
    )
    // And the audit row the application writes for a removal: the extension
    // reads a `deletedAt` set from null as a DELETE, its own action (§8).
    const audits = await owner.auditLog.findMany({
      where: { entityType: 'Truck', entityId: ids['seed']!, action: 'DELETE' },
      select: { changes: true },
    })
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits[0]!.changes)).toContain('deletedAt')

    // The others are exactly as they were.
    for (const key of ['touched', 'available', 'withPeriod']) {
      const truck = await owner.truck.findUnique({
        where: { id: ids[key]! },
        select: { deletedAt: true },
      })
      expect(truck?.deletedAt, key).toBeNull()
    }
  }, 120_000)

  it('the open load keeps the link and says "truck inactive"; the finished one says nothing', async () => {
    const facts = await inOrg((tx) =>
      loadWarningFacts(tx, [ids['open']!, ids['done']!]),
    )
    const open = facts.get(ids['open']!)!
    expect(open.truckRemoved).toBe(true)
    expect(open.hasTruck).toBe(true)
    expect(loadWarnings(open, NOW).map((w) => [w.name, w.detail])).toEqual([
      ['truck_inactive', `seed-${nonce}`],
    ])
    const done = facts.get(ids['done']!)!
    expect(done.truckRemoved).toBe(true)
    expect(done.isFinished).toBe(true)
    expect(loadWarnings(done, NOW).map((w) => w.name)).not.toContain(
      'truck_inactive',
    )
    const kept = await owner.load.findUnique({
      where: { id: ids['open']! },
      select: { truckId: true },
    })
    expect(kept?.truckId).toBe(ids['seed'])
  }, 120_000)

  it('a second run finds nothing and writes nothing', async () => {
    const plan = await inOrg((tx) =>
      retireSeedPlaceholderTrucks(tx, { write: true, now: NOW }),
    )
    expect(plan.candidates).toEqual([])
    expect(plan.written).toBe(0)
    expect(plan.after).toEqual({ active: 3, inactive: 1 })
  }, 120_000)
})
