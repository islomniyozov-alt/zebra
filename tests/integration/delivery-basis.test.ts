import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg, type TxClient } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { openBatch } from '@/lib/settlement-batch'
import { SETTLEABLE_LOAD, settleableInPeriod } from '@/lib/settlements'
import { previewBatch } from '@/lib/batch-preview'
import { savePayrollCutover } from '@/lib/payroll-cutover'
import { weekOf, type Week } from '@/lib/settlement-week'
import type { Prisma, PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// TRIPS BY DELIVERY DATE AGAINST TRIPS BY POD DATE (MONEY-DESIGN §6, owner's
// ruling 2026-11-17).
//
// The range basis moved from the POD event to the delivery date — the last
// drop's actual departure, else when the status reached Delivered — and a
// Delivered trip no longer waits for its POD. This suite puts one trip of
// every shape that matters on two adjacent weeks, opens a batch for each, and
// for EVERY batch compares the trips the new basis selects with the trips the
// old POD basis would have selected. The differences are listed by load number
// and asserted by name; both sides are above zero for every batch, so neither
// selection can pass by being empty.
//
// And the batch the engine actually drafts holds exactly the delivery-basis
// trips — the agreement between the predicate and what gets paid.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let truckId = ''
let driverId = ''

const nonce = Math.random().toString(36).slice(2, 8)
const DAY = 86_400_000
const HOUR = 3_600_000
const W1 = weekOf(new Date(Date.UTC(2026, 5, 17)))
const W2: Week = {
  start: new Date(W1.start.getTime() + 7 * DAY),
  end: new Date(W1.end.getTime() + 7 * DAY),
}
const at = (day: number, hours = 12) =>
  new Date(W1.start.getTime() + day * DAY + hours * HOUR)

/** load number → id, and back, so differences read by name. */
const ids: Record<string, string> = {}
const nameOf = new Map<string, string>()

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'delivery-basis.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

/**
 * One trip. `departedDay` stamps the delivery stop's actual departure;
 * `deliveredDay` writes an applied Delivered event; `podDay` an applied POD
 * event. `status` is where the load ends.
 */
async function trip(input: {
  name: string
  status: 'DELIVERED' | 'POD_RECEIVED'
  departedDay?: number
  departedHours?: number
  deliveredDay?: number
  podDay?: number
}): Promise<void> {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        referenceNumber: `DB-${nonce}-${input.name}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: at(1),
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: at(input.departedDay ?? input.deliveredDay ?? 3),
            ...(input.departedDay === undefined
              ? {}
              : {
                  arrivedAt: at(input.departedDay, 8),
                  departedAt: at(input.departedDay, input.departedHours ?? 12),
                }),
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
      operationalStatus: input.status,
      actualMiles: 700,
    },
  })
  const event = (toStatus: 'DELIVERED' | 'POD_RECEIVED', day: number) =>
    owner.loadStatusEvent.create({
      data: {
        organizationId,
        loadId: load.id,
        axis: 'OPERATIONAL',
        toStatus,
        outcome: 'APPLIED',
        occurredAt: at(day),
      },
    })
  if (input.deliveredDay !== undefined)
    await event('DELIVERED', input.deliveredDay)
  if (input.podDay !== undefined) await event('POD_RECEIVED', input.podDay)
  ids[input.name] = load.id
  nameOf.set(load.id, input.name)
}

/** The OLD basis, verbatim from before 2026-11-17: POD received, POD in the week. */
const podBasis = (period: Week): Prisma.LoadWhereInput => ({
  ...SETTLEABLE_LOAD,
  companyId,
  driverId: { not: null },
  operationalStatus: 'POD_RECEIVED',
  statusEvents: {
    some: {
      axis: 'OPERATIONAL',
      toStatus: 'POD_RECEIVED',
      outcome: 'APPLIED',
      occurredAt: {
        gte: period.start,
        lte: new Date(period.end.getTime() + 86_399_999),
      },
    },
  },
})

/** Load names a predicate selects, sorted. Lines are ignored: selection only. */
async function names(where: Prisma.LoadWhereInput): Promise<string[]> {
  const rows = await owner.load.findMany({
    where: { ...where, organizationId, id: { in: Object.values(ids) } },
    select: { id: true },
  })
  return rows.map((row) => nameOf.get(row.id)!).sort()
}

/**
 * The delivery basis over the RANGE — `settleableInPeriod`, the range alone,
 * for the authority. The batch drafts this plus the catch-up (below).
 */
function deliveryBasis(period: Week): Prisma.LoadWhereInput {
  return {
    ...settleableInPeriod(
      period.start,
      new Date(period.end.getTime() + 86_399_999),
    ),
    companyId,
    driverId: { not: null },
  }
}

/** What Create showed for W1 before any batch: both groups, by name. */
const w1Groups = {
  inRange: [] as string[],
  earlier: [] as string[],
  beforeCutover: [] as string[],
}

const before: Record<'W1' | 'W2', { delivery: string[]; pod: string[] }> = {
  W1: { delivery: [], pod: [] },
  W2: { delivery: [], pod: [] },
}
const batchIds: Record<'W1' | 'W2', string> = { W1: '', W2: '' }

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  organizationId = (
    await owner.organization.create({
      data: { name: `Basis ${nonce}`, slug: `delivery-basis-${nonce}` },
    })
  ).id
  companyId = (
    await owner.company.create({
      data: {
        organizationId,
        name: `BASIS ${nonce}`,
        addressLine1: '1 Dock St',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
      },
    })
  ).id
  userId = (
    await owner.user.create({
      data: { email: `delivery-basis-${nonce}@example.test`, name: 'Basis' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
  truckId = (
    await owner.truck.create({
      data: {
        organizationId,
        companyId,
        unitNumber: `DB-${nonce}`,
        vin: `VINDB${nonce}000000`,
      },
    })
  ).id
  driverId = (
    await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'BASIS',
        lastName: nonce.toUpperCase(),
        driverType: 'COMPANY_DRIVER',
      },
    })
  ).id
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId,
      type: 'PERCENT_LINEHAUL',
      percentBps: 3000,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    },
  })
  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BK ${nonce}` }),
    )
  ).id

  // ── ONE TRIP OF EVERY SHAPE THAT MATTERS ──────────────────────────────
  // Delivered Tuesday of W1, the broker's POD the Monday after (W2).
  await trip({
    name: 'deliveredThenPod',
    status: 'POD_RECEIVED',
    deliveredDay: 2,
    podDay: 8,
  })
  // Left the last drop late Saturday of W1; POD stamped Sunday (W2).
  await trip({
    name: 'departedThenPod',
    status: 'POD_RECEIVED',
    departedDay: 6,
    departedHours: 22,
    deliveredDay: 6,
    podDay: 7,
  })
  // Delivered in W1, no POD yet — settles now: Delivered is enough.
  await trip({ name: 'deliveredNoPod', status: 'DELIVERED', deliveredDay: 3 })
  // The Datatruck import's shape: one jump straight to POD received, dated at
  // delivery — it reached Delivered at that instant.
  await trip({ name: 'podJump', status: 'POD_RECEIVED', podDay: 4 })
  // The Amazon shape: departure, Delivered and the carried POD on one day.
  await trip({
    name: 'amazonShape',
    status: 'POD_RECEIVED',
    departedDay: 5,
    deliveredDay: 5,
    podDay: 5,
  })
  // Wholly in W2 on both bases.
  await trip({
    name: 'plainW2',
    status: 'POD_RECEIVED',
    deliveredDay: 9,
    podDay: 10,
  })
  // THE CATCH-UP (owner's ruling 2026-11-17): delivered three weeks before W1,
  // on no statement — beyond the picker's fourteen-day window, so only the
  // catch-up clause can bring it in. W1's batch drafts it.
  await trip({
    name: 'earlyUnpaid',
    status: 'POD_RECEIVED',
    deliveredDay: -21,
    podDay: -20,
  })
  // THE CARRY-OVER FLOOR (owner's ruling 2026-11-17): the organization's
  // payroll cutover, twenty-five days before W1, through the Settings writer.
  // `earlyUnpaid` (day -21) is after it and carries over; `beforeFloor`
  // (day -40) is before it and never does. Without the setting, W1 — the
  // authority's first batch — would be the floor and neither would.
  await trip({
    name: 'beforeFloor',
    status: 'POD_RECEIVED',
    deliveredDay: -40,
    podDay: -39,
  })
  const cut = await inOrg((tx) =>
    savePayrollCutover(
      tx,
      organizationId,
      new Date(W1.start.getTime() - 25 * DAY).toISOString().slice(0, 10),
    ),
  )
  if (!cut.ok) throw new Error('payroll cutover refused')

  // WHAT CREATE SHOWS FOR W1, BEFORE ANY BATCH: the range and the catch-up.
  const w1 = await inOrg((tx) =>
    previewBatch(tx, { from: W1.start, to: W1.end, companyId }),
  )
  const mine = (trips: { loadId: string }[]) =>
    trips
      .map((t) => nameOf.get(t.loadId))
      .filter((n): n is string => n !== undefined)
      .sort()
  w1Groups.inRange = mine(w1.available.filter((t) => !t.earlier))
  w1Groups.earlier = mine(w1.available.filter((t) => t.earlier))
  w1Groups.beforeCutover = mine(w1.unavailable.beforeCutover)

  // THE SELECTIONS, BEFORE ANY BATCH PUTS LINES ON THE LOADS.
  for (const [key, period] of [
    ['W1', W1],
    ['W2', W2],
  ] as const) {
    before[key] = {
      delivery: await names(deliveryBasis(period)),
      pod: await names(podBasis(period)),
    }
  }

  // EVERY BATCH ON THE FIXTURE: one per week, for the authority.
  for (const [key, period] of [
    ['W1', W1],
    ['W2', W2],
  ] as const) {
    const opened = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        companyId,
        period,
        statementDate: new Date(period.end.getTime() + 3 * DAY),
      }),
    )
    if (!opened.ok) throw new Error(`batch ${key}: ${opened.reason.kind}`)
    batchIds[key] = opened.batchId
  }
}, 300_000)

