import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { tenantReader, txReader, withOrg, type TxClient } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { openBatch } from '@/lib/settlement-batch'
import { previewBatch } from '@/lib/batch-preview'
import { readBatchPageHead, type BatchPageHead } from '@/lib/batch-page-head'
import { weekOf } from '@/lib/settlement-week'
import { createPrismaClient, prisma, statementsOf } from '@/lib/db'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE BATCH SCREEN'S OWN READS IN ONE STATEMENT (§6.2.10 part 2b v11.08).
//
// `readBatchPageHead` is a second spelling of three reads the page made inside
// a transaction: the batch with its statements (`settlementBatch.findFirst`),
// the preview's window (`previewBatch`'s `load.findMany`) and the batch's
// exclusions. Two claims, against rows:
//
// 1. Through either transport it returns what those reads returned — the
//    batch, every statement, and the preview bucket for bucket — for an
//    authority's batch, another authority's, and an org-wide one, on a week
//    with a load on BOTH SIDES of every filter: deleted, cancelled and closed
//    history; inside and outside the fourteen-day margin, before and after;
//    the other authority; a POD event refused as stale; a line on this batch,
//    on another batch, and none; an exclusion; no driver; no rule.
// 2. Through the tenant reader, as `zebra_app` outside any transaction, it is
//    ONE statement, and another organization's batch reads as absent. A
//    deleted batch reads as absent too.
//
// The engine's input (`batchInputForOrg`) is not here: it stays the engine's
// own reader, by the owner's ruling, and has its own suites.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let otherOrgId = ''
let alphaId = ''
let betaId = ''
let userId = ''
let brokerId = ''
let truckId = ''
let paidId = ''
let rulelessId = ''
let betaDriverId = ''

const nonce = Math.random().toString(36).slice(2, 8)
const DAY = 86_400_000
const WEEK = weekOf(new Date(Date.UTC(2026, 5, 10)))

const loads: Record<string, string> = {}
const batches: Record<string, string> = {}
let otherBatchId = ''

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'batch-page-head.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

