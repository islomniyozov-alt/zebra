import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { companyScopeFilter, withOrg, type TxClient } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  listWhere,
  readTruckListParams,
  statusChipWhere,
  TRUCK_STATUS_ORDER,
  TRUCK_VIEWS,
  truckListWhere,
  viewCountWhere,
  type TruckViewName,
} from '@/lib/truck-list'
import { truckListCounts } from '@/lib/truck-list-counts'
import { readTruckListData, readTruckListExport } from '@/lib/truck-list-page'
import type { PrismaClient, TruckStatus } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE TRUCKS LIST'S VIEWS, AGAINST REAL POSTGRES (TMS-DESIGN-SYSTEM.md §6.5
// part 1).
//
// THE OWNER'S TEST: each view chip's count equals the rows the list shows for
// that view, BOTH ABOVE ZERO, on rows the seed never makes — a truck with one
// live driver, one with two, one nobody holds, one held only by a terminated
// driver (unassigned, because a terminated driver holds no seat), one held by
// a driver on vacation (held, because vacation keeps the seat), one out of
// service, one sold, one removed. The counts are ONE SQL statement and the
// list is the Prisma predicate; this file runs both and requires the same
// number per view and per status chip, and the membership by unit, because
// two wrong sets can have the same size.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const NOW = new Date('2026-11-10T12:00:00Z')

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'truck-list.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const unit = (key: string) => `${key}-${nonce}`
const ids: Record<string, string> = {}

async function truck(
  key: string,
  over: {
    status?: TruckStatus
    make?: string
    year?: number
    plate?: string
    vin?: string
    fleetStatus?: string
    removed?: boolean
  } = {},
) {
  const row = await owner.truck.create({
    data: {
      organizationId,
      companyId,
      unitNumber: unit(key),
      status: over.status ?? 'AVAILABLE',
      make: over.make ?? 'FRHT',
      year: over.year ?? 2019,
      plate: over.plate ?? `PL${key}${nonce}`.slice(0, 10).toUpperCase(),
      vin: over.vin ?? null,
      fleetStatus: over.fleetStatus ?? null,
      deletedAt: over.removed ? NOW : null,
    },
    select: { id: true },
  })
  ids[key] = row.id
  return row.id
}

