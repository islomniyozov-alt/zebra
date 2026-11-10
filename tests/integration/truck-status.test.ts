import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { companyScopeFilter, withOrg, type TxClient } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { listedAuthorities } from '@/lib/companies'
import { createLoad, LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { viewContext } from '@/lib/load-views'
import {
  listWhere as loadsListWhere,
  loadListWhere,
  readLoadListParams,
} from '@/lib/load-list'
import {
  derivedStatusWhere,
  listWhere,
  readTruckListParams,
  statusChipWhere,
  TRUCK_STATUS_ORDER,
  truckListWhere,
} from '@/lib/truck-list'
import { truckListCounts } from '@/lib/truck-list-counts'
import { readTruckListData, readTruckListExport } from '@/lib/truck-list-page'
import type {
  LoadOperationalStatus,
  PrismaClient,
  TruckStatus,
} from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE DERIVED STATUS, AGAINST REAL POSTGRES (§6.5 part 1 round two).
//
// Nine trucks the seed never makes, every stored word AVAILABLE unless said:
//   moving     on a load IN_TRANSIT              → In transit
//   atPickup   on a load AT_PICKUP                → In transit (the board's set)
//   booked     on a load BOOKED                   → Dispatched
//   both       on a BOOKED and an IN_TRANSIT load → In transit (the road wins)
//   idle       no load                            → Available
//   done       on a DELIVERED load only           → Available
//   cancelled  on a cancelled DISPATCHED load     → Available
//   history    on a DISPATCHED load closed in Datatruck → Available
//   shop       stored MAINTENANCE, on an IN_TRANSIT load → In maintenance
//   stale      stored IN_TRANSIT, no load         → Available
//
// The SQL counts, the Prisma predicate and the rows agree per status, and
// every truck counted on the road or dispatched is the truck of a load the
// LOADS LIST lists under that status — both above zero.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
const nonce = Math.random().toString(36).slice(2, 8)
const NOW = new Date('2026-11-10T18:00:00Z')

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'truck-status.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const unit = (key: string) => `${key}-${nonce}`
const ids: Record<string, string> = {}

async function truck(key: string, status: TruckStatus = 'AVAILABLE') {
  const row = await owner.truck.create({
    data: { organizationId, companyId, unitNumber: unit(key), status },
    select: { id: true },
  })
  ids[key] = row.id
  return row.id
}

async function load(
  truckId: string,
  status: LoadOperationalStatus,
  over: { cancelled?: boolean; closedHistory?: boolean } = {},
) {
  const created = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        referenceNumber: `S-${Math.random().toString(36).slice(2, 7)}-${nonce}`,
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
      operationalStatus: status,
      isCancelled: over.cancelled ?? false,
      ...(over.closedHistory ? { billingStatus: 'CLOSED_IN_DATATRUCK' } : {}),
    },
  })
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Truck status ${nonce}`,
      slug: `truck-status-${nonce}`,
      maxCompanies: 2,
      companies: { create: [{ name: `Alpha ${nonce}`, isDefault: true }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  const user = await owner.user.create({
    data: { email: `truck-status-${nonce}@example.test`, name: 'Status' },
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

  await load(await truck('moving'), 'IN_TRANSIT')
  await load(await truck('atPickup'), 'AT_PICKUP')
  await load(await truck('booked'), 'BOOKED')
  const both = await truck('both')
  await load(both, 'BOOKED')
  await load(both, 'IN_TRANSIT')
  await truck('idle')
  await load(await truck('done'), 'DELIVERED')
  await load(await truck('cancelled'), 'DISPATCHED', { cancelled: true })
  await load(await truck('history'), 'DISPATCHED', { closedHistory: true })
  await load(await truck('shop', 'MAINTENANCE'), 'IN_TRANSIT')
  await truck('stale', 'IN_TRANSIT')
})

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

const EXPECTED: Record<string, string[]> = {
  IN_TRANSIT: ['atPickup', 'both', 'moving'],
  DISPATCHED: ['booked'],
  AVAILABLE: ['cancelled', 'done', 'history', 'idle', 'stale'],
  MAINTENANCE: ['shop'],
  OUT_OF_SERVICE: [],
  SOLD: [],
}

const keysOf = (rows: readonly { unitNumber: string }[]) =>
  rows.map((row) => row.unitNumber.replace(`-${nonce}`, '')).sort()

describe('each status, three ways', () => {
  it.each(TRUCK_STATUS_ORDER)(
    '%s: the SQL chip, the Prisma predicate and the rows agree',
    async (status) => {
      const params = readTruckListParams({ status })
      await inOrg(async (tx) => {
        const where = truckListWhere(params, companyScopeFilter([]))
        const listed = await tx.truck.findMany({
          where: listWhere(where),
          select: { unitNumber: true },
        })
        expect(keysOf(listed)).toEqual(EXPECTED[status])
        const counts = await truckListCounts(tx, params, [])
        expect(counts.views.active).toBe(EXPECTED[status]!.length)
        // And the footer chip for this status, under no filter, says the same.
        const chips = await truckListCounts(tx, readTruckListParams({}), [])
        expect(chips.status[status]).toBe(EXPECTED[status]!.length)
        expect(
          await tx.truck.count({
            where: statusChipWhere(
              truckListWhere(readTruckListParams({}), companyScopeFilter([])),
              status,
            ),
          }),
        ).toBe(EXPECTED[status]!.length)
        // The rows the page renders carry the same derived value.
        const data = await readTruckListData(tx, [], readTruckListParams({}), {
          now: NOW,
          take: 500,
        })
        expect(
          keysOf(data.rows.filter((row) => row.status === status)),
        ).toEqual(EXPECTED[status])
      })
    },
    300_000,
  )

  it('every chip above zero where the fixture puts a truck, and the footer sums to the fleet', async () => {
    const counts = await inOrg((tx) =>
      truckListCounts(tx, readTruckListParams({}), []),
    )
    expect(counts.status.IN_TRANSIT).toBe(3)
    expect(counts.status.DISPATCHED).toBe(1)
    expect(counts.status.AVAILABLE).toBe(5)
    expect(counts.status.MAINTENANCE).toBe(1)
    expect(counts.matching).toBe(10)
  }, 120_000)
})

describe("against the loads list's own predicates", () => {
  /** The truck ids of the loads the LOADS LIST lists under `?status=`. */
  async function trucksTheLoadsListShows(
    tx: TxClient,
    status: LoadOperationalStatus,
  ): Promise<Set<string>> {
    const authorities = await listedAuthorities(tx, [])
    const ctx = viewContext(authorities, NOW)
    const where = loadListWhere(
      readLoadListParams({ status }),
      companyScopeFilter([]),
      ctx,
    )
    const loads = await tx.load.findMany({
      where: {
        AND: [
          loadsListWhere(where),
          { isCancelled: false, billingStatus: { not: 'CLOSED_IN_DATATRUCK' } },
        ],
      },
      select: { truckId: true },
    })
    return new Set(loads.flatMap((row) => (row.truckId ? [row.truckId] : [])))
  }

  it('a truck In transit is the truck of a load the list shows as moving, above zero', async () => {
    await inOrg(async (tx) => {
      const inTransit = await tx.truck.findMany({
        where: derivedStatusWhere('IN_TRANSIT'),
        select: { id: true },
      })
      expect(inTransit.length).toBe(3)
      const shown = new Set<string>()
      for (const status of [
        'AT_PICKUP',
        'LOADED',
        'IN_TRANSIT',
        'AT_DELIVERY',
      ] as const) {
        for (const id of await trucksTheLoadsListShows(tx, status))
          shown.add(id)
      }
      for (const truck of inTransit) expect(shown.has(truck.id)).toBe(true)
      // And the shop truck's load is shown too — the override is the truck's
      // word, not the load's — so the loads list and this column may differ
      // on exactly the overrides, and nothing else.
      expect(shown.has(ids['shop']!)).toBe(true)
      expect(shown.size).toBe(4)
    })
  }, 120_000)

  it('a truck Dispatched is the truck of a load the list shows as booked or dispatched, and of no moving one', async () => {
    await inOrg(async (tx) => {
      const dispatched = await tx.truck.findMany({
        where: derivedStatusWhere('DISPATCHED'),
        select: { id: true },
      })
      expect(dispatched.map((t) => t.id)).toEqual([ids['booked']])
      const booked = await trucksTheLoadsListShows(tx, 'BOOKED')
      const onTheRoad = await trucksTheLoadsListShows(tx, 'IN_TRANSIT')
      expect(booked.has(ids['booked']!)).toBe(true)
      expect(onTheRoad.has(ids['booked']!)).toBe(false)
      // `both` has a BOOKED load too, and is In transit because it also moves.
      expect(booked.has(ids['both']!)).toBe(true)
    })
  }, 120_000)

  it('a truck Available is the truck of no open load the list shows', async () => {
    await inOrg(async (tx) => {
      const available = await tx.truck.findMany({
        where: derivedStatusWhere('AVAILABLE'),
        select: { id: true },
      })
      expect(available.length).toBe(5)
      const open = new Set<string>()
      for (const status of [
        'AVAILABLE',
        'BOOKED',
        'DISPATCHED',
        'AT_PICKUP',
        'LOADED',
        'IN_TRANSIT',
        'AT_DELIVERY',
      ] as const) {
        for (const id of await trucksTheLoadsListShows(tx, status)) open.add(id)
      }
      for (const truck of available) expect(open.has(truck.id)).toBe(false)
    })
  }, 120_000)

  it('the export writes the derived status and the override side by side', async () => {
    const exported = await inOrg((tx) =>
      readTruckListExport(
        tx,
        { userId, companyScopes: [] },
        readTruckListParams({ status: 'MAINTENANCE' }),
        NOW,
      ),
    )
    expect(exported.rowCount).toBe(1)
    expect(exported.body).toContain(`${unit('shop')},`)
    expect(exported.body).toContain(',MAINTENANCE,MAINTENANCE,')
    const stale = await inOrg((tx) =>
      readTruckListExport(
        tx,
        { userId, companyScopes: [] },
        readTruckListParams({ q: unit('stale') }),
        NOW,
      ),
    )
    expect(stale.body).toContain(',AVAILABLE,,')
  }, 120_000)
})
