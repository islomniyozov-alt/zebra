import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { finaliseBatch, openBatch, refreshDraft } from '@/lib/settlement-batch'
import { approveSettlement, markSettlementPaid } from '@/lib/settlements'
import { excludeTrips } from '@/lib/batch-exclusions'
import { weekOf } from '@/lib/settlement-week'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// DRAFT → PARTIAL → FINAL → PAID, AGAINST ROWS (§6.2.10 part 3).
//
// Three drivers, three statements, and the office approving them one at a time
// from the statements grid — which is the path that used to be unsafe. The claim
// that matters most is the second one: a refresh in the middle leaves the
// approved statement exactly as it was, number and all. Until 2026-10-06 it
// deleted it.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let truckId = ''
const driverIds: string[] = []

const nonce = Math.random().toString(36).slice(2, 8)
const WEEK = weekOf(new Date(Date.UTC(2026, 7, 12)))

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'batch-partial.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  organizationId = (
    await owner.organization.create({
      data: { name: `Part ${nonce}`, slug: `part-${nonce}` },
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
  userId = (
    await owner.user.create({
      data: { email: `part-${nonce}@example.test`, name: 'Partial' },
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
        unitNumber: `Q-${nonce}`,
        vin: `VINQ${nonce}0000000`,
      },
    })
  ).id
  for (const first of ['ONE', 'TWO', 'THREE']) {
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: first,
        lastName: nonce.toUpperCase(),
      },
    })
    await owner.driverPayRule.create({
      data: {
        organizationId,
        driverId: driver.id,
        type: 'PERCENT_LINEHAUL',
        percentBps: 3000,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    })
    driverIds.push(driver.id)
  }
  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BK ${nonce}` }),
    )
  ).id
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

/** One delivered, POD-received trip in the week for the given driver. */
async function trip(driverId: string, cents: number): Promise<string> {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        referenceNumber: `P-${nonce}-${Math.random().toString(36).slice(2, 7)}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: new Date(WEEK.start.getTime() + 86_400_000),
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: new Date(WEEK.start.getTime() + 2 * 86_400_000),
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
      occurredAt: new Date(WEEK.start.getTime() + 3 * 86_400_000),
    },
  })
  return load.id
}

const batchStatus = (batchId: string) =>
  owner.settlementBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: {
      status: true,
      finalizedAt: true,
      finalizedByUserId: true,
      paidAt: true,
    },
  })

describe('a batch moves as its statements move', () => {
  it('DRAFT, then PARTIAL on the first single approve, with the approved statement surviving a refresh', async () => {
    await trip(driverIds[0]!, 100_000)
    await trip(driverIds[1]!, 200_000)
    await trip(driverIds[2]!, 300_000)

    const opened = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period: WEEK,
        statementDate: WEEK.end,
        companyId,
      }),
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const batchId = opened.batchId
    expect((await batchStatus(batchId)).status).toBe('DRAFT')

    const statements = await owner.settlement.findMany({
      where: { batchId },
      orderBy: { grossCents: 'asc' },
      select: { id: true, settlementNumber: true },
    })
    expect(statements.length).toBe(3)
    const first = statements[0]!

    // ONE STATEMENT, FROM THE STATEMENTS GRID'S PATH.
    const approved = await inOrg((tx) =>
      approveSettlement(tx, first.id, userId),
    )
    expect(approved.ok).toBe(true)
    expect((await batchStatus(batchId)).status).toBe('PARTIAL')

    const issued = await owner.settlement.findUniqueOrThrow({
      where: { id: first.id },
      select: { settlementNumber: true, status: true },
    })
    expect(issued.status).toBe('APPROVED')
    expect(issued.settlementNumber.startsWith('DRAFT-')).toBe(false)

    // THE CLAIM THAT MATTERS: a refresh in the middle. Before 2026-10-06 this
    // deleted every statement on the batch, approved or not.
    const refreshed = await inOrg((tx) => refreshDraft(tx, batchId))
    expect(refreshed.ok).toBe(true)

    const after = await owner.settlement.findUnique({
      where: { id: first.id },
      select: { settlementNumber: true, status: true },
    })
    // SAME ROW, SAME NUMBER, SAME STATUS — not a rebuilt lookalike.
    expect(after).toEqual({
      settlementNumber: issued.settlementNumber,
      status: 'APPROVED',
    })
    // And the other two were rebuilt as drafts, not duplicated.
    expect(await owner.settlement.count({ where: { batchId } })).toBe(3)
    expect((await batchStatus(batchId)).status).toBe('PARTIAL')

    // A PARTIAL BATCH IS STILL OPEN TO THE TICKS, and an exclusion touches only
    // the drafts: excluding a trip that is on the approved statement changes
    // nothing, because that trip is not settleable.
    const extra = await trip(driverIds[1]!, 50_000)
    const excluded = await inOrg((tx) =>
      excludeTrips(tx, { batchId, loadIds: [extra], byUserId: userId }),
    )
    expect(excluded.ok).toBe(true)
    expect(
      await owner.settlementLoadLine.count({ where: { loadId: extra } }),
    ).toBe(0)
    expect((await batchStatus(batchId)).status).toBe('PARTIAL')

    // FINALISE APPROVES THE REMAINDER, and the derivation lands on FINAL with
    // the stamp — the same stamp the last single approve would have written.
    const finalised = await inOrg((tx) => finaliseBatch(tx, batchId, userId))
    expect(finalised.ok).toBe(true)
    const final = await batchStatus(batchId)
    expect(final.status).toBe('FINAL')
    expect(final.finalizedAt).not.toBeNull()
    expect(final.finalizedByUserId).toBe(userId)
    // The first statement kept its ORIGINAL number through the finalise.
    expect(
      (
        await owner.settlement.findUniqueOrThrow({
          where: { id: first.id },
          select: { settlementNumber: true },
        })
      ).settlementNumber,
    ).toBe(issued.settlementNumber)

    // PAID WHEN THE LAST ONE IS PAID, whichever button paid it.
    const all = await owner.settlement.findMany({
      where: { batchId },
      select: { id: true },
    })
    for (const [index, row] of all.entries()) {
      await inOrg((tx) =>
        markSettlementPaid(tx, row.id, {
          method: 'ACH',
          reference: `ACH-${nonce}-${index}`,
        }),
      )
      const now = await batchStatus(batchId)
      expect(now.status).toBe(index === all.length - 1 ? 'PAID' : 'FINAL')
    }
    expect((await batchStatus(batchId)).paidAt).not.toBeNull()
  })
})