afterAll(async () => {
  await owner?.$disconnect()
})

const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x))

describe('trips by delivery date against trips by POD date, every batch', () => {
  it('both sides are above zero for every batch', () => {
    for (const key of ['W1', 'W2'] as const) {
      expect(before[key].delivery.length, `${key} delivery`).toBeGreaterThan(0)
      expect(before[key].pod.length, `${key} pod`).toBeGreaterThan(0)
    }
  })

  it('lists the differences by name, and they are the ruling', () => {
    const differences = (['W1', 'W2'] as const).map((key) => ({
      batch: key,
      deliveryOnly: minus(before[key].delivery, before[key].pod),
      podOnly: minus(before[key].pod, before[key].delivery),
    }))
    // SAID BY NAME IN THE RUN'S OUTPUT, as the ruling asks.
    console.log(
      'delivery-basis differences:',
      JSON.stringify(differences, null, 2),
    )
    expect(differences).toEqual([
      {
        batch: 'W1',
        // Delivered in W1: two whose POD landed in W2, one with no POD at all.
        deliveryOnly: ['deliveredNoPod', 'deliveredThenPod', 'departedThenPod'],
        podOnly: [],
      },
      {
        batch: 'W2',
        deliveryOnly: [],
        // The POD basis would have paid these a week late.
        podOnly: ['deliveredThenPod', 'departedThenPod'],
      },
    ])
  })

  it('agrees where the two dates agree', () => {
    expect(before.W1.delivery).toEqual(
      expect.arrayContaining(['amazonShape', 'podJump']),
    )
    expect(before.W1.pod).toEqual(['amazonShape', 'podJump'])
    expect(before.W2.delivery).toEqual(['plainW2'])
  })

  it('and each batch the engine drafted holds its range plus the catch-up', async () => {
    // W1 drafts its range AND `earlyUnpaid`, delivered three weeks before and
    // on no statement. W2 drafts its range only: everything earlier is on W1.
    const catchUp = { W1: ['earlyUnpaid'], W2: [] as string[] }
    for (const key of ['W1', 'W2'] as const) {
      const lines = await owner.settlementLoadLine.findMany({
        where: { settlement: { batchId: batchIds[key] } },
        select: { loadId: true },
      })
      const drafted = [
        ...new Set(lines.map((l) => nameOf.get(l.loadId)!)),
      ].sort()
      expect(drafted, key).toEqual(
        [...before[key].delivery, ...catchUp[key]].sort(),
      )
    }
  })
})

