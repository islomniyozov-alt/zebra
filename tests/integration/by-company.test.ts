import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createLoad } from '@/lib/loads'
import {
  assembleReport,
  driverPayByCompany,
  firstSettledPeriodStart,
  grossByCompany,
} from '@/lib/by-company'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// WHAT DID EACH COMPANY MAKE, ON FREIGHT WE PUT THERE ON PURPOSE.
//
// Two authorities, three weeks, one FINAL batch in the middle week carrying a
// TEAM load. That shape is the acceptance, and it is chosen because every rule
// on this page shows up in it at once: a period before Zebra settled anything,
// a period it did, a period after, two crew members on one load, and closed
// history sitting in the gross where every other definition excludes it.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let ramId = ''
let dolphinsId = ''
let userId = ''
let mckaneId = ''
let hallId = ''
let brokerId = ''
let teamLoadId = ''

const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'by-company.test' },
    timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS,
  })

/** Three Sunday-to-Saturday weeks. Week two is the settled one. */
const WEEK_1 = new Date(Date.UTC(2026, 7, 30))
const WEEK_2 = new Date(Date.UTC(2026, 8, 6))
const WEEK_3 = new Date(Date.UTC(2026, 8, 13))
const RANGE = { from: WEEK_1, to: new Date(Date.UTC(2026, 8, 20)) }

