import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { finaliseBatch, openBatch } from '@/lib/settlement-batch'
import {
  addSettlementLine,
  approveSettlement,
  generateSettlement,
} from '@/lib/settlements'
import { salaryByDriverWeek } from '@/lib/by-company'
import { weekOf } from '@/lib/settlement-week'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE SALARY REPORT EQUALS THE STATEMENTS IT SUMMARISES, TO THE CENT
// (§6.2.10 part 5, the second of the two agreement tests the brief names).
//
// Per driver, the report's rows sum to that driver's ISSUED statements in the
// window — gross, deductions, other pay and net, each to the cent — and a
// draft week inside the window appears in neither side. Both sides above zero
// before they are compared, so an empty report cannot agree with an empty
// window.
//
// ── TWO ENGINES, AND A DRAFT ───────────────────────────────────────────────
//
// Driver BATCH is paid by the batch engine and finalised. Driver SINGLE is
// paid by the single-statement engine, given a bonus by hand, and approved —
// which is the statement `driverTotals` could never see, because it joined
// through a batch that does not exist. Driver BATCH then has a SECOND week
// opened and left in draft: that week has to be absent, and the test checks
// that the draft exists before it checks that the report leaves it out.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let truckId = ''
let batchDriverId = ''
let singleDriverId = ''

const nonce = Math.random().toString(36).slice(2, 8)
const WEEK = weekOf(new Date(Date.UTC(2026, 7, 19)))
const NEXT = weekOf(new Date(WEEK.end.getTime() + 86_400_000))
const WINDOW = {
  from: WEEK.start,
  to: new Date(NEXT.end.getTime() + 86_399_999),
  companyId: null,
}

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'salary-report.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  organizationId = (
    await owner.organization.create({
      data: { name: `Sal ${nonce}`, slug: `sal-${nonce}` },
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
      data: { email: `sal-${nonce}@example.test`, name: 'Sal' },
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
        unitNumber: `S-${nonce}`,
        vin: `VINS${nonce}0000000`,
      },
    })
  ).id
  const driver = async (first: string) => {
    const row = await owner.driver.create({
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
        driverId: row.id,
        type: 'PERCENT_LINEHAUL',
        percentBps: 3000,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    })
    return row.id
  }
  batchDriverId = await driver('BATCH')
  singleDriverId = await driver('SINGLE')
  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BK ${nonce}` }),
    )
  ).id
  // A STANDING CHARGE, so deductions are above zero on the batch side.
  await owner.standingCharge.create({
    data: {
      organizationId,
      type: 'Insurance',
      amountCents: 12_500,
      cadence: 'WEEKLY',
      appliesTo: 'ALL',
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    },
  })
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

async function trip(
  driverId: string,
  cents: number,
  week: { start: Date },
): Promise<string> {
  const day = (n: number) => new Date(week.start.getTime() + n * 86_400_000)
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
            scheduledAt: day(1),
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: day(2),
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
      occurredAt: day(3),
    },
  })
  return load.id
}

describe('the salary report, against the statements', () => {
  it('sums per driver to the issued statements, and leaves the draft week out', async () => {
    // ── BATCH ENGINE, WEEK ONE, FINALISED ─────────────────────────────────
    await trip(batchDriverId, 200_000, WEEK)
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
    const finalised = await inOrg((tx) =>
      finaliseBatch(tx, opened.batchId, userId),
    )
    expect(finalised.ok).toBe(true)

    // ── SINGLE-STATEMENT ENGINE, WEEK ONE, APPROVED BY HAND ──────────────
    await trip(singleDriverId, 150_000, WEEK)
    const generated = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId: singleDriverId,
        periodStart: WEEK.start,
        periodEnd: WEEK.end,
        labels: { loadPay: (loadNumber) => `Load ${loadNumber}` },
      }),
    )
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    const bonus = await inOrg((tx) =>
      addSettlementLine(tx, generated.settlementId, {
        type: 'BONUS',
        description: 'Clean inspection',
        amountCents: 5_000,
      }),
    )
    expect(bonus.ok).toBe(true)
    const approved = await inOrg((tx) =>
      approveSettlement(tx, generated.settlementId, userId),
    )
    expect(approved.ok).toBe(true)

    // ── BATCH ENGINE, WEEK TWO, LEFT IN DRAFT ────────────────────────────
    await trip(batchDriverId, 90_000, NEXT)
    const draft = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period: NEXT,
        statementDate: NEXT.end,
        companyId,
      }),
    )
    expect(draft.ok).toBe(true)
    // THE DRAFT EXISTS — asserted before its absence means anything.
    const drafts = await owner.settlement.count({
      where: { organizationId, driverId: batchDriverId, status: 'DRAFT' },
    })
    expect(drafts).toBe(1)

    // ── THE REPORT ───────────────────────────────────────────────────────
    const rows = await inOrg((tx) => salaryByDriverWeek(tx, WINDOW))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.companyId === companyId)).toBe(true)
    expect(
      rows.some((row) => row.periodStart.getTime() === NEXT.start.getTime()),
    ).toBe(false)

    // ── EVERY ROW IS AN EQUATION, WHICHEVER ENGINE WROTE IT ──────────────
    //
    // gross + other pay + deductions = net, on each row. The reader picks the
    // engine's columns with a CASE on `batchId`; a wrong pick — earnings off a
    // single-engine statement, a positive deduction off a batch one — breaks
    // this on the row it got wrong, which is a sharper instrument than
    // restating the CASE in the test.
    for (const row of rows) {
      expect(
        row.grossCents + row.otherPayCents + row.deductionsCents,
        `${row.driverName} ${row.periodStart.toISOString()}`,
      ).toBe(row.netCents)
    }

    // ── AND PER DRIVER, THE NET AGREES WITH THE ISSUED STATEMENTS ────────
    const issued = await owner.settlement.groupBy({
      by: ['driverId'],
      where: {
        organizationId,
        status: { in: ['APPROVED', 'PAID'] },
        periodEnd: { gte: WINDOW.from, lte: WINDOW.to },
      },
      _sum: { netCents: true },
    })
    const sum = (
      driverId: string,
      pick: (row: (typeof rows)[number]) => number,
    ) =>
      rows
        .filter((row) => row.driverId === driverId)
        .reduce((acc, row) => acc + pick(row), 0)

    for (const driverId of [batchDriverId, singleDriverId]) {
      const net = issued.find((row) => row.driverId === driverId)?._sum.netCents
      // BOTH ABOVE ZERO, then equal — the order the assertions have to go in.
      expect(net ?? 0, driverId).toBeGreaterThan(0)
      expect(sum(driverId, (row) => row.netCents)).toBe(net)
    }

    // THE SIGNS ARE THE LEDGER'S ON BOTH ENGINES: the batch driver's standing
    // charge is negative, the single driver's bonus is above zero in gross.
    expect(sum(batchDriverId, (row) => row.deductionsCents)).toBeLessThan(0)
    expect(sum(singleDriverId, (row) => row.deductionsCents)).toBe(0)
    // THE BONUS IS OTHER PAY, NOT GROSS (§6.2.2, migration 67): 30% of the
    // $1,500.00 linehaul under earnings, the $50.00 put on by hand beside it.
    expect(sum(singleDriverId, (row) => row.grossCents)).toBe(45_000)
    expect(sum(singleDriverId, (row) => row.otherPayCents)).toBe(5_000)
  })
})
