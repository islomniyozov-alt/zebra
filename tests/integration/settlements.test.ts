import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { transitionOperational } from '@/lib/load-status'
import { setLoadRate } from '@/lib/rates'
import { saveDriverPayRule } from '@/lib/driver-pay'
import {
  addSettlementLine,
  approveSettlement,
  findSettlementDrift,
  generateSettlement,
  markSettlementPaid,
  settleableLoads,
  voidSettlement,
} from '@/lib/settlements'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Weekly settlements, against real Postgres.
//
// The pay arithmetic is covered in tests/driver-pay.test.ts. What can only be
// asserted here:
//
//   * the period really picks up the right loads and no others
//   * a load really cannot reach two settlements
//   * approve really freezes it, and paid really freezes it harder
//   * the SAME settlement regenerated after a raise reproduces the OLD figures
//   * a rule change after the fact really does not rewrite what was paid
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let driverId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'settlements.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

const labels = { loadPay: (loadNumber: string) => `Load pay ${loadNumber}` }

/** The settlement week these tests use: 27 Jul – 2 Aug 2026. */
const WEEK_START = new Date(Date.UTC(2026, 6, 27))
const WEEK_END = new Date(Date.UTC(2026, 7, 2, 23, 59, 59, 999))

/**
 * A load at POD received, with the POD event stamped on a chosen day.
 *
 * The period is keyed on the POD status event (see settleableWhere), so the
 * fixture has to control that timestamp rather than the booking date.
 */
