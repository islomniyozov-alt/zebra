import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { tenantReader, txReader, withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createLoad, LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  DRIVER_TABS,
  DRIVER_CHIPS,
  driverChipWhere,
  driverListBaseWhere,
  driverTabWhere,
  type DriverChip,
  type DriverListBase,
  type DriverTab,
} from '@/lib/driver-list'
import {
  DRIVER_HEALTH_CHECKS,
  driverHealthBase,
  driverHealthWhere,
  type DriverHealthCheck,
} from '@/lib/data-health'
import { readDensity, readSavedViews } from '@/lib/preferences'
import { isQualifiable } from '@/lib/dqf'
import { driverWarningFacts, truckWarningFacts } from '@/lib/warnings'
import {
  dispatchFactsForDrivers,
  lastActivityForDrivers,
} from '@/lib/dispatch-fields'
import { readDriverFacts, readDriversHead } from '@/lib/drivers-page'
import { crewOfTrucks } from '@/lib/team'
import { createPrismaClient, prisma, statementsOf } from '@/lib/db'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// /drivers IN THREE STATEMENTS (§6.4 part 1 v11.02, v11.04).
//
// FIVE CLAIMS, EACH HELD TO WHAT IT REPLACED:
//
// 1. The head's tab counts equal `driver.count` through `driverTabWhere` —
//    the list's own predicate — for every tab, with and without removed rows,
//    unscoped, scoped, chipped and tagged. `driverTabSql` is a second
//    spelling of the tab rule, and THIS is its enforcer. The health counts
//    equal `driver.count` through `driverHealthWhere`, the filter the figure
//    links to; the authority count and the three preferences equal their
//    old reads.
// 2. The facts statement returns what the four loaders return, and the
//    roster's `isQualifiable` equals the predicate on a Prisma read.
// 3. Head and facts are ONE statement each through the tenant reader, as
//    `zebra_app` and outside any transaction; an empty list sends none.
// 4. The list the head carries (`driverListSql`) equals `driver.findMany`
//    through `driverTabWhere` and the health filter — ids in order and every
//    column — for every tab, removed or not, scoped, chipped, tagged, under
//    each health filter and under the cap. `driverListSql` and
//    `driverHealthFilterSql` are spellings of those rules; THIS is their
//    enforcer.
// 5. Through the reader, a second organization's driver is in no count and
//    no list. Watched failing with the reader handed that organization's id.
//
// EVERY SIDE IS SEEDED ABOVE EMPTY: a driver in every tab, a removed one, a
// payee, two authorities, a tag, compliance on a driver and a truck, a
// document, a negative settlement, open freight, an assignment and all
// three preference rows. Agreement between two empty answers proves nothing.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let alphaId = ''
let betaId = ''
let userId = ''
const drivers: Record<string, string> = {}
let truckId = ''
let otherOrgId = ''
let otherDriverId = ''
const nonce = Math.random().toString(36).slice(2, 8)
/** Whole milliseconds, so a timestamp(3) round trip compares equal. */
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000)
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'drivers-page.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

const ACTIVE_LIST = { tab: 'active', missing: null, cap: 500 } as const

const head = (input: {
  base?: DriverListBase
  healthCompanyIds?: string[]
  includeRemoved?: boolean
}) =>
  inOrg((tx) =>
    readDriversHead(txReader(tx), {
      userId,
      base: input.base ?? { companyScopes: [] },
      healthCompanyIds: input.healthCompanyIds ?? [],
      now: NOW,
      includeRemoved: input.includeRemoved ?? false,
      list: ACTIVE_LIST,
    }),
  )