/** A trip delivered `deliveredDay` days after the week starts. */
async function trip(input: {
  deliveredDay: number
  podDay?: number | null
  podOutcome?: 'APPLIED' | 'REFUSED_STALE'
  company?: string
  driver?: string | null
  cents?: number
}): Promise<string> {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId: input.company ?? alphaId,
        customerId: brokerId,
        referenceNumber: `H-${nonce}-${Math.random().toString(36).slice(2, 7)}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: new Date(
              WEEK.start.getTime() + (input.deliveredDay - 1) * DAY,
            ),
          },
          {
            type: 'DELIVERY',
            name: 'Gastonia DC',
            scheduledAt: new Date(
              WEEK.start.getTime() + input.deliveredDay * DAY,
            ),
          },
        ],
        linehaulCents: input.cents ?? 100_000,
      },
      { byUserId: userId },
    ),
  )
  const driverId = input.driver === undefined ? paidId : input.driver
  await owner.load.update({
    where: { id: load.id },
    data: {
      truckId,
      driverId,
      operationalStatus: input.podDay == null ? 'DELIVERED' : 'POD_RECEIVED',
      actualMiles: 812,
    },
  })
  if (input.podDay != null) {
    await owner.loadStatusEvent.create({
      data: {
        organizationId,
        loadId: load.id,
        axis: 'OPERATIONAL',
        toStatus: 'POD_RECEIVED',
        outcome: input.podOutcome ?? 'APPLIED',
        occurredAt: new Date(WEEK.start.getTime() + input.podDay * DAY),
      },
    })
  }
  return load.id
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  organizationId = (
    await owner.organization.create({
      data: { name: `Head ${nonce}`, slug: `batch-head-${nonce}` },
    })
  ).id
  const company = (name: string) =>
    owner.company.create({
      data: {
        organizationId,
        name,
        addressLine1: '1 Dock St',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
      },
    })
  alphaId = (await company(`ALPHA ${nonce}`)).id
  betaId = (await company(`BETA ${nonce}`)).id
  userId = (
    await owner.user.create({
      data: { email: `batch-head-${nonce}@example.test`, name: 'Head' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
  truckId = (
    await owner.truck.create({
      data: {
        organizationId,
        companyId: alphaId,
        unitNumber: `H-${nonce}`,
        vin: `VINH${nonce}0000000`,
      },
    })
  ).id
  const driver = async (
    first: string,
    companyId: string,
    payToName: string | null,
  ) =>
    (
      await owner.driver.create({
        data: {
          organizationId,
          companyId,
          firstName: first,
          lastName: nonce.toUpperCase(),
          payToName,
          driverType: 'OWNER_OPERATOR',
        },
      })
    ).id
  paidId = await driver('PAID', alphaId, 'Paid Haulage LLC')
  rulelessId = await driver('RULELESS', alphaId, null)
  betaDriverId = await driver('BETA', betaId, null)
  // THE RULE IN FORCE AND ONE THAT HAS ENDED, so `ruleInForce` chooses.
  await owner.driverPayRule.createMany({
    data: [
      {
        organizationId,
        driverId: paidId,
        type: 'PERCENT_LINEHAUL',
        percentBps: 3000,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
      {
        organizationId,
        driverId: paidId,
        type: 'PER_MILE',
        perMileCents: 60,
        effectiveFrom: new Date(Date.UTC(2025, 0, 1)),
        effectiveTo: new Date(Date.UTC(2025, 11, 31)),
      },
      {
        organizationId,
        driverId: betaDriverId,
        type: 'PERCENT_GROSS',
        percentBps: 2500,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    ],
  })
  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BK ${nonce}` }),
    )
  ).id

  // ── THE WEEK'S FREIGHT, A LOAD ON BOTH SIDES OF EVERY FILTER ──────────
  loads.ticked = await trip({ deliveredDay: 2, podDay: 3, cents: 120_000 })
  loads.declined = await trip({ deliveredDay: 2, podDay: 3, cents: 77_077 })
  loads.beta = await trip({
    deliveredDay: 3,
    podDay: 4,
    company: betaId,
    driver: betaDriverId,
  })
  loads.podLate = await trip({ deliveredDay: 6, podDay: 9 })
  loads.early = await trip({ deliveredDay: -3, podDay: -2 })
  loads.lateInMargin = await trip({ deliveredDay: 18, podDay: 19 })
  loads.beyondMargin = await trip({ deliveredDay: 22, podDay: 23 })
  loads.beforeMargin = await trip({ deliveredDay: -16, podDay: -15 })
  loads.transit = await trip({ deliveredDay: 4, podDay: null })
  loads.stale = await trip({
    deliveredDay: 4,
    podDay: 5,
    podOutcome: 'REFUSED_STALE',
  })
  loads.noDriver = await trip({ deliveredDay: 3, podDay: 4, driver: null })
  loads.noRule = await trip({ deliveredDay: 3, podDay: 4, driver: rulelessId })
  loads.deleted = await trip({ deliveredDay: 3, podDay: 4 })
  loads.cancelled = await trip({ deliveredDay: 3, podDay: 4 })
  loads.closed = await trip({ deliveredDay: 3, podDay: 4 })
  await owner.load.update({
    where: { id: loads.deleted },
    data: { deletedAt: new Date() },
  })
  await owner.load.update({
    where: { id: loads.cancelled },
    data: { isCancelled: true },
  })
  await owner.load.update({
    where: { id: loads.closed },
    data: { billingStatus: 'CLOSED_IN_DATATRUCK' },
  })

  // ── THE BATCHES ────────────────────────────────────────────────────────
  const alpha = await inOrg((tx) =>
    openBatch(tx, {
      organizationId,
      period: WEEK,
      statementDate: new Date(WEEK.end.getTime() + 3 * DAY),
      companyId: alphaId,
      excludeLoadIds: [loads.declined!],
      excludedByUserId: userId,
    }),
  )
  if (!alpha.ok) throw new Error(`alpha batch: ${JSON.stringify(alpha)}`)
  batches.alpha = alpha.batchId
  const beta = await inOrg((tx) =>
    openBatch(tx, {
      organizationId,
      period: WEEK,
      statementDate: new Date(WEEK.end.getTime() + 3 * DAY),
      companyId: betaId,
    }),
  )
  if (!beta.ok) throw new Error(`beta batch: ${JSON.stringify(beta)}`)
  batches.beta = beta.batchId
  // A TRIP DELIVERED AFTER THE BATCH WAS OPENED: in the window, no line.
  loads.afterOpen = await trip({ deliveredDay: 5, podDay: 6, cents: 9_000 })
  // AN ORG-WIDE BATCH OVER THE SAME WEEK, written directly — `openBatch`
  // refuses it beside the two scoped ones, and the screen still has to read
  // such a row (it is what a batch from before §6.2.10 looks like).
  const wide = {
    organizationId,
    periodStart: WEEK.start,
    periodEnd: WEEK.end,
    statementDate: new Date(WEEK.end.getTime() + 3 * DAY),
    checkDate: new Date(WEEK.end.getTime() + 5 * DAY),
  }
  batches.wide = (await owner.settlementBatch.create({ data: wide })).id
  batches.deleted = (
    await owner.settlementBatch.create({
      data: { ...wide, deletedAt: new Date() },
    })
  ).id

  const other = await owner.organization.create({
    data: {
      name: `Head other ${nonce}`,
      slug: `batch-head-other-${nonce}`,
      companies: { create: [{ name: `Other ${nonce}` }] },
    },
  })
  otherOrgId = other.id
  otherBatchId = (
    await owner.settlementBatch.create({
      data: { ...wide, organizationId: other.id },
    })
  ).id
}, 600_000)

afterAll(async () => {
  await owner?.$disconnect()
})

