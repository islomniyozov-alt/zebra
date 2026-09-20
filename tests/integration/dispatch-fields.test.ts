import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import {
  deliveryFactsForLoads,
  dispatchFactsForDrivers,
  dispatchStatusFrom,
  headingToForTrucks,
  lastActivityForDrivers,
  onTimeFrom,
} from '@/lib/dispatch-fields'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE FOUR LOADERS, AGAINST REAL ROWS — AND WHAT A LIST COSTS.
//
// `tests/dispatch-fields.test.ts` grades the rules against hand-built facts.
// This grades the QUERIES: that they find the right rows, and that twenty
// drivers cost the same number of statements as one. A fan-out returns correct
// answers, which is exactly why it has to be counted rather than reviewed.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let truckId = ''
let driverId = ''
let idleDriverId = ''

const nonce = Math.random().toString(36).slice(2, 8)
const NOW = new Date()
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'dispatch-fields.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  organizationId = (
    await owner.organization.create({
      data: { name: `Disp ${nonce}`, slug: `disp-${nonce}` },
    })
  ).id
  companyId = (
    await owner.company.create({
      data: {
        organizationId,
        name: `RAM ${nonce}`,
        addressLine1: '5062 Free Pike',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
      },
    })
  ).id
  userId = (
    await owner.user.create({
      data: { email: `disp-${nonce}@example.test`, name: 'Disp' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  driverId = (
    await owner.driver.create({
      data: { organizationId, companyId, firstName: 'ON', lastName: 'ROAD' },
    })
  ).id
  idleDriverId = (
    await owner.driver.create({
      data: { organizationId, companyId, firstName: 'IDLE', lastName: 'HAND' },
    })
  ).id
  truckId = (
    await owner.truck.create({
      data: {
        organizationId,
        companyId,
        unitNumber: `T-${nonce}`,
        vin: `VIN${nonce}00000000`,
      },
    })
  ).id
  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BROKER ${nonce}` }),
    )
  ).id
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

async function seedLoad(over: {
  pickupCity: string
  deliveryCity: string
  status?: string
  windowEnd?: Date | null
  arrivedAt?: Date | null
}) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        referenceNumber: `D-${nonce}-${Math.random().toString(36).slice(2, 7)}`,
        stops: [
          {
            type: 'PICKUP',
            city: over.pickupCity,
            state: 'IN',
            scheduledAt: hours(-24),
          },
          {
            type: 'DELIVERY',
            city: over.deliveryCity,
            state: 'NC',
            scheduledAt: hours(-2),
          },
        ],
        linehaulCents: 100_000,
      },
      { byUserId: userId },
    ),
  )
  await owner.load.update({
    where: { id: load.id },
    data: {
      truckId,
      driverId,
      ...(over.status
        ? { operationalStatus: over.status as 'IN_TRANSIT' }
        : {}),
    },
  })
  if (over.windowEnd !== undefined || over.arrivedAt !== undefined) {
    const delivery = await owner.loadStop.findFirstOrThrow({
      where: { loadId: load.id, type: 'DELIVERY' },
      orderBy: { sequence: 'desc' },
    })
    await owner.loadStop.update({
      where: { id: delivery.id },
      data: {
        ...(over.windowEnd !== undefined ? { windowEnd: over.windowEnd } : {}),
        ...(over.arrivedAt !== undefined ? { arrivedAt: over.arrivedAt } : {}),
      },
    })
  }
  return load.id
}

describe('heading to', () => {
  it('is the destination of the load the truck is on', async () => {
    await seedLoad({
      pickupCity: 'Whiteland',
      deliveryCity: 'Gastonia',
      status: 'IN_TRANSIT',
    })
    const out = await inOrg((tx) => headingToForTrucks(tx, [truckId]))
    expect(out.get(truckId)).toBe('Gastonia, NC')
  })

  it('is blank for a truck with nothing open', async () => {
    const spare = await owner.truck.create({
      data: {
        organizationId,
        companyId,
        unitNumber: `S-${nonce}`,
        vin: `VIN${nonce}11111111`,
      },
    })
    const out = await inOrg((tx) => headingToForTrucks(tx, [spare.id]))
    expect(out.get(spare.id)).toBeNull()
  })
})

describe('dispatch status', () => {
  it('reads In transit off the freight', async () => {
    const facts = await inOrg((tx) =>
      dispatchFactsForDrivers(tx, [driverId, idleDriverId]),
    )
    expect(dispatchStatusFrom(facts.get(driverId)!, NOW)).toBe('in_transit')
  })

  it('reads Available for a driver with none', async () => {
    const facts = await inOrg((tx) =>
      dispatchFactsForDrivers(tx, [driverId, idleDriverId]),
    )
    expect(dispatchStatusFrom(facts.get(idleDriverId)!, NOW)).toBe('available')
  })

  it('reads Off duty once the flag is set, despite the freight', async () => {
    await owner.driver.update({
      where: { id: driverId },
      data: { isOffDuty: true, offDutyUntil: hours(48) },
    })
    const facts = await inOrg((tx) => dispatchFactsForDrivers(tx, [driverId]))
    expect(dispatchStatusFrom(facts.get(driverId)!, NOW)).toBe('off_duty')

    await owner.driver.update({
      where: { id: driverId },
      data: { isOffDuty: false, offDutyUntil: null },
    })
  })

  it('refuses a return date on a driver who is not off duty', async () => {
    // The CHECK: the one contradiction this pair can express.
    await expect(
      owner.driver.update({
        where: { id: idleDriverId },
        data: { isOffDuty: false, offDutyUntil: hours(24) },
      }),
    ).rejects.toThrow(/Driver_off_duty_until_needs_off_duty|violates check/i)
  })
})

describe('last activity', () => {
  it('is the latest thing that touched the driver', async () => {
    const out = await inOrg((tx) =>
      lastActivityForDrivers(tx, [driverId, idleDriverId]),
    )
    const seen = out.get(driverId)
    expect(seen).not.toBeNull()
    // Creating the load wrote a status event; it cannot be older than the run.
    expect(seen!.getTime()).toBeGreaterThan(NOW.getTime() - 3_600_000)
  })

  it('is null for a driver nothing has touched', async () => {
    const out = await inOrg((tx) => lastActivityForDrivers(tx, [idleDriverId]))
    expect(out.get(idleDriverId)).toBeNull()
  })
})

describe('on-time delivery', () => {
  it('is late when the check-in is after the window', async () => {
    const id = await seedLoad({
      pickupCity: 'Etna',
      deliveryCity: 'Lexington',
      windowEnd: hours(-6),
      arrivedAt: hours(-1),
    })
    const facts = await inOrg((tx) => deliveryFactsForLoads(tx, [id]))
    expect(onTimeFrom(facts.get(id)!)).toBe('late')
  })

  it('is unknown with no check-in recorded', async () => {
    const id = await seedLoad({
      pickupCity: 'Etna',
      deliveryCity: 'Columbus',
      windowEnd: hours(-6),
      arrivedAt: null,
    })
    const facts = await inOrg((tx) => deliveryFactsForLoads(tx, [id]))
    expect(onTimeFrom(facts.get(id)!)).toBe('unknown')
  })
})

// ── THE COST ───────────────────────────────────────────────────────────
describe('what a list costs', () => {
  it('asks the same number of questions for twenty drivers as for one', async () => {
    // THE GUARD NAMED "a fan-out". Correct either way, which is why it is
    // counted against a live client rather than reviewed.
    const { PrismaClient } = await import('@/generated/prisma/client')
    const { PrismaNeon } = await import('@prisma/adapter-neon')

    const countFor = async (ids: string[]) => {
      const client = new PrismaClient({
        adapter: new PrismaNeon({
          connectionString: process.env.DIRECT_DATABASE_URL!,
        }),
        log: [{ emit: 'event', level: 'query' }],
      })
      let count = 0
      client.$on('query', () => {
        count += 1
      })
      await client.$queryRaw`select 1`
      const before = count
      await dispatchFactsForDrivers(client as never, ids)
      await lastActivityForDrivers(client as never, ids)
      const used = count - before
      await client.$disconnect()
      return used
    }

    const one = await countFor([driverId])
    const twenty = await countFor(Array.from({ length: 20 }, () => driverId))

    expect(one).toBeGreaterThan(0)
    expect(
      twenty,
      `one driver cost ${one} statements, twenty cost ${twenty}`,
    ).toBe(one)
  })
})