/** The page's old list, with the id as the last key so ties have an order. */
const listedByPrisma = (
  tx: Parameters<Parameters<typeof withOrg>[1]>[0],
  input: {
    base: DriverListBase
    tab: DriverTab
    chip?: DriverChip | null
    includeRemoved: boolean
    missing: DriverHealthCheck | null
    cap: number
  },
) =>
  tx.driver.findMany({
    where: {
      AND: [
        driverListBaseWhere(input.base),
        driverTabWhere(input.tab, input.includeRemoved),
        ...(input.chip ? [driverChipWhere(input.chip, NOW)] : []),
        ...(input.missing
          ? [driverHealthBase(), driverHealthWhere(input.missing, NOW)]
          : []),
      ],
    },
    orderBy: [{ company: { name: 'asc' } }, { lastName: 'asc' }, { id: 'asc' }],
    take: input.cap,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      cdlNumber: true,
      cdlState: true,
      status: true,
      driverType: true,
      deletedAt: true,
      terminationDate: true,
      offDutyUntil: true,
      tags: true,
      company: { select: { name: true } },
      assignedTruck: { select: { id: true, unitNumber: true } },
    },
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Drivers page ${nonce}`,
      slug: `drivers-page-${nonce}`,
      maxCompanies: 3,
      companies: {
        create: [{ name: `Alpha ${nonce}` }, { name: `Beta ${nonce}` }],
      },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  alphaId = organization.companies.find((c) => c.name.startsWith('Alpha'))!.id
  betaId = organization.companies.find((c) => c.name.startsWith('Beta'))!.id

  const user = await owner.user.create({
    data: { email: `drivers-page-${nonce}@example.test`, name: 'List Reader' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  truckId = (
    await owner.truck.create({
      data: { organizationId, companyId: alphaId, unitNumber: `T-${nonce}` },
    })
  ).id

  const seed = async (
    name: string,
    companyId: string,
    data: Record<string, unknown> = {},
  ) => {
    drivers[name] = (
      await owner.driver.create({
        data: {
          organizationId,
          companyId,
          firstName: name,
          lastName: `List ${nonce}`,
          hireDate: new Date(Date.UTC(2026, 0, 5)),
          ...data,
        },
      })
    ).id
  }
  // ACTIVE WITH A TRUCK, TAGGED, A PHONE.
  await seed('Working', alphaId, {
    status: 'AVAILABLE',
    assignedTruckId: truckId,
    tags: ['night'],
    phone: '555-0100',
  })
  // ACTIVE, NO TRUCK: Unassigned.
  await seed('Idle', alphaId, { status: 'AVAILABLE', tags: ['night'] })
  // VACATION BY STATUS, and VACATION BY A RETURN DATE AHEAD.
  //
  // AVAILABLE, NOT OFF_DUTY, on the two off-duty drivers (2026-11-16).
  // Migration 55 retired OFF_DUTY as a stored status, and
  // dispatch-fields.test.ts holds every driver in the database to that — so
  // while this fixture stood, the full suite failed whenever the two files
  // overlapped. Both values are WORKING_STATUSES, and the vacation tab reads
  // `offDutyUntil`, so no count here moves.
  await seed('Holiday', alphaId, { status: 'VACATION' })
  await seed('Returning', betaId, {
    status: 'AVAILABLE',
    isOffDuty: true,
    offDutyUntil: day(10),
  })
  // AN OFF-DUTY DATE ALREADY PAST is not on the vacation board.
  await seed('Back', betaId, {
    status: 'AVAILABLE',
    isOffDuty: true,
    offDutyUntil: day(-10),
  })
  // TERMINATED.
  await seed('Gone', betaId, { status: 'INACTIVE' })
  // REMOVED, behind the toggle.
  await seed('Removed', betaId, { status: 'AVAILABLE', deletedAt: day(-1) })
  // A PAYEE: on the roster, never qualifiable, never in the health base.
  await seed('Payee', betaId, { status: 'AVAILABLE', kind: 'PAYEE' })

  // COMPLIANCE ON A DRIVER AND THE TRUCK (the truck's expired).
  for (const [type, offset] of [
    ['CDL', 200],
    ['MEDICAL_CARD', 30],
  ] as const) {
    await owner.complianceItem.create({
      data: {
        organizationId,
        companyId: alphaId,
        driverId: drivers.Working,
        type,
        expiresAt: day(offset),
      },
    })
  }
  await owner.complianceItem.create({
    data: {
      organizationId,
      companyId: alphaId,
      truckId,
      type: 'REGISTRATION',
      expiresAt: day(-5),
    },
  })
  // A PAY RULE IN FORCE on one driver, so the health figure has both sides.
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId: drivers.Working!,
      type: 'PERCENT_GROSS',
      percentBps: 3000,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    },
  })
  // A DOCUMENT FILED: DQF evidence and activity.
  await owner.document.create({
    data: {
      organizationId,
      companyId: alphaId,
      driverId: drivers.Idle,
      r2Key: `drivers-page/${nonce}/road-test.pdf`,
      filename: 'road-test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      type: 'ROAD_TEST_CERTIFICATE',
      uploadedAt: day(-3),
    },
  })
  // A NEGATIVE SETTLEMENT.
  await owner.settlement.create({
    data: {
      organizationId,
      companyId: alphaId,
      settlementNumber: `S-${nonce}`,
      driverId: drivers.Working!,
      periodStart: day(-14),
      periodEnd: day(-8),
      netCents: -2_500,
    },
  })
  // OPEN FREIGHT AND AN ASSIGNMENT: dispatch facts and activity.
  const broker = await inOrg((tx) =>
    createBroker(tx, organizationId, { name: `BROKER ${nonce}` }),
  )
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId: alphaId,
        customerId: broker.id,
        referenceNumber: `DP-${nonce}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: day(1),
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: day(2),
          },
        ],
        linehaulCents: 100_000,
      },
      { byUserId: userId },
    ),
  )
  await owner.load.update({
    where: { id: load.id },
    data: { driverId: drivers.Working },
  })
  await owner.loadAssignment.create({
    data: {
      loadId: load.id,
      organizationId,
      driverId: drivers.Working,
      truckId,
      assignedAt: day(-2),
    },
  })

  // ANOTHER ORGANIZATION, WITH A DRIVER ON A WORKING STATUS and the same
  // last name, so a list that leaked it would show it on the active tab.
  const other = await owner.organization.create({
    data: {
      name: `Drivers page other ${nonce}`,
      slug: `drivers-page-other-${nonce}`,
      companies: { create: [{ name: `Other ${nonce}` }] },
    },
    include: { companies: true },
  })
  otherOrgId = other.id
  otherDriverId = (
    await owner.driver.create({
      data: {
        organizationId: other.id,
        companyId: other.companies[0]!.id,
        firstName: 'Elsewhere',
        lastName: `List ${nonce}`,
        hireDate: new Date(Date.UTC(2026, 0, 5)),
        status: 'AVAILABLE',
      },
    })
  ).id

  // ALL THREE PREFERENCE ROWS.
  const preferences: [string, object | string][] = [
    ['columns.drivers.drivers', { hidden: ['phone'] }],
    ['view.drivers', [{ slug: 'night', name: 'Night', query: 'tag=night' }]],
    ['density', 'compact'],
  ]
  for (const [key, value] of preferences) {
    await owner.userPreference.create({
      data: { organizationId, userId, key, value },
    })
  }
}, 300_000)

