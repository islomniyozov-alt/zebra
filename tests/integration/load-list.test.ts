import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg, type TxClient } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { listedAuthorities } from '@/lib/companies'
import { viewContext, type LoadViewName } from '@/lib/load-views'
import {
  listWhere,
  loadListWhere,
  readLoadListParams,
  viewCountWhere,
} from '@/lib/load-list'
import { zoneMidnight, zoneWallClock } from '@/lib/stop-time'
import type {
  LoadBillingStatus,
  LoadOperationalStatus,
  PrismaClient,
} from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE LOADS LIST'S VIEWS, AGAINST REAL POSTGRES (TMS-DESIGN-SYSTEM.md §6.7).
//
// THE OWNER'S TEST: each counted chip's number equals the rows the list shows
// for that view, BOTH ABOVE ZERO, on rows the seed never makes:
//
//   * an Eastern stop stored at midnight in New York, which a Chicago reading
//     puts on the day before;
//   * a Relay-shaped stop with no state, at 23:30 in its authority's New York
//     zone, which a UTC reading puts on the day after;
//   * a load with two deliveries in different weeks, where only the FINAL one
//     decides "delivers this week".
//
// Both sides go through `load-list.ts`, which is what the page calls, and the
// membership of each view is asserted by load, not by count, because two wrong
// sets can have the same size.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let userId = ''
let chicagoId = ''
let newYorkId = ''
let brokerId = ''
let driverId = ''
const nonce = Math.random().toString(36).slice(2, 8)

/** A fixed Wednesday, far from a DST change. Chicago's date is 2026-11-18. */
const NOW = new Date('2026-11-18T18:00:00Z')
const CHI = 'America/Chicago'
const NYC = 'America/New_York'

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'load-list.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const ids: Record<string, string> = {}
const numbers: Record<string, string> = {}

interface Stop {
  type: 'PICKUP' | 'DELIVERY'
  state: string | null
  name?: string
  at: Date
}