async function driver(
  key: string,
  truckId: string,
  status: 'AVAILABLE' | 'VACATION' | 'INACTIVE' | 'OFF_DUTY' = 'AVAILABLE',
) {
  await owner.driver.create({
    data: {
      organizationId,
      companyId,
      firstName: key,
      lastName: nonce,
      status,
      assignedTruckId: truckId,
    },
  })
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Truck list ${nonce}`,
      slug: `truck-list-${nonce}`,
      maxCompanies: 2,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  const user = await owner.user.create({
    data: { email: `truck-list-${nonce}@example.test`, name: 'Truck Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  // Active, held by one driver.
  await driver('one', await truck('held', { make: 'VOLV', year: 2022 }))
  // Active, held by TWO — a team truck (§6.4 part 3).
  const team = await truck('team', { year: 2016 })
  await driver('seatA', team)
  await driver('seatB', team, 'OFF_DUTY')
  // Active, nobody holds it.
  await truck('idle', { year: 2015, vin: '' })
  // Active, held only by a TERMINATED driver — which is nobody.
  await driver('gone', await truck('quit', { year: 2012 }), 'INACTIVE')
  // Active, held by a driver on vacation — who keeps the seat.
  await driver(
    'away',
    await truck('vacay', { fleetStatus: 'In shop' }),
    'VACATION',
  )
  // Out of service, nobody; the one with a plate the search finds.
  await truck('shop', {
    status: 'OUT_OF_SERVICE',
    plate: `OOS${nonce}`.toUpperCase(),
  })
  // Sold, and removed: Inactive, and on no other view.
  await truck('sold', { status: 'SOLD' })
  await truck('removed', { removed: true })
})

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

const EXPECTED: Record<TruckViewName, string[]> = {
  active: ['held', 'idle', 'quit', 'shop', 'team', 'vacay'],
  unassigned: ['idle', 'quit', 'shop'],
  all: ['held', 'idle', 'quit', 'removed', 'shop', 'sold', 'team', 'vacay'],
  inactive: ['removed', 'sold'],
}

/** The list's rows under `query`, as unit keys, and the SQL counts. */
async function bothWays(query: Record<string, string>) {
  const params = readTruckListParams(query)
  return inOrg(async (tx) => {
    const where = truckListWhere(params, companyScopeFilter([]))
    const listed = await tx.truck.findMany({
      where: listWhere(where),
      select: { unitNumber: true },
      orderBy: { unitNumber: 'asc' },
    })
    const counts = await truckListCounts(tx, params, [])
    const viewCounts = Object.fromEntries(
      await Promise.all(
        TRUCK_VIEWS.map(async (view) => [
          view,
          await tx.truck.count({ where: viewCountWhere(where, view) }),
        ]),
      ),
    ) as Record<TruckViewName, number>
    return {
      params,
      keys: listed.map((row) => row.unitNumber.replace(`-${nonce}`, '')),
      counts,
      viewCounts,
    }
  })
}

describe('each view chip opens exactly the rows it counted', () => {
  it.each(TRUCK_VIEWS)(
    '%s: the SQL count, the Prisma count and the listing agree, above zero',
    async (view) => {
      const { keys, counts, viewCounts } = await bothWays({ view })
      expect(keys).toEqual(EXPECTED[view])
      expect(keys.length).toBeGreaterThan(0)
      expect(counts.views[view]).toBe(keys.length)
      expect(viewCounts[view]).toBe(keys.length)
      expect(counts.matching).toBe(keys.length)
      // And every OTHER chip, under this view, says what it would open.
      for (const other of TRUCK_VIEWS) {
        expect(counts.views[other], other).toBe(viewCounts[other])
        expect(counts.views[other], other).toBe(EXPECTED[other].length)
      }
    },
    300_000,
  )

  it('no view at all is Active', async () => {
    const { keys } = await bothWays({})
    expect(keys).toEqual(EXPECTED.active)
  }, 300_000)
})

describe("the footer's status chips report the view by the Status column", () => {
  it.each(TRUCK_VIEWS)(
    '%s: each chip equals the rows with that status, Removed apart',
    async (view) => {
      const params = readTruckListParams({ view })
      await inOrg(async (tx) => {
        const where = truckListWhere(params, companyScopeFilter([]))
        const counts = await truckListCounts(tx, params, [])
        for (const chip of [...TRUCK_STATUS_ORDER, 'REMOVED'] as const) {
          const prisma = await tx.truck.count({
            where: statusChipWhere(where, chip),
          })
          expect(counts.status[chip], `${view} ${chip}`).toBe(prisma)
        }
        // NOT VACUOUS: Available is above zero on every view but Inactive,
        // and Inactive has a sold and a removed truck.
        if (view === 'inactive') {
          expect(counts.status.SOLD).toBe(1)
          expect(counts.status.REMOVED).toBe(1)
        } else {
          expect(counts.status.AVAILABLE).toBeGreaterThan(0)
        }
        if (view === 'active' || view === 'unassigned') {
          expect(counts.status.OUT_OF_SERVICE).toBe(1)
          expect(counts.status.SOLD).toBe(0)
          expect(counts.status.REMOVED).toBe(0)
        }
      })
    },
    300_000,
  )
})

describe('every filter is ANDed, and counted both ways', () => {
  it.each<[string, Record<string, string>, string[]]>([
    ['the search finds a plate', { q: `oos${nonce}` }, ['shop']],
    ['the search finds a unit', { q: `held-${nonce}`, view: 'all' }, ['held']],
    ['make', { make: 'VOLV' }, ['held']],
    ['a year from', { yearFrom: '2019' }, ['held', 'shop', 'vacay']],
    [
      'a year range',
      { yearFrom: '2012', yearTo: '2016' },
      ['idle', 'quit', 'team'],
    ],
    [
      'a year to, Inactive',
      { yearTo: '2019', view: 'inactive' },
      ['removed', 'sold'],
    ],
    ['fleet status', { fleet: 'In shop' }, ['vacay']],
    [
      'status, under Unassigned',
      { status: 'AVAILABLE', view: 'unassigned' },
      ['idle', 'quit'],
    ],
    [
      'status, under All, finds the sold one',
      { status: 'SOLD', view: 'all' },
      ['sold'],
    ],
    [
      'the health filter, live rows only, on All',
      { missing: 'vin', view: 'all' },
      EXPECTED.all.filter((k) => k !== 'removed'),
    ],
    ['the health filter on Active', { missing: 'vin' }, EXPECTED.active],
  ])(
    '%s',
    async (_name, query, expected) => {
      const { params, keys, counts, viewCounts } = await bothWays(query)
      expect(keys).toEqual(expected)
      expect(keys.length).toBeGreaterThan(0)
      expect(counts.views[params.view]).toBe(keys.length)
      for (const view of TRUCK_VIEWS) {
        expect(counts.views[view], view).toBe(viewCounts[view])
      }
    },
    300_000,
  )
})

describe('the export is the list, every row of it', () => {
  it.each<Record<string, string>>([
    {},
    { view: 'unassigned' },
    { view: 'inactive' },
    { make: 'FRHT', yearFrom: '2015' },
  ])(
    'export row count equals the list for %j, above zero',
    async (query) => {
      const params = readTruckListParams(query)
      const { listed, exported } = await inOrg(async (tx) => ({
        listed: await readTruckListData(tx, [], params, {
          now: NOW,
          take: 500,
        }),
        exported: await readTruckListExport(
          tx,
          { userId, companyScopes: [] },
          params,
          NOW,
        ),
      }))
      expect(exported.rowCount).toBe(listed.rows.length)
      expect(exported.rowCount).toBeGreaterThan(0)
      expect(listed.counts.matching).toBe(listed.rows.length)
      const lines = exported.body.replace(/^﻿/, '').split('\r\n')
      expect(lines.filter((line) => line !== '')).toHaveLength(
        exported.rowCount + 1,
      )
      // The default visible columns of a single-authority fleet, as codes.
      expect(lines[0]).toBe(
        'unit_number,make,plate,year,state,driver,status,warnings',
      )
      expect(exported.filename).toBe(
        `zebra-trucks-${params.view}-2026-11-10.csv`,
      )
    },
    300_000,
  )

  it('both seats of a team truck are in the file, and the warnings filter narrows it', async () => {
    // EVERY LIVE TRUCK GETS ITS THREE REQUIRED DOCUMENTS, in date — a truck
    // with none carries "not on file" three times over and the filter would
    // narrow nothing — and the team truck's registration is EXPIRED, so it is
    // the one row with a warning.
    const live = ['held', 'team', 'idle', 'quit', 'vacay', 'shop'] as const
    await owner.complianceItem.createMany({
      data: live.flatMap((key) =>
        (
          ['REGISTRATION', 'ANNUAL_INSPECTION', 'INSURANCE_LIABILITY'] as const
        ).map((type) => ({
          organizationId,
          companyId,
          truckId: ids[key]!,
          type,
          expiresAt:
            key === 'team' && type === 'REGISTRATION'
              ? new Date('2026-01-01T00:00:00Z')
              : new Date('2027-12-31T00:00:00Z'),
        })),
      ),
    })
    const params = readTruckListParams({ attention: '1' })
    const { listed, exported } = await inOrg(async (tx) => ({
      listed: await readTruckListData(tx, [], params, { now: NOW, take: 500 }),
      exported: await readTruckListExport(
        tx,
        { userId, companyScopes: [] },
        params,
        NOW,
      ),
    }))
    expect(listed.rows.map((row) => row.unitNumber)).toEqual([unit('team')])
    expect(listed.rows[0]!.crew.map((seat) => seat.name)).toEqual([
      `seatA ${nonce}`,
      `seatB ${nonce}`,
    ])
    expect(exported.rowCount).toBe(1)
    expect(exported.body).toContain(`seatA ${nonce} / seatB ${nonce}`)
    expect(exported.body).toContain('compliance_expired')
    // The makes offered are the fleet's own spellings, live trucks only.
    expect(listed.makes).toEqual(['FRHT', 'VOLV'])
  }, 300_000)
})