afterAll(async () => {
  await owner?.$disconnect()
})

describe('/drivers in three statements', () => {
  it('counts every tab and chip as driverTabWhere and driverChipWhere do — removed or not, scoped, chipped, tagged, searched', async () => {
    const bases: { name: string; base: DriverListBase }[] = [
      { name: 'unscoped', base: { companyScopes: [] } },
      { name: 'scoped to Alpha', base: { companyScopes: [alphaId] } },
      {
        name: 'chipped to Beta',
        base: { companyScopes: [], companyId: betaId },
      },
      { name: 'tagged night', base: { companyScopes: [], tag: 'night' } },
      // v11.38: the search narrows the counts too, by name, phone and unit.
      { name: 'searched name', base: { companyScopes: [], search: ['ret'] } },
      {
        name: 'searched phone',
        base: { companyScopes: [], search: ['555-01'] },
      },
      {
        name: 'searched unit',
        base: { companyScopes: [], search: [`t-${nonce}`] },
      },
    ]
    let compared = 0
    for (const { name, base } of bases) {
      for (const includeRemoved of [false, true]) {
        const [read, expected] = await inOrg(async (tx) => {
          const read = await readDriversHead(txReader(tx), {
            userId,
            base,
            healthCompanyIds: [],
            now: NOW,
            includeRemoved,
            list: ACTIVE_LIST,
          })
          const expected: Record<string, number> = {}
          for (const tab of DRIVER_TABS) {
            expected[tab] = await tx.driver.count({
              where: {
                AND: [
                  driverListBaseWhere(base),
                  driverTabWhere(tab, includeRemoved),
                ],
              },
            })
          }
          // A CHIP COUNTS INSIDE THE OPEN TAB — Active, for ACTIVE_LIST.
          for (const chip of DRIVER_CHIPS) {
            expected[chip] = await tx.driver.count({
              where: {
                AND: [
                  driverListBaseWhere(base),
                  driverTabWhere(ACTIVE_LIST.tab, includeRemoved),
                  driverChipWhere(chip, NOW),
                ],
              },
            })
          }
          return [read, expected] as const
        })
        expect(read.counts, `${name}, removed ${includeRemoved}`).toEqual(
          expected,
        )
        compared += 1
      }
    }
    expect(compared).toBe(14)
    // NOT VACUOUS: unscoped, every tab and chip has someone, Active and
    // Inactive make All, and the toggle adds one.
    expect((await head({})).counts).toEqual({
      active: 6, // Working, Idle, Holiday, Returning, Back, Payee
      inactive: 1, // Gone
      all: 7,
      unassigned: 4, // Idle, Returning, Back, Payee — working, no truck
      vacation: 2, // Holiday by status, Returning by date
    })
    // And each search finds someone, and not everyone.
    for (const search of [['ret'], ['555-01'], [`t-${nonce}`]]) {
      const all = (await head({ base: { companyScopes: [], search } })).counts
        .all
      expect(all, search.join(' ')).toBeGreaterThan(0)
      expect(all, search.join(' ')).toBeLessThan(7)
    }
    expect((await head({ includeRemoved: true })).counts.all).toBe(8)
    expect(
      (await head({ base: { companyScopes: [], tag: 'night' } })).counts.active,
    ).toBe(2)
  }, 300_000)

  it('counts health as the figure’s own filter, and reads the authority count and the preferences', async () => {
    for (const companyIds of [[], [alphaId], [betaId]]) {
      const [read, expected, companies, views, density, stored] = await inOrg(
        async (tx) => {
          const read = await readDriversHead(txReader(tx), {
            userId,
            base: { companyScopes: [] },
            healthCompanyIds: companyIds,
            now: NOW,
            includeRemoved: false,
            list: ACTIVE_LIST,
          })
          const expected: Record<string, number> = {}
          for (const check of DRIVER_HEALTH_CHECKS) {
            expected[check] = await tx.driver.count({
              where: {
                AND: [
                  driverHealthBase(),
                  driverHealthWhere(check, NOW),
                  companyIds.length > 0
                    ? { companyId: { in: companyIds } }
                    : {},
                ],
              },
            })
          }
          return [
            read,
            expected,
            await tx.company.count(),
            await readSavedViews(tx, userId, 'drivers'),
            await readDensity(tx, userId),
            await tx.userPreference.findFirst({
              where: { userId, key: 'columns.drivers.drivers' },
              select: { value: true, organizationId: true },
            }),
          ] as const
        },
      )
      expect(read.health, companyIds.join() || 'unscoped').toEqual(expected)
      expect(read.companyCount).toBe(companies)
      expect(read.savedViews).toEqual(views)
      expect(read.density).toBe(density)
      expect(read.columnsRow).toEqual(stored)
    }
    // NOT VACUOUS.
    const read = await head({})
    expect(read.companyCount).toBe(2)
    // Active people: Working, Idle, Returning, Back. Only Working has a CDL
    // record, a phone, a truck and a rule.
    expect(read.health).toEqual({
      cdl: 3,
      medical: 3,
      phone: 3,
      payRule: 3,
      truck: 3,
    })
    expect(read.density).toBe('compact')
    expect(read.savedViews.map((view) => view.slug)).toEqual(['night'])
    expect(read.columnsRow?.value).toEqual({ hidden: ['phone'] })
  }, 300_000)

  it('reads the facts the four loaders read, and the roster qualifies as isQualifiable does', async () => {
    const ids = Object.values(drivers)
    const trucks = [truckId]
    const [one, warning, dispatch, activity, truckFacts, crews] = await inOrg(
      async (tx) =>
        [
          await readDriverFacts(txReader(tx), ids, trucks),
          await driverWarningFacts(tx, ids),
          await dispatchFactsForDrivers(tx, ids),
          await lastActivityForDrivers(tx, ids),
          await truckWarningFacts(tx, trucks),
          await crewOfTrucks(tx, trucks),
        ] as const,
    )
    expect(one.facts).toEqual(warning)
    expect(one.dispatch).toEqual(dispatch)
    expect(one.lastActivity).toEqual(activity)
    expect(one.trucks).toEqual(truckFacts)
    // §6.4 part 3 v11.22 — the Team column's crews are `crewOfTrucks`' own,
    // and the truck is crewed, so the comparison is not of two empty maps.
    expect(one.crews).toEqual(crews)
    expect(crews.get(truckId)!.length).toBeGreaterThan(0)

    const roster = await owner.driver.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, deletedAt: true, kind: true },
    })
    expect(roster).toHaveLength(8)
    for (const row of roster) {
      expect(one.facts.get(row.id)?.qualifiable, row.id).toBe(
        isQualifiable(row),
      )
    }

    // NOT VACUOUS: every source carries something.
    const working = one.facts.get(drivers.Working!)!
    expect(working.compliance.map((c) => c.type).sort()).toEqual([
      'CDL',
      'MEDICAL_CARD',
    ])
    expect(working.compliance.every((c) => c.expiresAt instanceof Date)).toBe(
      true,
    )
    expect(working.negativeNetCount).toBe(1)
    expect(working.hireDate).toEqual(new Date(Date.UTC(2026, 0, 5)))
    expect(one.facts.get(drivers.Idle!)!.documents).toEqual([
      'ROAD_TEST_CERTIFICATE',
    ])
    expect(one.facts.get(drivers.Payee!)!.qualifiable).toBe(false)
    expect(one.facts.get(drivers.Idle!)!.qualifiable).toBe(true)
    expect(one.dispatch.get(drivers.Working!)!.activeStatuses).toHaveLength(1)
    expect(one.dispatch.get(drivers.Returning!)!.offDutyUntil).toEqual(day(10))
    expect(one.lastActivity.get(drivers.Working!)).toBeInstanceOf(Date)
    expect(one.lastActivity.get(drivers.Idle!)).toEqual(day(-3))
    expect(one.lastActivity.get(drivers.Gone!)).toBeNull()
    expect(one.trucks.get(truckId)!.compliance).toEqual([
      { type: 'REGISTRATION', expiresAt: day(-5) },
    ])
  }, 300_000)

  it('reads drivers with no truck on the page — the trucks CTE over an empty list', async () => {
    const ids = [drivers.Idle!, drivers.Holiday!]
    const [one, warning] = await inOrg(
      async (tx) =>
        [
          await readDriverFacts(txReader(tx), ids, []),
          await driverWarningFacts(tx, ids),
        ] as const,
    )
    expect(one.facts).toEqual(warning)
    expect(one.facts.size).toBe(2)
    expect(one.trucks.size).toBe(0)
  }, 300_000)

  it('lists the rows driver.findMany lists — every tab, removed, scope, chip, tag, health filter, cap', async () => {
    const bases: { name: string; base: DriverListBase }[] = [
      { name: 'unscoped', base: { companyScopes: [] } },
      { name: 'scoped to Alpha', base: { companyScopes: [alphaId] } },
      {
        name: 'chipped to Beta',
        base: { companyScopes: [], companyId: betaId },
      },
      { name: 'tagged night', base: { companyScopes: [], tag: 'night' } },
      { name: 'searched', base: { companyScopes: [], search: ['555-01'] } },
    ]
    const cases: {
      name: string
      base: DriverListBase
      tab: DriverTab
      chip: DriverChip | null
      includeRemoved: boolean
      missing: DriverHealthCheck | null
      cap: number
    }[] = []
    for (const { name, base } of bases) {
      for (const includeRemoved of [false, true]) {
        for (const tab of DRIVER_TABS) {
          for (const chip of [null, ...DRIVER_CHIPS]) {
            cases.push({
              name,
              base,
              tab,
              chip,
              includeRemoved,
              missing: null,
              cap: 500,
            })
          }
        }
      }
    }
    for (const missing of DRIVER_HEALTH_CHECKS) {
      for (const tab of ['active', 'all'] as const) {
        cases.push({
          name: `health ${missing}`,
          base: { companyScopes: [] },
          tab,
          chip: null,
          includeRemoved: false,
          missing,
          cap: 500,
        })
      }
    }
    // THE CAP: the first two rows in the list's own order.
    cases.push({
      name: 'capped at 2',
      base: { companyScopes: [] },
      tab: 'all',
      chip: null,
      includeRemoved: true,
      missing: null,
      cap: 2,
    })

    let rows = 0
    for (const c of cases) {
      const [read, expected] = await inOrg(
        async (tx) =>
          [
            await readDriversHead(txReader(tx), {
              userId,
              base: c.base,
              healthCompanyIds: [],
              now: NOW,
              includeRemoved: c.includeRemoved,
              list: {
                tab: c.tab,
                chip: c.chip,
                missing: c.missing,
                cap: c.cap,
              },
            }),
            await listedByPrisma(tx, c),
          ] as const,
      )
      const label = `${c.name}, ${c.tab}, ${c.chip ?? 'no chip'}, removed ${c.includeRemoved}`
      expect(read.drivers, label).toEqual(expected)
      rows += expected.length
    }
    // 5 bases × removed or not × 3 tabs × (no chip + 2 chips) = 90, then 10
    // health cases and the cap: 101 (v11.38; it was 51 with five tabs).
    expect(cases).toHaveLength(101)

    // NOT VACUOUS: the lists carry rows, a truck, a tag, a removed row, dates.
    expect(rows).toBeGreaterThan(80)
    const all = (
      await inOrg((tx) =>
        readDriversHead(txReader(tx), {
          userId,
          base: { companyScopes: [] },
          healthCompanyIds: [],
          now: NOW,
          includeRemoved: true,
          list: { tab: 'all', missing: null, cap: 500 },
        }),
      )
    ).drivers
    expect(all).toHaveLength(8)
    const working = all.find((d) => d.id === drivers.Working)!
    expect(working.assignedTruck).toEqual({
      id: truckId,
      unitNumber: `T-${nonce}`,
    })
    expect(working.tags).toEqual(['night'])
    expect(all.find((d) => d.id === drivers.Removed)!.deletedAt).toEqual(
      day(-1),
    )
    expect(all.find((d) => d.id === drivers.Returning)!.offDutyUntil).toEqual(
      day(10),
    )
    // Alpha's people before Beta's: the order is the authority's name first.
    expect(
      all.slice(0, 3).every((d) => d.company.name.startsWith('Alpha')),
    ).toBe(true)
  }, 600_000)

  it('reads none of another organization’s drivers through the tenant reader', async () => {
    const read = (orgId: string) =>
      readDriversHead(tenantReader(prisma, orgId), {
        userId,
        base: { companyScopes: [] },
        healthCompanyIds: [],
        now: NOW,
        includeRemoved: true,
        list: { tab: 'all', missing: null, cap: 500 },
      })
    const mine = await read(organizationId)
    expect(mine.drivers.map((d) => d.id)).not.toContain(otherDriverId)
    expect(mine.drivers).toHaveLength(8)
    expect(mine.counts.all).toBe(8)
    expect(mine.companyCount).toBe(2)
    // The other organization reads its own driver and none of ours.
    const theirs = await read(otherOrgId)
    expect(theirs.drivers.map((d) => d.id)).toEqual([otherDriverId])
    expect(theirs.counts.all).toBe(1)
    expect(theirs.columnsRow).toBeNull()
  }, 300_000)

  it('is ONE statement for the head and ONE for the facts through the reader; an empty list sends none', async () => {
    // AS zebra_app, OUTSIDE ANY TRANSACTION — the page's own path. The owner
    // role bypasses row-level security, so it would count a read the policy
    // never filtered.
    const client = createPrismaClient(process.env.DATABASE_URL!)
    try {
      const reader = tenantReader(client, organizationId)
      const atHead = statementsOf(client)!
      const headRead = await readDriversHead(reader, {
        userId,
        base: { companyScopes: [] },
        healthCompanyIds: [],
        now: NOW,
        includeRemoved: false,
        list: ACTIVE_LIST,
      })
      const headCount = statementsOf(client)! - atHead
      const atFacts = statementsOf(client)!
      await readDriverFacts(reader, Object.values(drivers), [truckId])
      const facts = statementsOf(client)! - atFacts
      const atEmpty = statementsOf(client)!
      await readDriverFacts(reader, [], [])
      expect({
        head: headCount,
        facts,
        empty: statementsOf(client)! - atEmpty,
      }).toEqual({ head: 1, facts: 1, empty: 0 })
      // NOT VACUOUS: the one statement carried the list.
      // Six since v11.38: Active includes Holiday, who is on VACATION.
      expect(headRead.drivers).toHaveLength(6)
    } finally {
      await client.$disconnect()
    }
  }, 300_000)
})
