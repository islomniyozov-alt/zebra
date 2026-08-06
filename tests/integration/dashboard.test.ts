import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { transitionOperational } from '@/lib/load-status'
import { setLoadRate } from '@/lib/rates'
import { actionQueue, fleetGlance, thisWeek } from '@/lib/dashboard'
import type { AuthorizedSession } from '@/lib/permissions'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// The dashboard against real Postgres.
//
// The role filtering and the week boundary are covered in tests/dashboard.test.ts.
// What can only be asserted here: that the counts are COUNTS — that a load
// moving from delivered to POD-received moves it from one queue row to another
// without anything being told to recalculate, and that the week is scoped per
// authority rather than summed.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let alphaId = ''
let betaId = ''
let userId = ''
let brokerId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'dashboard.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

const asOwner = (): AuthorizedSession => ({
  userId,
  organizationId,
  role: 'OWNER',
  companyScopes: [],
})

const rowFor = async (key: string, scope = {}) =>
  (await inOrg((tx) => actionQueue(tx, asOwner(), scope))).find(
    (row) => row.key === key,
  )

async function bookLoad(companyId: string, day: number) {
  return inOrg((tx) =>
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
            scheduledAt: new Date(Date.UTC(2026, 10, day)),
          },
          {
            type: 'DELIVERY',
            city: 'Dallas',
            state: 'TX',
            scheduledAt: new Date(Date.UTC(2026, 10, day + 1)),
          },
        ],
      },
      { byUserId: userId },
    ),
  )
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Dashboard ${nonce}`,
      slug: `dashboard-${nonce}`,
      maxCompanies: 5,
      companies: {
        create: [{ name: `Alpha ${nonce}` }, { name: `Beta ${nonce}` }],
      },
    },
    include: { companies: { orderBy: { name: 'asc' } } },
  })
  organizationId = organization.id
  alphaId = organization.companies[0]!.id
  betaId = organization.companies[1]!.id

  const user = await owner.user.create({
    data: { email: `dashboard-${nonce}@example.test`, name: 'Dash Tester' },
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
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('the queue counts real state', () => {
  it('moves a load between rows as its own status changes', async () => {
    const load = await bookLoad(alphaId, 3)

    // Booked with nothing assigned — the dispatch row.
    expect((await rowFor('unassigned'))?.count).toBe(1)
    expect(await rowFor('podMissing')).toBeUndefined()

    await inOrg((tx) =>
      transitionOperational(tx, load.id, 'DELIVERED', {
        source: 'MANUAL',
        userId,
      }),
    )
    // Delivered, no POD. It left the dispatch row without being told to.
    expect((await rowFor('podMissing'))?.count).toBe(1)
    expect(await rowFor('unassigned')).toBeUndefined()

    await inOrg((tx) =>
      transitionOperational(tx, load.id, 'POD_RECEIVED', {
        source: 'AUTOMATIC',
        userId,
      }),
    )
    // POD in, no rate — a different row again, and NOT ready to invoice,
    // because a load with no rate cannot be billed.
    expect(await rowFor('podMissing')).toBeUndefined()
    expect((await rowFor('noRate'))?.count).toBe(1)
    expect(await rowFor('readyToInvoice')).toBeUndefined()

    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '2450', fuelSurcharge: '0' }),
    )
    expect(await rowFor('noRate')).toBeUndefined()
    expect((await rowFor('readyToInvoice'))?.count).toBe(1)
  }, 300_000)

  it('drops a row entirely rather than showing a nought', async () => {
    // A queue of zeroes is a queue nobody reads. Every row present has work in
    // it, which is why the empty state can be an invitation rather than a list
    // of noughts.
    const rows = await inOrg((tx) => actionQueue(tx, asOwner(), {}))
    expect(rows.every((row) => row.count > 0)).toBe(true)
  }, 300_000)

  it('respects the authority scope', async () => {
    await bookLoad(betaId, 5)

    const alphaOnly = await inOrg((tx) =>
      actionQueue(tx, asOwner(), { companyId: { in: [alphaId] } }),
    )
    const betaOnly = await inOrg((tx) =>
      actionQueue(tx, asOwner(), { companyId: { in: [betaId] } }),
    )

    // Beta's load is booked and unassigned; Alpha's has moved on to invoicing.
    expect(betaOnly.find((row) => row.key === 'unassigned')?.count).toBe(1)
    expect(alphaOnly.find((row) => row.key === 'unassigned')).toBeUndefined()
    expect(alphaOnly.find((row) => row.key === 'readyToInvoice')?.count).toBe(1)
  }, 300_000)

  it('never counts a row the session cannot read', async () => {
    // The dispatcher's queue is built from a shorter list of specs, so the
    // money queries are not issued at all — proven here by the rows that come
    // back rather than by inspecting the SQL.
    const dispatcher: AuthorizedSession = { ...asOwner(), role: 'DISPATCHER' }
    const rows = await inOrg((tx) => actionQueue(tx, dispatcher, {}))

    expect(rows.map((row) => row.key)).not.toContain('readyToInvoice')
    expect(rows.map((row) => row.key)).not.toContain('noRate')
  }, 300_000)
})

describe('the fleet at a glance', () => {
  it('counts live equipment and excludes what has gone', async () => {
    await owner.truck.createMany({
      data: [
        { organizationId, companyId: alphaId, unitNumber: `T1-${nonce}` },
        {
          organizationId,
          companyId: alphaId,
          unitNumber: `T2-${nonce}`,
          status: 'SOLD',
        },
      ],
    })
    await owner.driver.create({
      data: {
        organizationId,
        companyId: alphaId,
        firstName: 'Gone',
        lastName: `Away ${nonce}`,
        status: 'INACTIVE',
      },
    })

    const glance = await inOrg((tx) => fleetGlance(tx, {}))
    // The sold truck and the inactive driver are equipment the carrier no
    // longer has; counting them makes the fleet look bigger than it is.
    expect(glance.trucksPaired + glance.trucksIdle).toBe(1)
    expect(glance.driversPaired + glance.driversIdle).toBe(0)
  }, 300_000)

  it('splits by assignment state, and a retired driver frees the truck', async () => {
    const truck = await owner.truck.create({
      data: { organizationId, companyId: alphaId, unitNumber: `P1-${nonce}` },
    })
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId: alphaId,
        firstName: 'Paired',
        lastName: `Up ${nonce}`,
        assignedTruckId: truck.id,
      },
    })

    const paired = await inOrg((tx) => fleetGlance(tx, {}))
    expect(paired.trucksPaired).toBe(1)
    expect(paired.driversPaired).toBe(1)

    // RETIRE THE DRIVER. The truck must go back to idle rather than staying
    // spoken for by somebody who no longer works here — which is why the
    // count uses `none` over the live-driver filter and not `NOT some`.
    await owner.driver.update({
      where: { id: driver.id },
      data: { status: 'INACTIVE' },
    })

    const after = await inOrg((tx) => fleetGlance(tx, {}))
    expect(after.trucksPaired).toBe(0)
    expect(after.trucksIdle).toBe(paired.trucksIdle + 1)
    expect(after.driversPaired).toBe(0)
  }, 300_000)
})

describe('this week, per authority', () => {
  it('gives every authority a row, including one that hauled nothing', async () => {
    const week = await inOrg((tx) =>
      thisWeek(tx, [alphaId, betaId], new Date('2026-11-05T12:00:00Z')),
    )

    // A MISSING row reads as a bug; a zero reads as a quiet week.
    expect(week).toHaveLength(2)
    expect(week.every((row) => row.companyName.length > 0)).toBe(true)
  }, 300_000)

  it('counts a load in the week it was DELIVERED, and only that week', async () => {
    const load = await bookLoad(alphaId, 20)
    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '1500', fuelSurcharge: '0' }),
    )
    await inOrg((tx) =>
      transitionOperational(tx, load.id, 'DELIVERED', {
        source: 'MANUAL',
        userId,
        occurredAt: new Date(Date.UTC(2026, 10, 4, 9, 0)),
      }),
    )

    // Wednesday 4 November 2026 is in the week beginning Monday the 2nd.
    const inWeek = await inOrg((tx) =>
      thisWeek(tx, [alphaId], new Date('2026-11-06T12:00:00Z')),
    )
    expect(inWeek[0]).toMatchObject({
      delivered: 1,
      revenueCents: 150000,
      // Not factored, so the whole of it is the carrier's to collect. The two
      // split the revenue exactly, which is the property worth asserting.
      factoredCents: 0,
      directCents: 150000,
    })
    expect(inWeek[0]!.factoredCents + inWeek[0]!.directCents).toBe(
      inWeek[0]!.revenueCents,
    )

    // The following week does not see it — revenue is earned when the freight
    // moves, and it moves once.
    const nextWeek = await inOrg((tx) =>
      thisWeek(tx, [alphaId], new Date('2026-11-13T12:00:00Z')),
    )
    expect(nextWeek[0]).toMatchObject({ delivered: 0, revenueCents: 0 })
  }, 300_000)

  it('keeps the two authorities apart', async () => {
    const week = await inOrg((tx) =>
      thisWeek(tx, [alphaId, betaId], new Date('2026-11-06T12:00:00Z')),
    )
    const alpha = week.find((row) => row.companyId === alphaId)
    const beta = week.find((row) => row.companyId === betaId)

    // RAM and Dolphins are separate businesses with separate books. The screen
    // may add them up under a label that says so; the service never does.
    expect(alpha?.revenueCents).toBe(150000)
    expect(beta?.revenueCents).toBe(0)
  }, 300_000)
})
