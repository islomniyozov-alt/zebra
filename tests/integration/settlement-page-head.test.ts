import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { tenantReader, txReader, withOrg, type TxClient } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { openBatch } from '@/lib/settlement-batch'
import { fuelAndTollsFor, statementNeighbours } from '@/lib/statement-workbench'
import {
  readSettlementPageHead,
  SETTLEMENT_TRIPS_GRID,
  type SettlementPageHead,
} from '@/lib/settlement-page-head'
import { keyFor } from '@/lib/grid-columns'
import { weekOf, type Week } from '@/lib/settlement-week'
import { createPrismaClient, prisma, statementsOf } from '@/lib/db'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE STATEMENT PAGE'S OWN READS IN ONE STATEMENT (§6.2.2 v11.09).
//
// `readSettlementPageHead` is a second spelling of four reads: the page's
// `settlement.findUnique`, `fuelAndTollsFor`, the column memory's
// `userPreference.findFirst` and `statementNeighbours`. Two claims:
//
// 1. Through either transport it returns what those reads returned, for the
//    first, middle and last statement of a batch and a driver's earliest
//    week, with and without a stored column row — on fixtures with a row on
//    both sides of every filter: fuel and tolls inside the period (one on its
//    last day), outside it, deleted and another driver's; a toll already
//    deducted and one not; an expense that is not a toll; a deleted week
//    between two live ones; another key's preference.
// 2. Through the tenant reader, as `zebra_app` outside any transaction, it is
//    ONE statement, and another organization's statement reads as absent.
//
// The addable trips (`addableTrips`, through `batchInputForOrg`) are not here:
// the engine's reader stays its own, by the owner's ruling.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let otherOrgId = ''
let otherSettlementId = ''
let companyId = ''
let userId = ''
let bareUserId = ''
let brokerId = ''
let truckId = ''
const drivers: Record<string, string> = {}

const nonce = Math.random().toString(36).slice(2, 8)
const DAY = 86_400_000
const WEEKS = {
  first: weekOf(new Date(Date.UTC(2026, 3, 8))),
  deleted: weekOf(new Date(Date.UTC(2026, 3, 15))),
  target: weekOf(new Date(Date.UTC(2026, 3, 22))),
  last: weekOf(new Date(Date.UTC(2026, 3, 29))),
}
const settlements: Record<string, string> = {}

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'settlement-page-head.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