async function book(
  key: string,
  companyId: string,
  stops: Stop[],
  status: LoadOperationalStatus,
  billing: LoadBillingStatus = 'UNINVOICED',
) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        stops: stops.map((stop) => ({
          type: stop.type,
          state: stop.state,
          city: stop.state ? 'City' : null,
          name: stop.name ?? null,
          scheduledAt: stop.at,
        })),
      },
      { byUserId: userId },
    ),
  )
  // The states are fixtures, set directly: the engine's transitions are not
  // what this file tests.
  await owner.load.update({
    where: { id: load.id },
    data: { operationalStatus: status, billingStatus: billing },
  })
  ids[key] = load.id
  numbers[key] = load.loadNumber
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Load list ${nonce}`,
      slug: `load-list-${nonce}`,
      maxCompanies: 2,
      companies: {
        create: [
          { name: `Chicago ${nonce}`, timezone: CHI, isDefault: true },
          { name: `New York ${nonce}`, timezone: NYC },
        ],
      },
    },
    include: { companies: { orderBy: { name: 'asc' } } },
  })
  organizationId = organization.id
  chicagoId = organization.companies.find((c) => c.timezone === CHI)!.id
  newYorkId = organization.companies.find((c) => c.timezone === NYC)!.id

  const user = await owner.user.create({
    data: { email: `load-list-${nonce}@example.test`, name: 'List Tester' },
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
  driverId = (
    await owner.driver.create({
      data: {
        organizationId,
        companyId: chicagoId,
        firstName: 'Seat',
        lastName: `Two ${nonce}`,
      },
    })
  ).id

  // Upcoming: an Illinois pickup three days out.
  await book(
    'illinois',
    chicagoId,
    [
      { type: 'PICKUP', state: 'IL', at: zoneMidnight('2026-11-21', CHI) },
      { type: 'DELIVERY', state: 'TX', at: zoneMidnight('2026-11-22', CHI) },
    ],
    'BOOKED',
  )
  // Upcoming, ONLY IF DATED IN ITS AUTHORITY'S ZONE: no state, 23:30 in New
  // York on day seven, which is 04:30 UTC on day eight.
  await book(
    'relay',
    newYorkId,
    [
      {
        type: 'PICKUP',
        state: null,
        name: 'DFW6',
        at: zoneWallClock('2026-11-25', 23, 30, NYC),
      },
      {
        type: 'DELIVERY',
        state: null,
        name: 'MEM1',
        at: zoneWallClock('2026-11-26', 18, 0, NYC),
      },
    ],
    'BOOKED',
  )
  // Picks up today, ONLY IF DATED IN ITS STATE'S ZONE: midnight in New York is
  // 23:00 the day before in Chicago.
  await book(
    'eastern',
    chicagoId,
    [
      { type: 'PICKUP', state: 'NY', at: zoneMidnight('2026-11-18', NYC) },
      { type: 'DELIVERY', state: 'IL', at: zoneMidnight('2026-11-28', CHI) },
    ],
    'BOOKED',
  )
  // Not upcoming: day eight.
  await book(
    'dayEight',
    chicagoId,
    [
      { type: 'PICKUP', state: 'IL', at: zoneMidnight('2026-11-26', CHI) },
      { type: 'DELIVERY', state: 'TX', at: zoneMidnight('2026-11-27', CHI) },
    ],
    'BOOKED',
  )
  // Unpaid, and its FINAL delivery is this week (Sun 11-15 to Sat 11-21).
  await book(
    'owed',
    chicagoId,
    [
      { type: 'PICKUP', state: 'IL', at: zoneMidnight('2026-11-16', CHI) },
      { type: 'DELIVERY', state: 'TX', at: zoneMidnight('2026-11-20', CHI) },
    ],
    'DELIVERED',
    'UNINVOICED',
  )
  // Paid, so not unpaid. A delivery this week, but the FINAL one is next week.
  await book(
    'paid',
    chicagoId,
    [
      { type: 'PICKUP', state: 'IL', at: zoneMidnight('2026-11-16', CHI) },
      { type: 'DELIVERY', state: 'TX', at: zoneMidnight('2026-11-19', CHI) },
      { type: 'DELIVERY', state: 'OK', at: zoneMidnight('2026-11-23', CHI) },
    ],
    'DELIVERED',
    'PAID',
  )
  // Written off is a decision, not a debt.
  await book(
    'writtenOff',
    chicagoId,
    [
      { type: 'PICKUP', state: 'IL', at: zoneMidnight('2026-11-08', CHI) },
      { type: 'DELIVERY', state: 'TX', at: zoneMidnight('2026-11-10', CHI) },
    ],
    'POD_RECEIVED',
    'WRITTEN_OFF',
  )
  // Closed history: no queue counts it, and a date range still finds it.
  await book(
    'archive',
    chicagoId,
    [
      { type: 'PICKUP', state: 'IL', at: zoneMidnight('2026-11-11', CHI) },
      { type: 'DELIVERY', state: 'TX', at: zoneMidnight('2026-11-12', CHI) },
    ],
    'DELIVERED',
    'CLOSED_IN_DATATRUCK',
  )
  // The driver sits in the second seat of one load and the first of another.
  await owner.load.update({
    where: { id: ids['illinois']! },
    data: { driverId },
  })
  await owner.load.update({
    where: { id: ids['relay']! },
    data: { coDriverId: driverId },
  })
}, 600_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

/** The ids the list shows for these URL params, and the chip's count. */
async function read(
  query: Record<string, string>,
  chip?: LoadViewName,
): Promise<{ listed: string[]; chipCount: number | null }> {
  return inOrg(async (tx) => {
    const ctx = viewContext(await listedAuthorities(tx, []), NOW)
    const where = loadListWhere(readLoadListParams(query), {}, ctx)
    const rows = await tx.load.findMany({
      where: listWhere(where),
      select: { id: true },
    })
    const listed = rows.map((row) => row.id)
    if (chip === undefined) return { listed, chipCount: null }
    // THE CHIP IS COUNTED FROM THE LIST WITH NO VIEW, as the page does.
    const bare = loadListWhere(
      readLoadListParams({ ...query, view: '' }),
      {},
      ctx,
    )
    const chipCount = await tx.load.count({
      where: viewCountWhere(bare, chip, ctx),
    })
    return { listed, chipCount }
  })
}

const keysOf = (listed: string[]) =>
  Object.keys(ids)
    .filter((key) => listed.includes(ids[key]!))
    .sort()

describe('each counted chip agrees with its list, both above zero', () => {
  it('Upcoming: booked, first pickup today through day seven', async () => {
    const { listed, chipCount } = await read({ view: 'upcoming' }, 'upcoming')
    expect(keysOf(listed)).toEqual(['eastern', 'illinois', 'relay'])
    expect(chipCount).toBe(listed.length)
    expect(chipCount).toBeGreaterThan(0)
  }, 300_000)

  it('Unpaid: delivered or POD in, and still owed', async () => {
    const { listed, chipCount } = await read({ view: 'unpaid' }, 'unpaid')
    expect(keysOf(listed)).toEqual(['owed'])
    expect(chipCount).toBe(listed.length)
    expect(chipCount).toBeGreaterThan(0)
  }, 300_000)
})

describe('the date views read each stop on its own day', () => {
  it('Picks up today finds the New York midnight a Chicago reading misses', async () => {
    const { listed } = await read({ view: 'picksUpToday' })
    expect(keysOf(listed)).toEqual(['eastern'])
  }, 300_000)

  it('Delivers this week reads the FINAL delivery', async () => {
    const { listed } = await read({ view: 'deliversThisWeek' })
    expect(keysOf(listed)).toEqual(['owed'])
  }, 300_000)

  it('a pickup range finds the stateless stop on its authority-zone day', async () => {
    const { listed } = await read({
      view: 'pickup',
      from: '2026-11-25',
      to: '2026-11-25',
    })
    expect(keysOf(listed)).toEqual(['relay'])
  }, 300_000)

  it('a delivery range keeps the archive and the paid', async () => {
    const { listed } = await read({
      view: 'delivery',
      from: '2026-11-10',
      to: '2026-11-23',
    })
    // Illinois delivers on the 22nd and Paid's FINAL delivery is the 23rd, both
    // inside. The archive load is closed history, and a range keeps it.
    expect(keysOf(listed)).toEqual([
      'archive',
      'illinois',
      'owed',
      'paid',
      'writtenOff',
    ])
  }, 300_000)
})

describe('filters combine, and none overwrites another', () => {
  it('a reference search survives a view that carries its own OR', async () => {
    // `unassigned` is an OR over the two seats, and the search is an OR over
    // two columns. Spread into one object, the second replaced the first.
    const { listed } = await read({
      view: 'unassigned',
      ref: numbers['dayEight']!,
    })
    expect(keysOf(listed)).toEqual(['dayEight'])
  }, 300_000)

  it('the driver filter matches either seat', async () => {
    const { listed } = await read({ driver: driverId })
    expect(keysOf(listed)).toEqual(['illinois', 'relay'])
  }, 300_000)

  it('the broker filter narrows to the broker', async () => {
    const { listed } = await read({ customer: brokerId })
    expect(listed).toHaveLength(Object.keys(ids).length)
    const { listed: none } = await read({ customer: 'no-such-broker' })
    expect(none).toEqual([])
  }, 300_000)
})
