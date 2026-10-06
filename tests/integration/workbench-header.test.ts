import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import {
  addSettlementLine,
  approveSettlement,
  findSettlementDrift,
  generateSettlement,
} from '@/lib/settlements'
import { addTripsToSettlement } from '@/lib/statement-workbench'
import { salaryByDriverWeek } from '@/lib/by-company'
import { weekOf } from '@/lib/settlement-week'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE WORKBENCH WRITES THE HEADER THE BATCH ENGINE WRITES (§6.2.2, "the
// header's columns, both engines"; migration 67).
//
// grossCents is the FREIGHT, earningsCents the driver's cut, otherPayCents the
// add-backs, deductionsCents NEGATIVE, and net = the three summed — on a
// statement the workbench made, after every kind of edit the workbench allows:
// generated, a bonus and a deduction put on by hand, a trip added by hand.
//
// A TRIP SITS IN ONE TABLE. The generate path's trips are LOAD_PAY lines; a
// trip added by hand is a SettlementLoadLine with no LOAD_PAY twin. The header
// reads both, which is what makes a hand-added trip and a generated one count
// once each.
//
// AND A TRIP ADDED BY HAND IS PRICED. Until 67, `addTripsToSettlement` wrote the
// freight as the pay and deferred pricing to a Recalculate that re-adds and does
// not re-price. The added line's pay is the rule's cut, below the freight; a
// driver with no usable rule is refused, not paid a hundred percent.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let truckId = ''
let driverId = ''
let unruledDriverId = ''

const nonce = Math.random().toString(36).slice(2, 8)
const WEEK = weekOf(new Date(Date.UTC(2026, 7, 19)))
const BPS = 3000
const cut = (freight: number) => (freight * BPS) / 10_000

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'workbench-header.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  organizationId = (
    await owner.organization.create({
      data: { name: `Wb ${nonce}`, slug: `wb-${nonce}` },
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
      data: { email: `wb-${nonce}@example.test`, name: 'Wb' },
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
        unitNumber: `W-${nonce}`,
        vin: `VINW${nonce}0000000`,
      },
    })
  ).id
  const driver = async (first: string, ruled: boolean) => {
    const row = await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: first,
        lastName: nonce.toUpperCase(),
      },
    })
    if (ruled) {
      await owner.driverPayRule.create({
        data: {
          organizationId,
          driverId: row.id,
          type: 'PERCENT_LINEHAUL',
          percentBps: BPS,
          effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
        },
      })
    }
    return row.id
  }
  driverId = await driver('RULED', true)
  unruledDriverId = await driver('UNRULED', false)
  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BK ${nonce}` }),
    )
  ).id
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

async function trip(forDriver: string, cents: number): Promise<string> {
  const day = (n: number) => new Date(WEEK.start.getTime() + n * 86_400_000)
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        referenceNumber: `W-${nonce}-${Math.random().toString(36).slice(2, 7)}`,
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
    data: { truckId, driverId: forDriver, operationalStatus: 'POD_RECEIVED' },
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

const header = (settlementId: string) =>
  owner.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: {
      grossCents: true,
      earningsCents: true,
      otherPayCents: true,
      reimbursementsCents: true,
      deductionsCents: true,
      advancesCents: true,
      netCents: true,
      loadLines: {
        select: { loadId: true, grossCents: true, amountCents: true },
      },
      lines: { select: { type: true, loadId: true, amountCents: true } },
    },
  })

const nets = (h: Awaited<ReturnType<typeof header>>) =>
  h.earningsCents + h.otherPayCents + h.deductionsCents

describe('a workbench statement, through every edit the workbench allows', () => {
  it("keeps the batch engine's header on generation, by hand, and on an added trip", async () => {
    // ── GENERATED: two trips ─────────────────────────────────────────────
    const first = await trip(driverId, 200_000)
    const second = await trip(driverId, 150_000)
    const generated = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId,
        periodStart: WEEK.start,
        periodEnd: WEEK.end,
        labels: { loadPay: (loadNumber) => `Load ${loadNumber}` },
      }),
    )
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    const id = generated.settlementId

    let h = await header(id)
    // THE GENERATE PATH'S TRIPS ARE LOAD LINES (migration 69), ONE EACH, AND
    // NOTHING IN `SettlementLine` — that table is for what is put on by hand.
    expect(h.loadLines.map((l) => l.loadId).sort()).toEqual(
      [first, second].sort(),
    )
    expect(h.lines).toHaveLength(0)
    // FREIGHT UNDER GROSS, THE CUT UNDER EARNINGS.
    expect(h.grossCents).toBe(350_000)
    expect(h.earningsCents).toBe(cut(350_000))
    expect(h.otherPayCents).toBe(0)
    expect(h.deductionsCents).toBe(0)
    expect(h.advancesCents).toBe(0)
    expect(h.netCents).toBe(nets(h))
    // The outcome names the same figures.
    expect(generated.earningsCents).toBe(h.earningsCents)
    expect(generated.netCents).toBe(h.netCents)

    // ── BY HAND: a bonus and a fuel deduction ────────────────────────────
    const bonus = await inOrg((tx) =>
      addSettlementLine(tx, id, {
        type: 'BONUS',
        description: 'Clean inspection',
        amountCents: 5_000,
      }),
    )
    expect(bonus.ok).toBe(true)
    const fuel = await inOrg((tx) =>
      addSettlementLine(tx, id, {
        type: 'DEDUCTION_FUEL',
        description: 'Fuel card',
        amountCents: 20_000,
      }),
    )
    expect(fuel.ok).toBe(true)

    h = await header(id)
    expect(h.grossCents).toBe(350_000)
    expect(h.earningsCents).toBe(cut(350_000))
    expect(h.otherPayCents).toBe(5_000)
    expect(h.reimbursementsCents).toBe(0)
    // NEGATIVE: the ledger's sign, as the line table stores it.
    expect(h.deductionsCents).toBe(-20_000)
    expect(h.netCents).toBe(nets(h))

    // ── A TRIP ADDED BY HAND IS PRICED, AND WRITTEN ONCE ─────────────────
    const third = await trip(driverId, 100_000)
    const added = await inOrg((tx) => addTripsToSettlement(tx, id, [third]))
    expect(added).toEqual({ ok: true, added: 1 })

    h = await header(id)
    const line = h.loadLines.find((l) => l.loadId === third)
    expect(line).toBeDefined()
    expect(line!.grossCents).toBe(100_000)
    expect(line!.amountCents).toBe(cut(100_000))
    expect(line!.amountCents).toBeLessThan(line!.grossCents)
    // THREE LOAD LINES NOW, AND STILL NO LOAD_PAY ROW ANYWHERE (migration 69).
    expect(h.loadLines).toHaveLength(3)
    expect(h.lines.filter((l) => l.type === 'LOAD_PAY')).toHaveLength(0)
    expect(h.lines.some((l) => l.loadId === third)).toBe(false)
    expect(h.grossCents).toBe(450_000)
    expect(h.earningsCents).toBe(cut(450_000))
    expect(h.netCents).toBe(nets(h))

    // ── THE DRIFT CHECKER AGREES WITH THE HEADER IT NOW DEFINES ──────────
    const drift = await inOrg((tx) => findSettlementDrift(tx))
    expect(drift.filter((row) => row.settlementId === id)).toEqual([])

    // ── AND THE SALARY REPORT NEEDS NO CASE TO READ IT ───────────────────
    const approved = await inOrg((tx) => approveSettlement(tx, id, userId))
    expect(approved.ok).toBe(true)
    const rows = await inOrg((tx) =>
      salaryByDriverWeek(tx, {
        from: WEEK.start,
        to: new Date(WEEK.end.getTime() + 86_399_999),
        companyId: null,
      }),
    )
    const mine = rows.filter((row) => row.driverId === driverId)
    expect(mine).toHaveLength(1)
    expect(mine[0]!.grossCents).toBe(h.earningsCents)
    expect(mine[0]!.deductionsCents).toBe(-20_000)
    expect(mine[0]!.otherPayCents).toBe(5_000)
    expect(mine[0]!.netCents).toBe(h.netCents)
  })

  it('refuses to add a trip for a driver with no usable rule, rather than pay the freight', async () => {
    const load = await trip(unruledDriverId, 90_000)
    // A statement for them has to exist to add to; the workbench's own
    // generator refuses first, so it is created directly in draft.
    const settlement = await owner.settlement.create({
      data: {
        organizationId,
        companyId,
        driverId: unruledDriverId,
        settlementNumber: `STL-WB-${nonce}`,
        periodStart: WEEK.start,
        periodEnd: WEEK.end,
        status: 'DRAFT',
      },
      select: { id: true },
    })
    const added = await inOrg((tx) =>
      addTripsToSettlement(tx, settlement.id, [load]),
    )
    expect(added.ok).toBe(false)
    if (added.ok) return
    expect(added.reason).toBe('no_pay_rule')
    const h = await header(settlement.id)
    expect(h.loadLines).toHaveLength(0)
    expect(h.lines).toHaveLength(0)
    expect(h.netCents).toBe(0)
  })
})