async function trip(week: Week, driverId: string, cents: number) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        referenceNumber: `S-${nonce}-${Math.random().toString(36).slice(2, 7)}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: new Date(week.start.getTime() + DAY),
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: new Date(week.start.getTime() + 2 * DAY),
          },
        ],
        linehaulCents: cents,
      },
      { byUserId: userId },
    ),
  )
  await owner.load.update({
    where: { id: load.id },
    data: { truckId, driverId, operationalStatus: 'POD_RECEIVED' },
  })
  await owner.loadStatusEvent.create({
    data: {
      organizationId,
      loadId: load.id,
      axis: 'OPERATIONAL',
      toStatus: 'POD_RECEIVED',
      outcome: 'APPLIED',
      occurredAt: new Date(week.start.getTime() + 3 * DAY),
    },
  })
}

async function batchFor(week: Week): Promise<string> {
  const opened = await inOrg((tx) =>
    openBatch(tx, {
      organizationId,
      period: week,
      statementDate: new Date(week.end.getTime() + 3 * DAY),
    }),
  )
  if (!opened.ok) throw new Error(`batch: ${JSON.stringify(opened)}`)
  return opened.batchId
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  organizationId = (
    await owner.organization.create({
      data: { name: `Stmt ${nonce}`, slug: `stmt-head-${nonce}` },
    })
  ).id
  companyId = (
    await owner.company.create({
      data: {
        organizationId,
        name: `RAM ${nonce}`,
        addressLine1: '1 Dock St',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
      },
    })
  ).id
  const user = async (tag: string) => {
    const id = (
      await owner.user.create({
        data: { email: `stmt-${tag}-${nonce}@example.test`, name: tag },
      })
    ).id
    await owner.membership.create({
      data: { userId: id, organizationId, role: 'OWNER' },
    })
    return id
  }
  userId = await user('office')
  bareUserId = await user('bare')
  truckId = (
    await owner.truck.create({
      data: {
        organizationId,
        companyId,
        unitNumber: `S-${nonce}`,
        vin: `VINS${nonce}0000000`,
      },
    })
  ).id
  for (const name of ['Ann', 'Ben', 'Cal']) {
    drivers[name] = (
      await owner.driver.create({
        data: {
          organizationId,
          companyId,
          firstName: name,
          lastName: nonce.toUpperCase(),
          email: name === 'Ben' ? `ben-${nonce}@example.test` : null,
          driverType: 'OWNER_OPERATOR',
          payRules: {
            create: {
              organizationId,
              type: 'PERCENT_LINEHAUL',
              percentBps: 3000,
              effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
            },
          },
        },
      })
    ).id
  }
  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BK ${nonce}` }),
    )
  ).id

  // ── BEN'S FOUR WEEKS, THE SECOND DELETED; ANN AND CAL BESIDE HIM ──────
  for (const [key, week] of Object.entries(WEEKS)) {
    await trip(week, drivers.Ben!, 100_000)
    await trip(week, drivers.Ben!, 50_000)
    if (key === 'target') {
      await trip(week, drivers.Ann!, 80_000)
      await trip(week, drivers.Cal!, 70_000)
    }
    const batchId = await batchFor(week)
    const rows = await owner.settlement.findMany({
      where: { batchId },
      select: { id: true, driverId: true },
    })
    for (const row of rows) {
      const name = Object.keys(drivers).find((n) => drivers[n] === row.driverId)
      settlements[`${key}:${name}`] = row.id
    }
  }
  await owner.settlement.update({
    where: { id: settlements['deleted:Ben']! },
    data: { deletedAt: new Date() },
  })
  const target = settlements['target:Ben']!

  // A HAND LINE WITH A CHARGE ON IT AND NO LOAD.
  await owner.settlementLine.create({
    data: {
      organizationId,
      settlementId: target,
      type: 'DEDUCTION_FUEL',
      description: 'Fuel advance',
      amountCents: -12_500,
      sortOrder: 9,
      payRuleSnapshot: { kind: 'charge', rateCents: 12_500, quantity: 1 },
    },
  })
  for (const deletedAt of [null, new Date()]) {
    await owner.document.create({
      data: {
        organizationId,
        companyId,
        settlementId: target,
        filename: 'statement.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        type: 'OTHER',
        r2Key: `stmt-${nonce}-${Math.random().toString(36).slice(2, 9)}`,
        deletedAt,
      },
    })
  }

  // ── FUEL AND TOLLS, BOTH SIDES OF EVERY FILTER ─────────────────────────
  const t = WEEKS.target
  const fuel = (
    at: Date,
    cents: number,
    driverId = drivers.Ben!,
    del = false,
  ) =>
    owner.fuelTransaction.create({
      data: {
        organizationId,
        companyId,
        driverId,
        purchasedAt: at,
        gallons: '100.000',
        totalCents: cents,
        deletedAt: del ? new Date() : null,
      },
    })
  await fuel(new Date(t.start.getTime() + DAY), 40_000)
  await fuel(t.end, 30_001) // the Saturday itself: inclusive
  await fuel(new Date(t.end.getTime() + DAY), 99_999) // outside
  await fuel(new Date(t.start.getTime() + DAY), 88_888, drivers.Ben, true)
  await fuel(new Date(t.start.getTime() + DAY), 77_777, drivers.Ann)
  const expense = (input: {
    at?: Date
    cents: number
    category?: 'TOLLS' | 'MAINTENANCE'
    deduct?: boolean
    del?: boolean
  }) =>
    owner.expense.create({
      data: {
        organizationId,
        companyId,
        driverId: drivers.Ben!,
        incurredAt: input.at ?? new Date(t.start.getTime() + 2 * DAY),
        category: input.category ?? 'TOLLS',
        amountCents: input.cents,
        isDriverDeduction: input.deduct ?? false,
        deletedAt: input.del ? new Date() : null,
      },
    })
  await expense({ cents: 1_250, deduct: true })
  await expense({ cents: 3_300 })
  await expense({ cents: 70_000, category: 'MAINTENANCE' })
  await expense({ cents: 5_555, deduct: true, del: true })
  await expense({ cents: 6_666, at: new Date(t.start.getTime() - DAY) })

  // ── THE COLUMN MEMORY, AND ANOTHER GRID'S ──────────────────────────────
  await owner.userPreference.create({
    data: {
      organizationId,
      userId,
      key: keyFor(SETTLEMENT_TRIPS_GRID),
      value: { hidden: ['miles', 'load'] },
    },
  })
  await owner.userPreference.create({
    data: {
      organizationId,
      userId: bareUserId,
      key: keyFor('drivers.drivers'),
      value: { hidden: ['phone'] },
    },
  })

  const other = await owner.organization.create({
    data: {
      name: `Stmt other ${nonce}`,
      slug: `stmt-head-other-${nonce}`,
    },
  })
  otherOrgId = other.id
  const otherCompany = await owner.company.create({
    data: { organizationId: other.id, name: `Other ${nonce}` },
  })
  const otherDriver = await owner.driver.create({
    data: {
      organizationId: other.id,
      companyId: otherCompany.id,
      firstName: 'Elsewhere',
      lastName: nonce,
    },
  })
  otherSettlementId = (
    await owner.settlement.create({
      data: {
        organizationId: other.id,
        companyId: otherCompany.id,
        driverId: otherDriver.id,
        settlementNumber: `ST-OTHER-${nonce}`,
        periodStart: t.start,
        periodEnd: t.end,
      },
    })
  ).id
}, 900_000)

