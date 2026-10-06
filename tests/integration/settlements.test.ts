import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { transitionOperational } from '@/lib/load-status'
import { setLoadRate } from '@/lib/rates'
import { readyToInvoice } from '@/lib/invoices'
import { renderSettlementPdf } from '@/lib/settlement-pdf'
import { settlementPdfLines } from '@/lib/settlement-view'
import { closePayRule, saveDriverPayRule } from '@/lib/driver-pay'
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
async function deliveredLoad(
  linehaul: string,
  fuel: string,
  podOn: Date,
  /** Actual check-ins, when the trip finished with them recorded. */
  actuals: { pickup?: Date | null; delivery?: Date | null } = {},
  /** Whose load. Defaults to the file's shared driver. */
  forDriverId = driverId,
) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        driverId: forDriverId,
        stops: [
          {
            type: 'PICKUP',
            city: 'Chicago',
            state: 'IL',
            scheduledAt: new Date(podOn.getTime() - 86_400_000),
            arrivedAt: actuals.pickup ?? null,
          },
          {
            type: 'DELIVERY',
            city: 'Dallas',
            state: 'TX',
            scheduledAt: podOn,
            arrivedAt: actuals.delivery ?? null,
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

/**
 * The settlement's PDF, as text, for byte-comparison.
 *
 * The PDF rather than the row, because the document is what a driver holds and
 * "reproduces byte-identical" is a claim about the document.
 */
async function renderFor(settlementId: string): Promise<string> {
  const settlement = await owner.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: {
      settlementNumber: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      grossCents: true,
      deductionsCents: true,
      reimbursementsCents: true,
      netCents: true,
      company: { select: { name: true, dotNumber: true, mcNumber: true } },
      driver: { select: { firstName: true, lastName: true, phone: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          type: true,
          description: true,
          amountCents: true,
          payRuleSnapshot: true,
          load: { select: { loadNumber: true } },
        },
      },
    },
  })

  const day = (value: Date) => value.toISOString().slice(0, 10)
  // `status` is normalised out: the same settlement is DRAFT before approval
  // and APPROVED after, and the comparison here is of the money, not of where
  // it is in its lifecycle.
  return new TextDecoder().decode(
    renderSettlementPdf({
      settlementNumber: settlement.settlementNumber,
      periodStart: day(settlement.periodStart),
      periodEnd: day(settlement.periodEnd),
      carrier: {
        name: settlement.company.name,
        dotNumber: settlement.company.dotNumber,
        mcNumber: settlement.company.mcNumber,
      },
      driver: {
        name: `${settlement.driver.firstName} ${settlement.driver.lastName}`,
        phone: settlement.driver.phone,
      },
      lines: settlementPdfLines(settlement.lines),
      grossCents: settlement.grossCents,
      deductionsCents: settlement.deductionsCents,
      reimbursementsCents: settlement.reimbursementsCents,
      netCents: settlement.netCents,
      status: 'DRAFT',
      paidOn: null,
      paymentReference: null,
    }),
  )
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

describe("the driver's sheet dates, frozen on the line", () => {
  // ------------------------------------------------------------------------
  // THE RULING'S OWN GUARD: a line for a delivered load with actuals shows the
  // actual dates; one built from plan-only stops carries the marker.
  //
  // Read back from the COLUMNS after generation, because these are frozen at
  // generation like `payRuleSnapshot` — a later import that enriches the load
  // with actuals must not rewrite a cheque already handed over, and the only
  // way to see that promise kept is to look at what was stored.
  // ------------------------------------------------------------------------
  // A WEEK OF ITS OWN. These tests GENERATE settlements, and a settled load
  // stops being settleable — run against the shared week they would consume
  // the loads the other tests in this file are asserting about, and five of
  // them turned red the first time. The period is later than WEEK_END and
  // inside the same pay rule, so the arithmetic is unchanged.
  const SHEET_START = new Date(Date.UTC(2026, 7, 24))
  const SHEET_END = new Date(Date.UTC(2026, 7, 30, 23, 59, 59, 999))
  const POD_ON = new Date(Date.UTC(2026, 7, 26, 18, 0, 0))

  const PU_ACTUAL = new Date('2026-08-25T12:17:00Z')
  const DEL_ACTUAL = new Date('2026-08-26T13:20:00Z')

  // ITS OWN DRIVER, not merely its own week.
  //
  // Two cheaper isolations were tried and both broke this file. Sharing the
  // driver but using a later period made these tests CONSUME loads the other
  // tests assert about — five failures. Adding a pay rule for the shared
  // driver then collided with the tests that assert on rule overlap and on
  // `no_rule` — six failures. The tests in this file are deliberately coupled
  // to one driver's state; a new fact about that driver is a new fact for all
  // of them. A separate driver touches nothing.
  let sheetDriverId = ''

  beforeAll(async () => {
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'Dilshod',
        lastName: `Nazarov ${nonce}`,
      },
    })
    sheetDriverId = driver.id
    await inOrg((tx) =>
      saveDriverPayRule(tx, sheetDriverId, {
        type: 'PERCENT_GROSS',
        percentBps: 3000,
        effectiveFrom: SHEET_START,
      }),
    )
  }, 300_000)

  const lineFor = async (settlementId: string) => {
    const rows = await inOrg((tx) =>
      tx.settlementLine.findMany({
        where: { settlementId, type: 'LOAD_PAY' },
        select: {
          puAt: true,
          delAt: true,
          puActual: true,
          delActual: true,
        },
      }),
    )
    return rows[0]!
  }

  const settle = async () => {
    const outcome = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId: sheetDriverId,
        periodStart: SHEET_START,
        periodEnd: SHEET_END,
        labels,
      }),
    )
    if (!outcome.ok) throw new Error(`settlement refused: ${outcome.reason}`)
    return outcome.settlementId
  }

  it('freezes the actual check-ins when the trip recorded them', async () => {
    await deliveredLoad(
      '2000.00',
      '0',
      POD_ON,
      { pickup: PU_ACTUAL, delivery: DEL_ACTUAL },
      sheetDriverId,
    )

    const line = await lineFor(await settle())
    expect(line.puActual).toBe(true)
    expect(line.delActual).toBe(true)
    expect(line.puAt?.toISOString()).toBe(PU_ACTUAL.toISOString())
    expect(line.delAt?.toISOString()).toBe(DEL_ACTUAL.toISOString())
  })

  it('falls back to the plan and marks it when no arrival was recorded', async () => {
    await deliveredLoad('2000.00', '0', POD_ON, {}, sheetDriverId)

    const line = await lineFor(await settle())
    expect(line.puActual).toBe(false)
    expect(line.delActual).toBe(false)
    // The plan is still carried — a blank date would be worse than a marked
    // one, because the driver could not check it against anything.
    expect(line.puAt).not.toBeNull()
    expect(line.delAt?.toISOString()).toBe(POD_ON.toISOString())
  })

  it('marks only the stop that was missed', async () => {
    await deliveredLoad(
      '2000.00',
      '0',
      POD_ON,
      { pickup: PU_ACTUAL },
      sheetDriverId,
    )

    const line = await lineFor(await settle())
    expect(line.puActual).toBe(true)
    expect(line.delActual).toBe(false)
  })
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
    expect(outcome.earningsCents).toBe(141900)
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
    expect(outcome.earningsCents).toBe(90000)

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
        earningsCents: true,
        otherPayCents: true,
        deductionsCents: true,
        reimbursementsCents: true,
        netCents: true,
        lines: {
          where: { type: 'DEDUCTION_FUEL' },
          select: { amountCents: true },
        },
      },
    })
    // THE LINE AND THE COLUMN AGREE ON THE SIGN (§6.2.2, migration 67): a
    // deduction is negative wherever it is stored. Gross is the FREIGHT the 30%
    // was taken of — $3,000.00 — and the driver's cut sits under earnings.
    // 90000 + 12000 - 25000 = 77000.
    expect(stored?.lines[0]?.amountCents).toBe(-25000)
    expect(stored).toMatchObject({
      grossCents: 300000,
      earningsCents: 90000,
      otherPayCents: 12000,
      deductionsCents: -25000,
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
    expect(first).toMatchObject({ ok: true, earningsCents: 60000 })
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
      // EARNINGS, the driver's cut — `grossCents` is the freight since 67.
      select: { earningsCents: true },
    })
    expect(untouched?.earningsCents).toBe(60000)

    // And REGENERATING the same week reproduces it exactly, because the rule
    // in force in October is still the 30% one.
    await inOrg((tx) => voidSettlement(tx, first.settlementId))
    const second = await inOrg((tx) =>
      generateSettlement(tx, organizationId, { driverId, ...period, labels }),
    )
    expect(second).toMatchObject({ ok: true, earningsCents: 60000 })
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