async function seedLoad(input: {
  companyId: string
  delivered: Date
  rateCents: number
  driverId?: string
  coDriverId?: string
  closedHistory?: boolean
  deleted?: boolean
  cancelled?: boolean
}) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId: input.companyId,
        customerId: brokerId,
        referenceNumber: `BC-${nonce}-${Math.random().toString(36).slice(2, 7)}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: input.delivered,
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: input.delivered,
          },
        ],
        linehaulCents: input.rateCents,
      },
      { byUserId: userId },
    ),
  )
  await owner.load.update({
    where: { id: load.id },
    data: {
      operationalStatus: 'POD_RECEIVED',
      actualMiles: 400,
      ...(input.driverId ? { driverId: input.driverId } : {}),
      ...(input.coDriverId ? { coDriverId: input.coDriverId } : {}),
      ...(input.closedHistory
        ? { billingStatus: 'CLOSED_IN_DATATRUCK' as const }
        : {}),
      ...(input.deleted ? { deletedAt: new Date() } : {}),
      ...(input.cancelled ? { isCancelled: true } : {}),
    },
  })
  return load
}

async function report() {
  return inOrg(async (tx) => {
    const [gross, pay, settledFrom] = await Promise.all([
      grossByCompany(tx, { grouping: 'week', ...RANGE }),
      driverPayByCompany(tx, { grouping: 'week', ...RANGE }),
      firstSettledPeriodStart(tx),
    ])
    return assembleReport({ gross, pay, firstSettledPeriodStart: settledFrom })
  })
}

const cell = (
  built: Awaited<ReturnType<typeof report>>,
  period: Date,
  companyId: string,
) =>
  built.periods
    .find((p) => p.periodStart.getTime() === period.getTime())
    ?.companies.find((c) => c.companyId === companyId)

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: { name: `ByCo ${nonce}`, slug: `byco-${nonce}` },
  })
  organizationId = organization.id

  const makeCompany = async (name: string) =>
    (
      await owner.company.create({
        data: {
          organizationId,
          name: `${name} ${nonce}`,
          addressLine1: '5062 Free Pike',
          city: 'Dayton',
          state: 'OH',
          postalCode: '45426',
        },
      })
    ).id

  ramId = await makeCompany('RAM')
  dolphinsId = await makeCompany('Dolphins')

  const user = await owner.user.create({
    data: { email: `byco-${nonce}@example.test`, name: 'ByCo' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  const makeDriver = async (first: string, last: string) =>
    (
      await owner.driver.create({
        data: {
          organizationId,
          companyId: ramId,
          firstName: first,
          lastName: last,
        },
      })
    ).id

  mckaneId = await makeDriver('JERRY ROBERT', 'MCKANE')
  hallId = await makeDriver('JULIA', 'HALL')

  const broker = await inOrg((tx) =>
    createBroker(tx, organizationId, { name: `BROKER ${nonce}` }),
  )
  brokerId = broker.id

  // ── THE FREIGHT ──────────────────────────────────────────────────────
  // Week 1: RAM $1,000 (before anything was settled)
  // Week 2: RAM $2,000 TEAM, Dolphins $1,500, RAM closed history $700
  // Week 3: Dolphins $900
  // Plus a deleted and a cancelled load that must not appear anywhere.
  await seedLoad({ companyId: ramId, delivered: WEEK_1, rateCents: 100_000 })
  teamLoadId = (
    await seedLoad({
      companyId: ramId,
      delivered: WEEK_2,
      rateCents: 200_000,
      driverId: mckaneId,
      coDriverId: hallId,
    })
  ).id
  await seedLoad({
    companyId: dolphinsId,
    delivered: WEEK_2,
    rateCents: 150_000,
  })
  await seedLoad({
    companyId: ramId,
    delivered: WEEK_2,
    rateCents: 70_000,
    closedHistory: true,
  })
  await seedLoad({
    companyId: dolphinsId,
    delivered: WEEK_3,
    rateCents: 90_000,
  })
  await seedLoad({
    companyId: ramId,
    delivered: WEEK_2,
    rateCents: 999_999,
    deleted: true,
  })
  await seedLoad({
    companyId: ramId,
    delivered: WEEK_2,
    rateCents: 888_888,
    cancelled: true,
  })

  // ── THE FINAL BATCH, WEEK TWO, WITH BOTH CREW LINES ──────────────────
  const batch = await owner.settlementBatch.create({
    data: {
      organizationId,
      batchNumber: `SB-${nonce}`,
      status: 'FINAL',
      periodStart: WEEK_2,
      periodEnd: new Date(WEEK_2.getTime() + 6 * 86_400_000),
      statementDate: WEEK_2,
      checkDate: WEEK_2,
    },
  })

  for (const [driverId, amountCents] of [
    [mckaneId, 40_000],
    [hallId, 40_000],
  ] as const) {
    const settlement = await owner.settlement.create({
      data: {
        organizationId,
        companyId: ramId,
        batchId: batch.id,
        driverId,
        settlementNumber: `ST-${nonce}-${driverId.slice(-4)}`,
        periodStart: WEEK_2,
        periodEnd: new Date(WEEK_2.getTime() + 6 * 86_400_000),
      },
    })
    await owner.settlementLoadLine.create({
      data: {
        settlementId: settlement.id,
        organizationId,
        driverId,
        loadId: teamLoadId,
        loadNumber: 'TEAM',
        companyId: ramId,
        companyName: 'RAM',
        puPlace: 'Whiteland,IN',
        delPlace: 'Gastonia,NC',
        puDate: WEEK_2,
        delDate: WEEK_2,
        grossCents: 200_000,
        milesHundredths: 40_000,
        amountCents,
        settledBasis: 'rate',
      },
    })
  }
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

describe('gross', () => {
  it('is what the freight billed, per authority per week', async () => {
    const built = await report()
    expect(cell(built, WEEK_1, ramId)?.grossCents).toBe(100_000)
    expect(cell(built, WEEK_2, dolphinsId)?.grossCents).toBe(150_000)
    expect(cell(built, WEEK_3, dolphinsId)?.grossCents).toBe(90_000)
  })

  it('INCLUDES closed history, which every other definition excludes', async () => {
    // THE GUARD NAMED "closed history excluded from gross". It is revenue,
    // and this page is where money from before the cutover shows up.
    // RAM's week two is the $2,000 team load plus the $700 Datatruck load.
    const built = await report()
    expect(cell(built, WEEK_2, ramId)?.grossCents).toBe(270_000)
  })

  it('leaves out deleted and cancelled loads', async () => {
    // THE GUARD NAMED "deleted load counted". Both were seeded at absurd
    // rates precisely so that counting either is unmissable.
    const built = await report()
    const ram = cell(built, WEEK_2, ramId)!
    expect(ram.grossCents).toBeLessThan(900_000)
  })

  it('counts a team load ONCE, however many people crewed it', async () => {
    // THE GUARD NAMED "team load counted once for pay". The load is one
    // load: two settlement lines must not double the revenue.
    const built = await report()
    expect(cell(built, WEEK_2, ramId)?.grossCents).toBe(270_000)
  })
})

describe('after driver pay', () => {
  it('subtracts BOTH crew members in the settled week', async () => {
    const built = await report()
    // $2,700 gross less MCKANE's $400 and HALL's $400.
    expect(cell(built, WEEK_2, ramId)?.afterDriverPayCents).toBe(190_000)
  })

  it('is a dash in the weeks before the first FINAL batch', async () => {
    const built = await report()
    expect(cell(built, WEEK_1, ramId)?.afterDriverPayCents).toBeNull()
  })

  it('is a real number in a later week with no lines of its own', async () => {
    // Week three is AFTER the first settled period, so nothing being settled
    // there is a fact rather than an absence.
    const built = await report()
    expect(cell(built, WEEK_3, dolphinsId)?.afterDriverPayCents).toBe(90_000)
  })

  it('never draws one authority from another authority lines', async () => {
    // Dolphins ran no team load and owes no crew anything in week two.
    const built = await report()
    expect(cell(built, WEEK_2, dolphinsId)?.afterDriverPayCents).toBe(150_000)
  })
})

// ── A DRAFT IS A PROPOSAL, NOT A PAYMENT ───────────────────────────────
//
// Counting a DRAFT batch would let this page move because somebody opened a
// draft and closed it again. The harness found this uncovered: adding DRAFT
// to the status filter broke nothing, because the fixture had no draft in it.
describe('a DRAFT batch', () => {
  it('is not subtracted from anything', async () => {
    const week3Load = await owner.load.findFirstOrThrow({
      where: { companyId: dolphinsId, totalRevenueCents: 90_000 },
      select: { id: true },
    })
    const draft = await owner.settlementBatch.create({
      data: {
        organizationId,
        batchNumber: `SB-DRAFT-${nonce}`,
        status: 'DRAFT',
        periodStart: WEEK_3,
        periodEnd: new Date(WEEK_3.getTime() + 6 * 86_400_000),
        statementDate: WEEK_3,
        checkDate: WEEK_3,
      },
    })
    const settlement = await owner.settlement.create({
      data: {
        organizationId,
        companyId: dolphinsId,
        batchId: draft.id,
        driverId: mckaneId,
        settlementNumber: `ST-DRAFT-${nonce}`,
        periodStart: WEEK_3,
        periodEnd: new Date(WEEK_3.getTime() + 6 * 86_400_000),
      },
    })
    await owner.settlementLoadLine.create({
      data: {
        settlementId: settlement.id,
        organizationId,
        driverId: mckaneId,
        loadId: week3Load.id,
        loadNumber: 'DRAFTED',
        companyId: dolphinsId,
        companyName: 'Dolphins',
        puPlace: 'Whiteland,IN',
        delPlace: 'Gastonia,NC',
        puDate: WEEK_3,
        delDate: WEEK_3,
        grossCents: 90_000,
        milesHundredths: 40_000,
        amountCents: 27_000,
        settledBasis: 'rate',
      },
    })

    const built = await report()
    // Untouched: the draft line is a proposal and must not reach the page.
    expect(cell(built, WEEK_3, dolphinsId)?.afterDriverPayCents).toBe(90_000)
  })
})

describe('the All companies row', () => {
  it('sums both authorities in the week', async () => {
    const built = await report()
    const all = built.periods.find(
      (p) => p.periodStart.getTime() === WEEK_2.getTime(),
    )!.all
    expect(all.grossCents).toBe(270_000 + 150_000)
    expect(all.afterDriverPayCents).toBe(190_000 + 150_000)
  })
})

describe('changing a settled gross', () => {
  it('moves the number', async () => {
    // The acceptance's last line, and the one that proves the page is reading
    // the database rather than a cache of its own.
    const before = (await report()).periods.find(
      (p) => p.periodStart.getTime() === WEEK_2.getTime(),
    )!.all.grossCents

    const dolphinsLoad = await owner.load.findFirstOrThrow({
      where: { companyId: dolphinsId, totalRevenueCents: 150_000 },
      select: { id: true },
    })
    await owner.load.update({
      where: { id: dolphinsLoad.id },
      data: {
        directSettled: true,
        settledGrossCents: 120_000,
        settledGrossConfirmedAt: new Date(),
      },
    })

    const after = (await report()).periods.find(
      (p) => p.periodStart.getTime() === WEEK_2.getTime(),
    )!.all.grossCents

    expect(after).toBe(before - 30_000)
  })
})