afterAll(async () => {
  await owner?.$disconnect()
})

/** What the page read before v11.09, shaped as the head returns it. */
async function readByPrisma(
  tx: TxClient,
  id: string,
  user: string,
): Promise<SettlementPageHead | null> {
  const settlement = await tx.settlement.findUnique({
    where: { id },
    select: {
      id: true,
      settlementNumber: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      grossCents: true,
      earningsCents: true,
      deductionsCents: true,
      reimbursementsCents: true,
      advancesCents: true,
      otherPayCents: true,
      netCents: true,
      milesHundredths: true,
      approvedAt: true,
      paidAt: true,
      paymentMethod: true,
      paymentReference: true,
      unitNumber: true,
      payTariffLabel: true,
      driverType: true,
      payoutDate: true,
      batchId: true,
      company: { select: { name: true } },
      driver: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          driverType: true,
        },
      },
      _count: { select: { documents: true } },
      batch: {
        select: {
          id: true,
          batchNumber: true,
          status: true,
          statementDate: true,
          checkDate: true,
        },
      },
      loadLines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          loadId: true,
          loadNumber: true,
          companyName: true,
          puPlace: true,
          delPlace: true,
          puDate: true,
          delDate: true,
          grossCents: true,
          milesHundredths: true,
          amountCents: true,
          referenceNumber: true,
          load: { select: { referenceNumber: true, operationalStatus: true } },
        },
      },
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          type: true,
          description: true,
          amountCents: true,
          payRuleSnapshot: true,
          load: { select: { id: true, loadNumber: true } },
        },
      },
    },
  })
  if (!settlement) return null
  return {
    settlement,
    fuel: await fuelAndTollsFor(tx, {
      driverId: settlement.driver.id,
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
    }),
    columnsRow: await tx.userPreference.findFirst({
      where: { userId: user, key: keyFor(SETTLEMENT_TRIPS_GRID) },
      select: { value: true, organizationId: true },
    }),
    neighbours: await statementNeighbours(tx, {
      settlementId: settlement.id,
      batchId: settlement.batchId,
      driverId: settlement.driver.id,
      settlementNumber: settlement.settlementNumber,
      periodStart: settlement.periodStart,
    }),
  }
}

