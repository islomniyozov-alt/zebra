import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg, type TxClient } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import {
  finaliseBatch,
  openBatch,
  refreshDraft,
  SETTLEMENT_BATCH_TIMEOUT_MS,
} from '@/lib/settlement-batch'
import { addBatchCharge } from '@/lib/batch-charges'
import { weekOf } from '@/lib/settlement-week'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// A BATCH TAKES ONLY ITS OWN AUTHORITY'S ONE-OFF CHARGES (MONEY-DESIGN §4,
// owner's ruling 2026-11-18; migration 75; TMS §6.2.10 part 7 step 3).
//
// One driver, freight under two authorities in the same week, a batch for
// each over the same dates — legal, the overlap rule binds a scope. The
// statement's letterhead is the driver's truck's company in BOTH batches, so
// nothing on the statement tells them apart. A charge added from RAM's batch
// must reach RAM's draft and leave Dolphins' draft exactly as it was — on a
// refresh, and at Dolphins' finalise, which must not mark RAM's charge taken.
//
// NOT VACUOUS: the RAM draft's deductions move by the charge, so the charge
// was written and read; only the other batch is unchanged.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let ramId = ''
let dolphinsId = ''
let userId = ''
let driverId = ''
const batches: Record<string, string> = {}

const nonce = Math.random().toString(36).slice(2, 8)
const DAY = 86_400_000
const WEEK = weekOf(new Date(Date.UTC(2026, 6, 15)))
const CHARGE = 12_500

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'batch-charge-scope.test' },
    timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS,
  })

const statementOf = (batchId: string) =>
  owner.settlement.findFirstOrThrow({
    where: { batchId, driverId, deletedAt: null },
    select: { id: true, status: true, deductionsCents: true, netCents: true },
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  organizationId = (
    await owner.organization.create({
      data: { name: `Scope ${nonce}`, slug: `charge-scope-${nonce}` },
    })
  ).id
  const company = async (name: string) =>
    (
      await owner.company.create({
        data: {
          organizationId,
          name,
          addressLine1: '1 Dock St',
          city: 'Dayton',
          state: 'OH',
          postalCode: '45426',
        },
      })
    ).id
  ramId = await company(`RAM ${nonce}`)
  dolphinsId = await company(`DOLPHINS ${nonce}`)
  userId = (
    await owner.user.create({
      data: { email: `charge-scope-${nonce}@example.test`, name: 'Scope' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
  // THE TRUCK IS RAM'S, so the letterhead is RAM's in both batches.
  const truckId = (
    await owner.truck.create({
      data: {
        organizationId,
        companyId: ramId,
        unitNumber: `S-${nonce}`,
        vin: `VINS${nonce}0000000`,
      },
    })
  ).id
  driverId = (
    await owner.driver.create({
      data: {
        organizationId,
        companyId: ramId,
        firstName: 'BOTH',
        lastName: nonce.toUpperCase(),
        driverType: 'OWNER_OPERATOR',
        assignedTruckId: truckId,
      },
    })
  ).id
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId,
      type: 'PERCENT_GROSS',
      percentBps: 2500,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    },
  })
  const brokerId = (
    await withOrg(
      organizationId,
      (tx) => createBroker(tx, organizationId, { name: `BK ${nonce}` }),
      {
        attribution: { userId, ip: null, userAgent: 'batch-charge-scope.test' },
        timeoutMs: LOAD_WRITE_TIMEOUT_MS,
      },
    )
  ).id

  // ONE DELIVERED TRIP UNDER EACH AUTHORITY, THE SAME DRIVER, THE SAME WEEK.
  for (const companyId of [ramId, dolphinsId]) {
    const load = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId,
          customerId: brokerId,
          referenceNumber: `S-${nonce}-${companyId.slice(-4)}`,
          stops: [
            {
              type: 'PICKUP',
              city: 'Whiteland',
              state: 'IN',
              scheduledAt: new Date(WEEK.start.getTime() + DAY),
            },
            {
              type: 'DELIVERY',
              name: 'Gastonia DC',
              scheduledAt: new Date(WEEK.start.getTime() + 2 * DAY),
            },
          ],
          linehaulCents: 200_000,
        },
        { byUserId: userId },
      ),
    )
    await owner.load.update({
      where: { id: load.id },
      data: { truckId, driverId, operationalStatus: 'DELIVERED' },
    })
    await owner.loadStatusEvent.create({
      data: {
        organizationId,
        loadId: load.id,
        axis: 'OPERATIONAL',
        toStatus: 'DELIVERED',
        outcome: 'APPLIED',
        occurredAt: new Date(WEEK.start.getTime() + 2 * DAY),
      },
    })
  }

  // TWO BATCHES OVER THE SAME DATES, ONE PER AUTHORITY.
  for (const [name, companyId] of [
    ['ram', ramId],
    ['dolphins', dolphinsId],
  ] as const) {
    const opened = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period: WEEK,
        statementDate: new Date(WEEK.end.getTime() + 3 * DAY),
        companyId,
      }),
    )
    if (!opened.ok) throw new Error(`${name}: ${JSON.stringify(opened)}`)
    batches[name] = opened.batchId
  }
}, 600_000)

afterAll(async () => {
  await owner?.$disconnect()
})

describe('a one-off charge added from one authority’s batch', () => {
  it('reaches that batch’s draft and leaves the other authority’s draft unchanged', async () => {
    const ramBefore = await statementOf(batches.ram!)
    const dolphinsBefore = await statementOf(batches.dolphins!)

    const added = await inOrg((tx) =>
      addBatchCharge(tx, {
        batchId: batches.ram!,
        settlementIds: [ramBefore.id],
        type: 'Other',
        description: 'Damaged pallet',
        amountCents: CHARGE,
      }),
    )
    expect(added).toEqual({ ok: true, added: 1, refused: [] })

    const charge = await owner.settlementCharge.findFirstOrThrow({
      where: { driverId, batchId: batches.ram! },
    })
    expect(charge.companyId).toBe(ramId)
    expect(charge.amountCents).toBe(-CHARGE)

    // NOT VACUOUS: RAM's draft took it.
    const ramAfter = await statementOf(batches.ram!)
    expect(ramAfter.deductionsCents).toBe(ramBefore.deductionsCents - CHARGE)
    expect(ramAfter.netCents).toBe(ramBefore.netCents - CHARGE)

    // THE OTHER AUTHORITY'S DRAFT, REBUILT, IS EXACTLY AS IT WAS.
    await inOrg((tx) => refreshDraft(tx, batches.dolphins!))
    const dolphinsAfter = await statementOf(batches.dolphins!)
    expect(dolphinsAfter.deductionsCents).toBe(dolphinsBefore.deductionsCents)
    expect(dolphinsAfter.netCents).toBe(dolphinsBefore.netCents)
  }, 300_000)

  it('is not marked taken when the other authority’s batch is posted', async () => {
    const posted = await inOrg((tx) =>
      finaliseBatch(tx, batches.dolphins!, userId),
    )
    expect(posted.ok, JSON.stringify(posted)).toBe(true)
    const charge = await owner.settlementCharge.findFirstOrThrow({
      where: { driverId, batchId: batches.ram! },
    })
    expect(charge.settledAt).toBeNull()

    // And its own batch's post takes it.
    const ram = await inOrg((tx) => finaliseBatch(tx, batches.ram!, userId))
    expect(ram.ok, JSON.stringify(ram)).toBe(true)
    const taken = await owner.settlementCharge.findFirstOrThrow({
      where: { id: charge.id },
    })
    expect(taken.settledAt).not.toBeNull()
  }, 300_000)
})