/** What the page read before v11.08, shaped as the head returns it. */
async function readByPrisma(
  tx: TxClient,
  id: string,
): Promise<BatchPageHead | null> {
  const batch = await tx.settlementBatch.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      batchNumber: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      statementDate: true,
      checkDate: true,
      organizationId: true,
      companyId: true,
      company: { select: { name: true } },
      settlements: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          settlementNumber: true,
          status: true,
          unitNumber: true,
          earningsCents: true,
          deductionsCents: true,
          otherPayCents: true,
          netCents: true,
          driver: { select: { firstName: true, lastName: true } },
          loadLines: { select: { id: true } },
        },
      },
    },
  })
  if (!batch) return null
  const preview = await previewBatch(tx, {
    from: batch.periodStart,
    to: batch.periodEnd,
    companyId: batch.companyId,
    forBatchId: batch.id,
  })
  return {
    batch: {
      ...batch,
      settlements: batch.settlements.map(({ loadLines, ...s }) => ({
        ...s,
        lines: loadLines.length,
      })),
    },
    preview,
  }
}

describe('/settlements/batches/[id] in one statement', () => {
  it('reads what the page’s reads read — an authority’s batch, another’s, the whole organization’s, through both transports', async () => {
    let compared = 0
    for (const name of ['alpha', 'beta', 'wide']) {
      const id = batches[name]!
      const [inTx, expected] = await inOrg(
        async (tx) =>
          [
            await readBatchPageHead(txReader(tx), id),
            await readByPrisma(tx, id),
          ] as const,
      )
      expect(inTx, `${name} in a transaction`).toEqual(expected)
      const viaReader = await readBatchPageHead(
        tenantReader(prisma, organizationId),
        id,
      )
      expect(viaReader, `${name} through the tenant reader`).toEqual(expected)
      compared += 2
    }
    expect(compared).toBe(6)

    // NOT VACUOUS: every bucket has the load it was built for, and the
    // filtered loads are in none.
    const alpha = (await readBatchPageHead(
      tenantReader(prisma, organizationId),
      batches.alpha!,
    ))!
    const ids = (rows: { loadId: string }[]) => rows.map((r) => r.loadId).sort()
    expect(ids(alpha.preview.available)).toEqual(
      [loads.ticked, loads.declined, loads.afterOpen].sort(),
    )
    expect(
      alpha.preview.available.filter((t) => t.excluded).map((t) => t.loadId),
    ).toEqual([loads.declined])
    expect(ids(alpha.preview.unavailable.outsideRange)).toEqual(
      [loads.podLate, loads.early, loads.lateInMargin].sort(),
    )
    expect(ids(alpha.preview.unavailable.inTransit)).toEqual(
      [loads.transit, loads.stale].sort(),
    )
    expect(ids(alpha.preview.unavailable.noDriver)).toEqual([loads.noDriver])
    expect(ids(alpha.preview.unavailable.noRule)).toEqual([loads.noRule])
    expect(alpha.preview.considered).toBe(10)
    const ticked = alpha.preview.available.find(
      (t) => t.loadId === loads.ticked,
    )!
    expect(ticked.payeeName).toBe('Paid Haulage LLC')
    expect(ticked.loadPayCents).toBe(36_000)
    expect(ticked.locations).toBe('Whiteland, IN → Gastonia DC')
    expect(alpha.batch.company?.name).toBe(`ALPHA ${nonce}`)
    // The paid driver's statement carries the one trip; the ruleless driver's
    // is there with none, which is how the engine records a blocker.
    expect(
      alpha.batch.settlements.map((s) => [s.driver.firstName, s.lines]).sort(),
    ).toEqual([
      ['PAID', 1],
      ['RULELESS', 0],
    ])

    const wide = (await readBatchPageHead(
      tenantReader(prisma, organizationId),
      batches.wide!,
    ))!
    expect(wide.batch.company).toBeNull()
    expect(ids(wide.preview.unavailable.alreadyInBatch)).toEqual(
      [loads.ticked, loads.beta].sort(),
    )
    expect(wide.preview.considered).toBe(11)
  }, 600_000)

  it('is ONE statement through the tenant reader; a deleted batch and another organization’s are absent', async () => {
    const client = createPrismaClient(process.env.DATABASE_URL!)
    try {
      const at = statementsOf(client)!
      const head = await readBatchPageHead(
        tenantReader(client, organizationId),
        batches.alpha!,
      )
      expect(statementsOf(client)! - at).toBe(1)
      expect(head?.batch.id).toBe(batches.alpha)
    } finally {
      await client.$disconnect()
    }
    expect(
      await readBatchPageHead(
        tenantReader(prisma, organizationId),
        batches.deleted!,
      ),
    ).toBeNull()
    const asUs = tenantReader(prisma, organizationId)
    const theirs = await readBatchPageHead(asUs, otherBatchId)
    expect(theirs).toBeNull()
    // NOT VACUOUS: as its own organization the batch is there.
    const own = await readBatchPageHead(
      tenantReader(prisma, otherOrgId),
      otherBatchId,
    )
    expect(own?.batch.id).toBe(otherBatchId)
  }, 300_000)
})