describe('/settlements/[id] in one statement', () => {
  it('reads what the page’s reads read — first, middle and last in a batch, a driver’s first week, with and without a column row, through both transports', async () => {
    let compared = 0
    const ids = [
      'target:Ann',
      'target:Ben',
      'target:Cal',
      'first:Ben',
      'last:Ben',
    ]
    for (const key of ids) {
      for (const user of [userId, bareUserId]) {
        const id = settlements[key]!
        const input = { settlementId: id, userId: user }
        const [inTx, expected] = await inOrg(
          async (tx) =>
            [
              await readSettlementPageHead(txReader(tx), input),
              await readByPrisma(tx, id, user),
            ] as const,
        )
        expect(inTx, `${key} in a transaction`).toEqual(expected)
        const viaReader = await readSettlementPageHead(
          tenantReader(prisma, organizationId),
          input,
        )
        expect(viaReader, `${key} through the tenant reader`).toEqual(expected)
        compared += 2
      }
    }
    expect(compared).toBe(20)

    // NOT VACUOUS: the target has something in every read.
    const head = (await readSettlementPageHead(
      tenantReader(prisma, organizationId),
      { settlementId: settlements['target:Ben']!, userId },
    ))!
    expect(head.settlement.loadLines).toHaveLength(2)
    expect(head.settlement.lines.map((l) => l.type)).toContain('DEDUCTION_FUEL')
    expect(head.settlement.lines.find((l) => l.load === null)).toBeTruthy()
    expect(head.settlement._count.documents).toBe(2)
    expect(head.settlement.driver.email).toBe(`ben-${nonce}@example.test`)
    expect(head.settlement.batch?.batchNumber).toBeTruthy()
    expect(head.fuel).toEqual({
      fuelCents: 70_001,
      tollCents: 4_550,
      totalCents: 74_551,
      fuelCount: 2,
      tollCount: 2,
      alreadyDeductedCents: 1_250,
    })
    expect(head.columnsRow?.value).toEqual({ hidden: ['miles', 'load'] })
    expect(head.neighbours.prevPeriod?.id).toBe(settlements['first:Ben'])
    expect(head.neighbours.nextPeriod?.id).toBe(settlements['last:Ben'])
    const inBatch = [
      head.neighbours.prevInBatch,
      head.neighbours.nextInBatch,
    ].filter(Boolean)
    const middle = (await Promise.all(
      ['target:Ann', 'target:Ben', 'target:Cal'].map((key) =>
        readSettlementPageHead(tenantReader(prisma, organizationId), {
          settlementId: settlements[key]!,
          userId,
        }),
      ),
    ))!.find((h) => h!.neighbours.prevInBatch && h!.neighbours.nextInBatch)
    expect(middle).toBeTruthy()
    expect(inBatch.length).toBeGreaterThan(0)
  }, 600_000)

  it('is ONE statement through the tenant reader; another organization’s statement is absent', async () => {
    const client = createPrismaClient(process.env.DATABASE_URL!)
    try {
      const at = statementsOf(client)!
      const head = await readSettlementPageHead(
        tenantReader(client, organizationId),
        { settlementId: settlements['target:Ben']!, userId },
      )
      expect(statementsOf(client)! - at).toBe(1)
      expect(head?.settlement.id).toBe(settlements['target:Ben'])
    } finally {
      await client.$disconnect()
    }
    const asUs = tenantReader(prisma, organizationId)
    const theirs = await readSettlementPageHead(asUs, {
      settlementId: otherSettlementId,
      userId,
    })
    expect(theirs).toBeNull()
    // NOT VACUOUS: as its own organization the statement is there.
    const own = await readSettlementPageHead(tenantReader(prisma, otherOrgId), {
      settlementId: otherSettlementId,
      userId,
    })
    expect(own?.settlement.id).toBe(otherSettlementId)
  }, 300_000)
})