describe('§7: a mixed-rule week, and Relay revenue', () => {
  // The acceptance box, as written: "A weekly settlement for a mixed-rule
  // driver reproduces byte-identical on regeneration; a pay-rule change after
  // approval changes nothing retroactively."
  //
  // BYTE-IDENTICAL is asserted on the PDF, because that is the artefact a
  // driver holds. Two generations differ in id and timestamps and must — what
  // has to match is the document.
  it('reproduces the PDF byte for byte after the rule changes', async () => {
    const mixed = await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'Mixed',
        lastName: `Rule ${nonce}`,
      },
    })

    // MIXED-RULE: per-mile through November, percent-of-linehaul from
    // December. The loads below sit under the per-mile rule; the December rule
    // exists to be the thing that must not reach back.
    expect(
      await inOrg((tx) =>
        saveDriverPayRule(tx, mixed.id, {
          type: 'PER_MILE',
          perMileCents: 58,
          effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
          effectiveTo: new Date(Date.UTC(2026, 10, 30)),
        }),
      ),
    ).toMatchObject({ ok: true })
    expect(
      await inOrg((tx) =>
        saveDriverPayRule(tx, mixed.id, {
          type: 'PERCENT_LINEHAUL',
          percentBps: 3200,
          effectiveFrom: new Date(Date.UTC(2026, 11, 1)),
        }),
      ),
    ).toMatchObject({ ok: true })

    const period = {
      periodStart: new Date(Date.UTC(2026, 10, 2)),
      periodEnd: new Date(Date.UTC(2026, 10, 8, 23, 59, 59, 999)),
    }

    for (const [linehaul, miles, dayOfMonth] of [
      ['2450', 1240, 3],
      ['1900', 860, 5],
    ] as const) {
      const load = await inOrg((tx) =>
        createLoad(
          tx,
          organizationId,
          {
            companyId,
            customerId: brokerId,
            driverId: mixed.id,
            stops: [
              {
                type: 'PICKUP',
                city: 'Chicago',
                state: 'IL',
                scheduledAt: new Date(Date.UTC(2026, 10, dayOfMonth - 1)),
              },
              {
                type: 'DELIVERY',
                city: 'Dallas',
                state: 'TX',
                scheduledAt: new Date(Date.UTC(2026, 10, dayOfMonth)),
              },
            ],
          },
          { byUserId: userId },
        ),
      )
      await owner.load.update({
        where: { id: load.id },
        data: { actualMiles: miles },
      })
      await inOrg((tx) =>
        setLoadRate(tx, load.id, { linehaul, fuelSurcharge: '380' }),
      )
      await inOrg((tx) =>
        transitionOperational(tx, load.id, 'POD_RECEIVED', {
          source: 'AUTOMATIC',
          userId,
          occurredAt: new Date(Date.UTC(2026, 10, dayOfMonth)),
        }),
      )
    }

    const first = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId: mixed.id,
        ...period,
        labels,
      }),
    )
    // 1240 x $0.58 = $719.20 and 860 x $0.58 = $498.80, so $1,218.00 —
    // per-mile, NOT the 32% of linehaul that December's rule would give.
    expect(first).toMatchObject({ ok: true, earningsCents: 121800 })
    if (!first.ok) return

    const before = await renderFor(first.settlementId)

    // Approve it, then give the driver a raise — the way a raise is actually
    // recorded: close the rule that is open and open a new one after it. The
    // November rule is untouched, which is the whole point of rules being a
    // history rather than a setting.
    await inOrg((tx) => approveSettlement(tx, first.settlementId, userId))
    const december = await owner.driverPayRule.findFirst({
      where: { driverId: mixed.id, type: 'PERCENT_LINEHAUL' },
      select: { id: true },
    })
    await inOrg((tx) =>
      closePayRule(tx, december!.id, new Date(Date.UTC(2026, 11, 31))),
    )
    expect(
      await inOrg((tx) =>
        saveDriverPayRule(tx, mixed.id, {
          type: 'PER_MILE',
          perMileCents: 75,
          effectiveFrom: new Date(Date.UTC(2027, 0, 1)),
        }),
      ),
    ).toMatchObject({ ok: true })

    // NOTHING RETROACTIVE. Same document, byte for byte, after the raise.
    expect(await renderFor(first.settlementId)).toBe(before)

    // And a REGENERATION — a different row, built from scratch — produces the
    // same document, because `ruleInForce` asks which rule covered the day the
    // load ran and that answer has not changed.
    await owner.settlement.update({
      where: { id: first.settlementId },
      data: { status: 'DRAFT' },
    })
    await inOrg((tx) => voidSettlement(tx, first.settlementId))

    const second = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId: mixed.id,
        ...period,
        labels,
      }),
    )
    expect(second).toMatchObject({ ok: true, earningsCents: 121800 })
    if (!second.ok) return
    expect(second.settlementId).not.toBe(first.settlementId)

    // The NUMBER differs — a new document gets a new number and the series
    // stays contiguous — so that one field is normalised and everything else
    // has to match exactly.
    const regenerated = await renderFor(second.settlementId)
    expect(regenerated.split(second.settlementNumber).join('STL-X')).toBe(
      before.split(first.settlementNumber).join('STL-X'),
    )

    // WHAT THIS DOES NOT CLAIM, measured rather than assumed. Rewriting the
    // November rule IN PLACE — which no screen can do, only a hand-edit —
    // leaves the approved document alone, because every line carries its own
    // snapshot. A regeneration after that edit does NOT reproduce: it reads
    // 2100 miles at the new 75c and comes to $1,575.00, because the question
    // "what rule covered that day" now has a different answer. That is the
    // correction somebody made, not a bug — and it is exactly the class of
    // hand-edit `findSettlementDrift` catches on the stored settlement.
    const november = await owner.driverPayRule.findFirst({
      where: { driverId: mixed.id, effectiveTo: { not: null } },
      orderBy: { effectiveFrom: 'asc' },
      select: { id: true },
    })
    await owner.driverPayRule.update({
      where: { id: november!.id },
      data: { perMileCents: 75 },
    })

    expect(await renderFor(second.settlementId)).toBe(regenerated)

    await owner.settlement.update({
      where: { id: second.settlementId },
      data: { status: 'DRAFT' },
    })
    await inOrg((tx) => voidSettlement(tx, second.settlementId))
    const third = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId: mixed.id,
        ...period,
        labels,
      }),
    )
    expect(third).toMatchObject({ ok: true, earningsCents: 157500 })
  }, 300_000)

  it('pays a Relay load in the settlement it never invoices', async () => {
    // §7: "Relay load never appears in ready-to-invoice or broker AR; its
    // revenue appears in settlement and profitability." The first half is
    // asserted in the invoice and payment suites; this is the second.
    const relay = await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Relay ${nonce}` }),
    )
    await owner.customer.update({
      where: { id: relay.id },
      data: { settlesDirectly: true },
    })

    const load = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId,
          customerId: relay.id,
          driverId,
          stops: [
            {
              type: 'PICKUP',
              city: 'Chicago',
              state: 'IL',
              scheduledAt: new Date(Date.UTC(2026, 11, 7)),
            },
            {
              type: 'DELIVERY',
              city: 'Dallas',
              state: 'TX',
              scheduledAt: new Date(Date.UTC(2026, 11, 8)),
            },
          ],
        },
        { byUserId: userId },
      ),
    )
    // Copied at booking from the customer, never re-read.
    expect(load.directSettled).toBe(true)

    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '1500', fuelSurcharge: '0' }),
    )
    await inOrg((tx) =>
      transitionOperational(tx, load.id, 'POD_RECEIVED', {
        source: 'AUTOMATIC',
        userId,
        occurredAt: new Date(Date.UTC(2026, 11, 8)),
      }),
    )

    // NOT in the invoice queue — it never becomes an invoice.
    expect(
      (await inOrg((tx) => readyToInvoice(tx))).map((row) => row.id),
    ).not.toContain(load.id)

    // But the driver hauled it, so it IS in the settlement: 30% of $1,500.00.
    const outcome = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId,
        periodStart: new Date(Date.UTC(2026, 11, 7)),
        periodEnd: new Date(Date.UTC(2026, 11, 13, 23, 59, 59, 999)),
        labels,
      }),
    )
    expect(outcome).toMatchObject({ ok: true, earningsCents: 45000 })
    if (!outcome.ok) return

    const line = await owner.settlementLine.findFirst({
      where: { settlementId: outcome.settlementId, loadId: load.id },
      select: { amountCents: true },
    })
    expect(line?.amountCents).toBe(45000)
  }, 300_000)
})

// ---------------------------------------------------------------------------
// A LOAD WITH NO DRIVER MUST NEVER REACH A SETTLEMENT — STATED, NOT ASSUMED.
//
// This has always been true and NOTHING SAID SO. `settleableWhere` filters on
// `driverId` as an equality, so a null-driver load matches no driver's query:
// it is never refused, it is simply never found. Correct behaviour, arrived at
// by accident, and one refactor from being ungated — a `driverId` clause
// rewritten as optional, or a query that ORs in unassigned freight "so nothing
// gets lost", would open it with every existing test still green.
//
// The failure it protects against is the expensive direction. Paying the wrong
// driver is loud and gets corrected; the load simply never appearing is what
// happened on production loads 1015 and 1016, where $2,703.58 of finished
// freight sat attached to nobody and nothing said a word.
//
// SO THE RULE IS ASSERTED FROM BOTH ENDS: the load is absent from the
// settleable set, and generating the week does not put it on a sheet.
// ---------------------------------------------------------------------------
describe('freight nobody drove', () => {
  it('is invisible to settlement, and to every driver', async () => {
    const orphan = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId,
          customerId: brokerId,
          // The whole point: no driverId at all.
          stops: [
            {
              type: 'PICKUP',
              city: 'Chicago',
              state: 'IL',
              scheduledAt: new Date(Date.UTC(2026, 6, 28)),
            },
            {
              type: 'DELIVERY',
              city: 'Dallas',
              state: 'TX',
              scheduledAt: new Date(Date.UTC(2026, 6, 29)),
            },
          ],
          linehaulCents: 250_000,
        },
        { byUserId: userId },
      ),
    )

    // It reaches POD_RECEIVED exactly like assigned freight does — that is the
    // point of the 2026-09-06 ruling: the POD is a fact and gets recorded.
    // The same call the rest of this file uses to finish a load.
    await inOrg((tx) =>
      transitionOperational(tx, orphan.id, 'POD_RECEIVED', {
        source: 'AUTOMATIC',
        userId,
        // INSIDE THE WEEK, and this line is the test. The first version put
        // the POD on 2026-08-05, outside WEEK_START..WEEK_END, so the load was
        // excluded by DATE and the assertion passed without ever exercising
        // the driver filter — proven by opening the gate and watching it still
        // pass. A guard that cannot fail is not a guard.
        occurredAt: new Date(Date.UTC(2026, 6, 30)),
      }),
    )

    const load = await inOrg((tx) =>
      tx.load.findFirstOrThrow({
        where: { id: orphan.id },
        select: { operationalStatus: true, driverId: true },
      }),
    )
    expect(load.operationalStatus).toBe('POD_RECEIVED')
    expect(load.driverId).toBeNull()

    // AND YET IT IS SETTLEABLE FOR NOBODY. Asked for the file's own driver,
    // who is the only driver in this organisation.
    const settleable = await inOrg((tx) =>
      settleableLoads(tx, driverId, WEEK_START, WEEK_END),
    )
    expect(settleable.map((row) => row.id)).not.toContain(orphan.id)

    // And generating the week does not sweep it up.
    const outcome = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId,
        periodStart: WEEK_START,
        periodEnd: WEEK_END,
        labels,
      }),
    )
    if (outcome.ok) {
      // Whatever the week did contain, it did not contain this.
      const lines = await inOrg((tx) =>
        tx.settlementLine.findMany({
          where: { settlementId: outcome.settlementId },
          select: { loadId: true },
        }),
      )
      expect(lines.map((line) => line.loadId)).not.toContain(orphan.id)
    }
  })
})

// ---------------------------------------------------------------------------
// FREIGHT DATATRUCK ALREADY SETTLED MUST NEVER BE SETTLED AGAIN HERE.
//
// ── THE HOLE THIS CLOSES WAS OPEN, NOT THEORETICAL ───────────────────────
//
// `settleableWhere` asked for POD_RECEIVED, unsettled, in the period, and
// nothing else. An imported load is POD_RECEIVED, and it is "unsettled" here
// by construction — no settlement of ours has ever touched it — so the next
// settlement run for that driver would have picked it up and paid a driver a
// second time for freight another system already paid them for.
//
// Nothing had gone wrong only because no settlement has yet been run against
// imported freight. That is a coincidence and not a rule, and the import's own
// ruling was explicit: no historical driver pay, no historical settlements.
//
// The owner's ruling of 2026-09-10 made it a definition rather than a clause:
// a settleable load excludes imported closed-in-Datatruck history, and
// `SETTLEABLE_LOAD` is the single place that says so — spread by
// `settleableWhere` here and imported by the drivers seed's date guard, so the
// guard and the engine cannot come to disagree about who gets paid.
//
// ── BOTH BRANCHES ARE WATCHED ────────────────────────────────────────────
//
// The load is built IDENTICALLY to a settleable one and settled in the same
// week — same driver, same POD date, same money — so the ONLY difference is
// the billing status. Then the status is moved off CLOSED_IN_DATATRUCK and the
// same query is asked again, and the load appears. A guard that has never been
// watched failing is not known to work, and a test that only ever sees the
// closed case would pass just as happily against a query that returns nothing.
// ---------------------------------------------------------------------------
describe('freight another system already settled', () => {
  it('is invisible while it is closed, and visible the moment it is not', async () => {
    const imported = await inOrg((tx) =>
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
              scheduledAt: new Date(Date.UTC(2026, 6, 28)),
            },
            {
              type: 'DELIVERY',
              city: 'Dallas',
              state: 'TX',
              scheduledAt: new Date(Date.UTC(2026, 6, 29)),
            },
          ],
          linehaulCents: 175_215,
        },
        { byUserId: userId },
      ),
    )

    await inOrg((tx) =>
      transitionOperational(tx, imported.id, 'POD_RECEIVED', {
        source: 'AUTOMATIC',
        userId,
        // INSIDE THE WEEK, for the reason the test above records at length: a
        // load excluded by DATE would pass this assertion without ever
        // exercising the billing filter.
        occurredAt: new Date(Date.UTC(2026, 6, 30)),
      }),
    )

    // CLOSED IN DATATRUCK, written directly. `billingStatusFor` does not own
    // this status — it is one of the DECIDED set — so the import sets it and
    // neither the writer nor the drift check moves it.
    await inOrg((tx) =>
      tx.load.update({
        where: { id: imported.id },
        data: { billingStatus: 'CLOSED_IN_DATATRUCK', externalId: 'DT-016006' },
      }),
    )

    const closed = await inOrg((tx) =>
      settleableLoads(tx, driverId, WEEK_START, WEEK_END),
    )
    expect(closed.map((row) => row.id)).not.toContain(imported.id)

    // And the week does not sweep it up either.
    const outcome = await inOrg((tx) =>
      generateSettlement(tx, organizationId, {
        driverId,
        periodStart: WEEK_START,
        periodEnd: WEEK_END,
        labels,
      }),
    )
    if (outcome.ok) {
      const lines = await inOrg((tx) =>
        tx.settlementLine.findMany({
          where: { settlementId: outcome.settlementId },
          select: { loadId: true },
        }),
      )
      expect(lines.map((line) => line.loadId)).not.toContain(imported.id)
      // The settlement that was just generated must not hold this load, and it
      // is removed so the second half of the test starts from where the first
      // half did rather than from "already on a sheet".
      await inOrg((tx) => voidSettlement(tx, outcome.settlementId))
    }

    // ── THE OTHER BRANCH ────────────────────────────────────────────────
    //
    // Reopened — which is exactly what the billing axis is for: a load
    // somebody legitimately takes back off Datatruck's books becomes this
    // system's responsibility again. Nothing else about the row changes.
    await inOrg((tx) =>
      tx.load.update({
        where: { id: imported.id },
        data: { billingStatus: 'UNINVOICED' },
      }),
    )

    const reopened = await inOrg((tx) =>
      settleableLoads(tx, driverId, WEEK_START, WEEK_END),
    )
    expect(reopened.map((row) => row.id)).toContain(imported.id)
  }, 300_000)
})