async function deliveredLoad(linehaul: string, fuel: string, podOn: Date) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        driverId,
        stops: [
          {
            type: 'PICKUP',
            city: 'Chicago',
            state: 'IL',
            scheduledAt: new Date(podOn.getTime() - 86_400_000),
          },
          {
            type: 'DELIVERY',
            city: 'Dallas',
            state: 'TX',
            scheduledAt: podOn,
          },
        ],
      },
      { byUserId: userId },
    ),
  )

  await inOrg((tx) =>
    setLoadRate(tx, load.id, { linehaul, fuelSurcharge: fuel }),
  )
  await inOrg((tx) =>
    transitionOperational(tx, load.id, 'POD_RECEIVED', {
      source: 'AUTOMATIC',
      userId,
      occurredAt: podOn,
    }),
  )
  return load
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Settlements ${nonce}`,
      slug: `settlements-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: {
      email: `settlements-${nonce}@example.test`,
      name: 'Settlement Tester',
    },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Broker ${nonce}` }),
    )
  ).id

  const driver = await owner.driver.create({
    data: {
      organizationId,
      companyId,
      firstName: 'Ahmad',
      lastName: `Karimov ${nonce}`,
    },
  })
  driverId = driver.id
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('the pay rule on file', () => {
  it('refuses a rule that overlaps one already there', async () => {
    const first = await inOrg((tx) =>
      saveDriverPayRule(tx, driverId, {
        type: 'PERCENT_GROSS',
        percentBps: 3000,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      }),
    )
    expect(first).toMatchObject({ ok: true })

    // Two rules in force on the same day means the pay for that day depends on
    // which row is read first, and the driver finds out on Friday.
    const clash = await inOrg((tx) =>
      saveDriverPayRule(tx, driverId, {
        type: 'PERCENT_LINEHAUL',
        percentBps: 3200,
        effectiveFrom: new Date(Date.UTC(2026, 5, 1)),
      }),
    )
    expect(clash).toMatchObject({ ok: false, reason: 'overlaps' })
  }, 300_000)

  it('refuses CUSTOM before it reaches the database', async () => {
    expect(
      await inOrg((tx) =>
        saveDriverPayRule(tx, driverId, {
          type: 'CUSTOM',
          effectiveFrom: new Date(Date.UTC(2030, 0, 1)),
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'custom_unsupported' })

    expect(
      await owner.driverPayRule.count({ where: { driverId, type: 'CUSTOM' } }),
    ).toBe(0)
  }, 300_000)
})

describe('generating the week', () => {
  it('covers the loads whose POD landed in the period, and no others', async () => {
    // Two inside the week, one the week before, one the week after.
    const inside = await deliveredLoad(
      '2450',
      '380',
      new Date(Date.UTC(2026, 6, 28)),
    )
    const alsoInside = await deliveredLoad(
      '1900',
      '0',
      new Date(Date.UTC(2026, 7, 1)),
    )
    const before = await deliveredLoad(
      '999',
      '0',
      new Date(Date.UTC(2026, 6, 20)),
    )
    const after = await deliveredLoad(
      '888',
      '0',
      new Date(Date.UTC(2026, 7, 9)),
    )

    const settleable = await inOrg((tx) =>
      settleableLoads(tx, driverId, WEEK_START, WEEK_END),
    )
    expect(settleable.map((load) => load.id).sort()).toEqual(
      [inside.id, alsoInside.id].sort(),
    )
    expect(settleable.map((load) => load.id)).not.toContain(before.id)
    expect(settleable.map((load) => load.id)).not.toContain(after.id)

    const outcome = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId,
        periodStart: WEEK_START,
        periodEnd: WEEK_END,
        labels,
      }),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // 30% of ($2,830.00 + $1,900.00) = 30% of $4,730.00 = $1,419.00.
    // Per load: 84900 and 57000, which sum to 141900.
    expect(outcome.grossCents).toBe(141900)
    expect(outcome.loadCount).toBe(2)
    expect(outcome.settlementNumber).toMatch(/^STL-\d+$/)

    const lines = await owner.settlementLine.findMany({
      where: { settlementId: outcome.settlementId },
      orderBy: { sortOrder: 'asc' },
      select: { loadId: true, amountCents: true, payRuleSnapshot: true },
    })
    expect(lines.map((line) => line.amountCents)).toEqual([84900, 57000])
    // EVERY LINE CARRIES ITS SNAPSHOT. Without it the figure cannot be
    // reproduced once the rule changes.
    expect(lines.every((line) => line.payRuleSnapshot !== null)).toBe(true)
  }, 300_000)

  it('will not put one load on two settlements', async () => {
    // The same period again. Everything it covered is now taken.
    const again = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId,
        periodStart: WEEK_START,
        periodEnd: WEEK_END,
        labels,
      }),
    )
    expect(again).toMatchObject({ ok: false, reason: 'no_loads' })
  }, 300_000)

  it('refuses the whole settlement when one load has no rule', async () => {
    // A settlement that quietly omits the load whose rule was missing is a
    // short cheque with no explanation, and the driver finds the gap first.
    const orphan = await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'No',
        lastName: `Rule ${nonce}`,
      },
    })
    const load = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId,
          customerId: brokerId,
          driverId: orphan.id,
          stops: [
            {
              type: 'PICKUP',
              city: 'Chicago',
              state: 'IL',
              scheduledAt: new Date(Date.UTC(2026, 6, 29)),
            },
            {
              type: 'DELIVERY',
              city: 'Dallas',
              state: 'TX',
              scheduledAt: new Date(Date.UTC(2026, 6, 30)),
            },
          ],
        },
        { byUserId: userId },
      ),
    )
    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '1000', fuelSurcharge: '0' }),
    )
    await inOrg((tx) =>
      transitionOperational(tx, load.id, 'POD_RECEIVED', {
        source: 'AUTOMATIC',
        userId,
        occurredAt: new Date(Date.UTC(2026, 6, 30)),
      }),
    )

    const outcome = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId: orphan.id,
        periodStart: WEEK_START,
        periodEnd: WEEK_END,
        labels,
      }),
    )
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'no_rule',
      loadNumbers: [load.loadNumber],
    })
    expect(
      await owner.settlement.count({ where: { driverId: orphan.id } }),
    ).toBe(0)
  }, 300_000)
})

describe('deductions, approval and payment', () => {
  let settlementId = ''

  it('signs a deduction from its type, not from how it was typed', async () => {
    // 10-16 August, NOT 3-16: the previous test left a load PODed on the 9th
    // deliberately outside its own week, and a wider window here swept it in
    // — the first run of this test read $1,166.40 instead of $900.00. The
    // period filter was right; the fixture's window was wrong.
    const load = await deliveredLoad(
      '3000',
      '0',
      new Date(Date.UTC(2026, 7, 10)),
    )
    const outcome = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId,
        periodStart: new Date(Date.UTC(2026, 7, 10)),
        periodEnd: new Date(Date.UTC(2026, 7, 16, 23, 59, 59, 999)),
        labels,
      }),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    settlementId = outcome.settlementId
    expect(load).toBeTruthy()

    // 30% of $3,000.00 = $900.00.
    expect(outcome.grossCents).toBe(90000)

    // POSITIVE as typed, negative once stored.
    const deduction = await inOrg((tx) =>
      addSettlementLine(tx, settlementId, {
        type: 'DEDUCTION_FUEL',
        description: 'Fuel advance',
        amountCents: 25000,
      }),
    )
    expect(deduction).toMatchObject({ ok: true, netCents: 65000 })

    const reimbursement = await inOrg((tx) =>
      addSettlementLine(tx, settlementId, {
        type: 'REIMBURSEMENT',
        description: 'Lumper',
        amountCents: 12000,
      }),
    )
    expect(reimbursement).toMatchObject({ ok: true, netCents: 77000 })

    const stored = await owner.settlement.findUnique({
      where: { id: settlementId },
      select: {
        grossCents: true,
        deductionsCents: true,
        reimbursementsCents: true,
        netCents: true,
        lines: {
          where: { type: 'DEDUCTION_FUEL' },
          select: { amountCents: true },
        },
      },
    })
    // The LINE is negative; the deductions COLUMN is positive. 90000 + 12000
    // - 25000 = 77000.
    expect(stored?.lines[0]?.amountCents).toBe(-25000)
    expect(stored).toMatchObject({
      grossCents: 90000,
      deductionsCents: 25000,
      reimbursementsCents: 12000,
      netCents: 77000,
    })
  }, 300_000)

  it('freezes on approval, and cannot be paid before it', async () => {
    expect(
      await inOrg((tx) =>
        markSettlementPaid(tx, settlementId, {
          method: 'ACH',
          reference: 'early',
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'not_approved' })

    expect(
      await inOrg((tx) => approveSettlement(tx, settlementId, userId)),
    ).toMatchObject({ ok: true, status: 'APPROVED' })

    // A settlement a driver has been shown does not gain a deduction after.
    expect(
      await inOrg((tx) =>
        addSettlementLine(tx, settlementId, {
          type: 'DEDUCTION_OTHER',
          description: 'Afterthought',
          amountCents: 5000,
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'not_draft' })
  }, 300_000)

  it('records how it was paid, and refuses a payment with no reference', async () => {
    expect(
      await inOrg((tx) =>
        markSettlementPaid(tx, settlementId, {
          method: 'ACH',
          reference: '  ',
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'no_reference' })

    expect(
      await inOrg((tx) =>
        markSettlementPaid(tx, settlementId, {
          method: 'ACH',
          reference: `ACH-${nonce}`,
        }),
      ),
    ).toMatchObject({ ok: true, status: 'PAID' })

    const paid = await owner.settlement.findUnique({
      where: { id: settlementId },
      select: { status: true, paidAt: true, paymentReference: true },
    })
    expect(paid?.status).toBe('PAID')
    expect(paid?.paidAt).toBeInstanceOf(Date)
    expect(paid?.paymentReference).toBe(`ACH-${nonce}`)

    // And a paid settlement cannot be voided out from under the payment.
    expect(await inOrg((tx) => voidSettlement(tx, settlementId))).toMatchObject(
      {
        ok: false,
        reason: 'already_paid',
      },
    )
  }, 300_000)

  it('refuses to approve a settlement the deductions have swallowed', async () => {
    const load = await deliveredLoad('500', '0', new Date(Date.UTC(2026, 8, 7)))
    const outcome = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId,
        periodStart: new Date(Date.UTC(2026, 8, 1)),
        periodEnd: new Date(Date.UTC(2026, 8, 13, 23, 59, 59, 999)),
        labels,
      }),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(load).toBeTruthy()

    // 30% of $500.00 = $150.00, against a $200.00 advance.
    await inOrg((tx) =>
      addSettlementLine(tx, outcome.settlementId, {
        type: 'DEDUCTION_ADVANCE',
        description: 'Advance',
        amountCents: 20000,
      }),
    )
    expect(
      await inOrg((tx) => approveSettlement(tx, outcome.settlementId, userId)),
    ).toMatchObject({ ok: false, reason: 'negative_net' })

    // Voiding releases the load, so a corrected settlement can be generated.
    expect(
      await inOrg((tx) => voidSettlement(tx, outcome.settlementId)),
    ).toMatchObject({ ok: true, status: 'VOID' })

    const released = await inOrg((tx) =>
      settleableLoads(
        tx,
        driverId,
        new Date(Date.UTC(2026, 8, 1)),
        new Date(Date.UTC(2026, 8, 13, 23, 59, 59, 999)),
      ),
    )
    expect(released.map((row) => row.id)).toContain(load.id)
  }, 300_000)
})

describe('a raise does not rewrite what was already paid', () => {
  it('regenerates the same figures after the rule changes', async () => {
    // THE CLAIM THE WHOLE SNAPSHOT MACHINERY EXISTS FOR.
    const load = await deliveredLoad(
      '2000',
      '0',
      new Date(Date.UTC(2026, 9, 6)),
    )
    const period = {
      periodStart: new Date(Date.UTC(2026, 9, 5)),
      periodEnd: new Date(Date.UTC(2026, 9, 11, 23, 59, 59, 999)),
    }

    const first = await inOrg((tx) =>
      generateSettlement(tx, organizationId, { driverId, ...period, labels }),
    )
    expect(first).toMatchObject({ ok: true, grossCents: 60000 })
    if (!first.ok) return

    // The driver gets a raise, effective the following January. The rule in
    // force in OCTOBER is untouched, which is the point — closing the old one
    // and opening a new one is how a raise is recorded.
    const open = await owner.driverPayRule.findFirst({
      where: { driverId, effectiveTo: null },
      select: { id: true },
    })
    await owner.driverPayRule.update({
      where: { id: open!.id },
      data: { effectiveTo: new Date(Date.UTC(2026, 11, 31)) },
    })
    const raise = await inOrg((tx) =>
      saveDriverPayRule(tx, driverId, {
        type: 'PERCENT_GROSS',
        percentBps: 3500,
        effectiveFrom: new Date(Date.UTC(2027, 0, 1)),
      }),
    )
    expect(raise).toMatchObject({ ok: true })

    // The old settlement is untouched by a rule it never referenced.
    const untouched = await owner.settlement.findUnique({
      where: { id: first.settlementId },
      select: { grossCents: true },
    })
    expect(untouched?.grossCents).toBe(60000)

    // And REGENERATING the same week reproduces it exactly, because the rule
    // in force in October is still the 30% one.
    await inOrg((tx) => voidSettlement(tx, first.settlementId))
    const second = await inOrg((tx) =>
      generateSettlement(tx, organizationId, { driverId, ...period, labels }),
    )
    expect(second).toMatchObject({ ok: true, grossCents: 60000 })
    if (!second.ok) return
    expect(second.settlementId).not.toBe(first.settlementId)
    expect(load).toBeTruthy()
  }, 300_000)
})

describe('the drift check', () => {
  it('is silent over everything this suite generated', async () => {
    expect(await inOrg((tx) => findSettlementDrift(tx))).toEqual([])
  }, 300_000)

  it('finds a line somebody edited away from its snapshot', async () => {
    const line = await owner.settlementLine.findFirst({
      where: { type: 'LOAD_PAY', organizationId },
      select: { id: true, amountCents: true, settlementId: true },
    })
    expect(line).not.toBeNull()

    // One cent, by hand. The smallest edit that makes a settlement stop
    // reproducing, and one nothing else would ever report.
    await owner.settlementLine.update({
      where: { id: line!.id },
      data: { amountCents: line!.amountCents - 1 },
    })

    const drift = await inOrg((tx) => findSettlementDrift(tx))
    // Two problems from one edit: the line no longer matches its snapshot, and
    // the settlement's totals no longer add up from its lines.
    expect(drift.length).toBeGreaterThanOrEqual(1)
    expect(
      drift.some((row) => row.problem === 'line_disagrees_with_snapshot'),
    ).toBe(true)
    expect(
      drift.some((row) => row.problem === 'totals_disagree_with_lines'),
    ).toBe(true)

    await owner.settlementLine.update({
      where: { id: line!.id },
      data: { amountCents: line!.amountCents },
    })
    expect(await inOrg((tx) => findSettlementDrift(tx))).toEqual([])
  }, 300_000)
})
