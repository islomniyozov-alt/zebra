import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { finaliseBatch, openBatch } from '@/lib/settlement-batch'
import { addSettlementLine, generateSettlement } from '@/lib/settlements'
import {
  rowsNetByDriver,
  statementNetByDriver,
  transactionsInWindow,
} from '@/lib/transactions-report'
import { weekOf } from '@/lib/settlement-week'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE TRANSACTIONS REPORT AGREES WITH THE STATEMENTS, TO THE CENT (§6.2.10 §4).
//
// Every driver's rows in the window sum to what that driver's statements netted.
// Both sides above zero, and all four of the office's kinds present — trip pay,
// deduction, advance, adjustment — because an agreement test over two kinds
// would pass against a report that silently dropped the other two.
//
// ── TWO ENGINES, DELIBERATELY ─────────────────────────────────────────────
//
// Trip pay and the standing-charge deduction come from the BATCH engine; the
// advance and the adjustment come from the SINGLE-STATEMENT engine
// (`generateSettlement` + `addSettlementLine`). They are not mixed on one
// statement, because `refreshTotals` sums `SettlementLine` only and would
// overwrite a batch statement's net — a pre-existing gap, recorded in GAPS.md,
// not papered over here by a fixture that avoids it quietly. Each engine
// computes its own net; the report must agree with both.
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
const WINDOW = {
  from: WEEK.start,
  to: new Date(WEEK.end.getTime() + 86_399_999),
  companyId: null,
}

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'transactions-report.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  organizationId = (
    await owner.organization.create({
      data: { name: `Txn ${nonce}`, slug: `txn-${nonce}` },
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
      data: { email: `txn-${nonce}@example.test`, name: 'Txn' },
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
        unitNumber: `X-${nonce}`,
        vin: `VINX${nonce}0000000`,
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

  // A STANDING CHARGE IN FORCE, so the batch engine writes a deduction line and
  // the window carries the office's "deduction" kind from the engine itself.
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

async function trip(driverId: string, cents: number): Promise<string> {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        referenceNumber: `T-${nonce}-${Math.random().toString(36).slice(2, 7)}`,
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

describe('every pay line in the window, by driver', () => {
  it("sums to what each driver's statements netted, with all four kinds present", async () => {
    // ── THE BATCH ENGINE: trip pay and a standing-charge deduction ─────────
    await trip(batchDriverId, 200_000)
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

    // ── THE SINGLE-STATEMENT ENGINE: trip pay, then an advance and an
    // adjustment put on by hand ────────────────────────────────────────────
    await trip(singleDriverId, 150_000)
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
    const advance = await inOrg((tx) =>
      addSettlementLine(tx, generated.settlementId, {
        type: 'DEDUCTION_ADVANCE',
        description: 'Cash advance Tuesday',
        amountCents: 20_000,
      }),
    )
    expect(advance.ok).toBe(true)
    const bonus = await inOrg((tx) =>
      addSettlementLine(tx, generated.settlementId, {
        type: 'BONUS',
        description: 'Clean inspection',
        amountCents: 5_000,
      }),
    )
    expect(bonus.ok).toBe(true)

    // ── THE REPORT, AGAINST THE STATEMENTS ────────────────────────────────
    const rows = await inOrg((tx) => transactionsInWindow(tx, WINDOW))
    const kinds = new Set(rows.map((row) => row.kind))
    expect([...kinds].sort()).toEqual([
      'adjustment',
      'advance',
      'deduction',
      'tripPay',
    ])

    const reported = rowsNetByDriver(rows)
    const netted = await inOrg((tx) => statementNetByDriver(tx, WINDOW))

    for (const driverId of [batchDriverId, singleDriverId]) {
      const lhs = reported.get(driverId) ?? 0
      const rhs = netted.get(driverId) ?? 0
      // BOTH ABOVE ZERO, then equal — the order the assertions have to go in.
      expect(rhs).toBeGreaterThan(0)
      expect(lhs).toBe(rhs)
    }

    // AND THE SIGNS ARE THE LEDGER'S: the deduction and the advance are
    // negative on their rows, the trip pay and the bonus positive.
    const byKind = (kind: string) => rows.filter((row) => row.kind === kind)
    expect(byKind('deduction').every((row) => row.amountCents < 0)).toBe(true)
    expect(byKind('advance').every((row) => row.amountCents < 0)).toBe(true)
    expect(byKind('tripPay').every((row) => row.amountCents > 0)).toBe(true)
    expect(byKind('adjustment').every((row) => row.amountCents > 0)).toBe(true)
  })
})