describe('Create shows two groups, both above zero (the catch-up ruling)', () => {
  it('the range, and "Delivered earlier, not yet paid" by name', () => {
    expect(w1Groups.inRange.length).toBeGreaterThan(0)
    expect(w1Groups.earlier.length).toBeGreaterThan(0)
    expect(w1Groups.inRange).toEqual(before.W1.delivery)
    expect(w1Groups.earlier).toEqual(['earlyUnpaid'])
  })

  it('reaches back to the payroll cutover and no further', async () => {
    // AFTER THE FLOOR, PRESENT; BEFORE IT, ABSENT — from the group, and from
    // the batch the engine drafted, with the setting's change audited.
    expect(w1Groups.earlier).toContain('earlyUnpaid')
    expect(w1Groups.earlier).not.toContain('beforeFloor')
    expect(w1Groups.beforeCutover).toEqual(['beforeFloor'])
    expect(
      await owner.settlementLoadLine.count({
        where: { loadId: ids.beforeFloor },
      }),
    ).toBe(0)
    const audit = await owner.auditLog.findFirst({
      where: {
        organizationId,
        entityType: 'Organization',
        entityId: organizationId,
        action: 'UPDATE',
      },
      orderBy: { createdAt: 'desc' },
      select: { changes: true },
    })
    expect(audit?.changes).toMatchObject({
      payrollCutoverDate: { from: null },
    })
  })
})
