import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createDriver, createTruck } from '@/lib/fleet'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { transitionOperational } from '@/lib/load-status'
import { setLoadRate } from '@/lib/rates'
import { generateInvoice, markInvoiceSent } from '@/lib/invoices'
import { markFactored, saveFactor } from '@/lib/factoring'
import { findBillingStatusDrift } from '@/lib/billing-status'
import {
  applyToInvoice,
  applyToLoads,
  findPaymentDrift,
  listPayments,
  recordPayment,
  statementCandidates,
} from '@/lib/payments'
import type { PaymentMethod, PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Money arriving, against real Postgres.
//
// The pure decisions are in tests/payments.test.ts. What can only be asserted
// here:
//
//   * unapplied money survives as a state rather than being cleared
//   * the billing axis really moves, all the way from POD to paid
//   * a Relay statement really pays N loads with no invoice in sight, and the
//     difference really stays visible as a remainder
//   * a broker's check really cannot settle an invoice that was sold
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let otherCompanyId = ''
let userId = ''
let brokerId = ''
let relayId = ''
let truckId = ''
let driverId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'payments.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

const labels = {
  linehaul: 'Linehaul',
  fuelSurcharge: 'Fuel surcharge',
  accessorial: (type: string) => type,
}

const day = (d: number) => new Date(Date.UTC(2026, 8, d, 8, 0, 0))

const billingOf = async (loadId: string) =>
  (
    await owner.load.findUnique({
      where: { id: loadId },
      select: { billingStatus: true },
    })
  )?.billingStatus

/** A load at POD received, with a rate on it. */
async function deliveredLoad(
  customerId: string,
  linehaul: string,
  offset: number,
  company = companyId,
) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId: company,
        customerId,
        // DELIVERED FREIGHT HAS SOMEBODY ON IT. The helper is named
        // `deliveredLoad` and used to create loads at POD_RECEIVED with no
        // driver and no truck — the exact shape production loads 1015 and 1016
        // were in, and the one the 2026-09-06 ruling forbids. The fixture was
        // encoding the defect; three tests here failed the moment `isReady`
        // learned to check, which is the guard working on its first run.
        ...(company === companyId ? { truckId, driverId } : {}),
        stops: [
          {
            type: 'PICKUP',
            city: 'Chicago',
            state: 'IL',
            scheduledAt: day(offset),
          },
          {
            type: 'DELIVERY',
            city: 'Dallas',
            state: 'TX',
            scheduledAt: day(offset + 1),
          },
        ],
      },
      { byUserId: userId },
    ),
  )
  await inOrg((tx) =>
    setLoadRate(tx, load.id, { linehaul, fuelSurcharge: '0' }),
  )
  await inOrg((tx) =>
    transitionOperational(tx, load.id, 'POD_RECEIVED', {
      source: 'AUTOMATIC',
      userId,
    }),
  )
  return load
}

async function sentInvoice(loadIds: string[]) {
  const outcome = await inOrg((tx) =>
    generateInvoice(tx, organizationId, { loadIds, labels }),
  )
  if (!outcome.ok) throw new Error(`invoice not generated: ${outcome.reason}`)
  await inOrg((tx) =>
    markInvoiceSent(tx, outcome.invoiceId, { channel: 'email' }),
  )
  return outcome
}

async function payment(amountCents: number, method: PaymentMethod = 'ACH') {
  const outcome = await inOrg((tx) =>
    recordPayment(tx, organizationId, {
      companyId,
      customerId: null,
      method,
      receivedAt: new Date('2026-09-15'),
      amountCents,
    }),
  )
  if (!outcome.ok) throw new Error(`payment not recorded: ${outcome.reason}`)
  return outcome.paymentId
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Payments ${nonce}`,
      slug: `payments-${nonce}`,
      maxCompanies: 5,
      companies: {
        create: [{ name: `Alpha ${nonce}` }, { name: `Beta ${nonce}` }],
      },
    },
    include: { companies: { orderBy: { name: 'asc' } } },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  otherCompanyId = organization.companies[1]!.id

  const user = await owner.user.create({
    data: { email: `payments-${nonce}@example.test`, name: 'Payment Tester' },
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

  // The Amazon Relay shape: settles directly, by weekly ACH statement.
  relayId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Relay ${nonce}` }),
    )
  ).id
  await owner.customer.update({
    where: { id: relayId },
    data: { settlesDirectly: true },
  })

  // SOMEBODY TO HAVE DRIVEN THE FREIGHT. Every load in this file is delivered
  // with a POD on it, and since the 2026-09-06 ruling that is not a state
  // freight can reach with nobody attached — `isReady` checks assignment, so
  // an unassigned load never becomes READY_TO_INVOICE and the invoice tests
  // below have nothing to invoice.
  truckId = (
    await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId,
        unitNumber: `PAY-${nonce}`,
      }),
    )
  ).id
  driverId = (
    await inOrg((tx) =>
      createDriver(tx, organizationId, {
        companyId,
        firstName: 'Pay',
        lastName: `Tester ${nonce}`,
      }),
    )
  ).id
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('recording money that arrived', () => {
  it('starts fully unapplied, and that is not an error', async () => {
    const id = await payment(1000000)
    const row = await owner.payment.findUnique({
      where: { id },
      select: { amountCents: true, unappliedCents: true },
    })
    expect(row).toMatchObject({
      amountCents: 1000000,
      unappliedCents: 1000000,
    })
  }, 300_000)

  it('refuses a zero or negative amount', async () => {
    for (const amountCents of [0, -5000]) {
      const outcome = await inOrg((tx) =>
        recordPayment(tx, organizationId, {
          companyId,
          method: 'CHECK',
          receivedAt: new Date('2026-09-15'),
          amountCents,
        }),
      )
      expect(outcome).toMatchObject({ ok: false, reason: 'bad_amount' })
    }
  }, 300_000)
})

describe('a broker paying an invoice', () => {
  it('moves the invoice and every load on it, in two steps', async () => {
    const first = await deliveredLoad(brokerId, '2450', 1)
    const second = await deliveredLoad(brokerId, '1900', 3)

    // The billing axis moved on its own when the POD landed — nobody set it.
    expect(await billingOf(first.id)).toBe('READY_TO_INVOICE')

    const invoice = await sentInvoice([first.id, second.id])
    expect(invoice.totalCents).toBe(435000)
    expect(await billingOf(first.id)).toBe('INVOICED')

    // PART ONE: $2,000.00 of a $4,350.00 invoice.
    const id = await payment(200000, 'CHECK')
    const part = await inOrg((tx) =>
      applyToInvoice(tx, id, invoice.invoiceId, 200000),
    )
    expect(part).toMatchObject({
      ok: true,
      appliedCents: 200000,
      unappliedCents: 0,
      invoiceBalanceCents: 235000,
    })
    expect(await billingOf(first.id)).toBe('PARTIALLY_PAID')
    expect(await billingOf(second.id)).toBe('PARTIALLY_PAID')

    // PART TWO: the rest, from a different check.
    const rest = await payment(235000, 'CHECK')
    const settled = await inOrg((tx) =>
      applyToInvoice(tx, rest, invoice.invoiceId, 235000),
    )
    expect(settled).toMatchObject({ ok: true, invoiceBalanceCents: 0 })

    const after = await owner.invoice.findUnique({
      where: { id: invoice.invoiceId },
      select: { status: true, amountPaidCents: true, balanceCents: true },
    })
    expect(after).toMatchObject({
      status: 'PAID',
      amountPaidCents: 435000,
      balanceCents: 0,
    })

    // BOTH loads, at the same moment. A broker pays a document, not a load.
    expect(await billingOf(first.id)).toBe('PAID')
    expect(await billingOf(second.id)).toBe('PAID')
  }, 300_000)

  it('spreads ONE CHECK across three invoices, and shows what is left', async () => {
    // §7's box, exactly as written: "One check applied across three invoices;
    // partial payment leaves correct balances; unapplied remainder visible."
    //
    // Three invoices — $1,000.00, $2,000.00 and $3,000.00 — and a single
    // $5,500.00 check. It settles the first two, part-pays the third, and
    // leaves nothing unapplied; then a second, larger check clears the third
    // and the surplus stays on the payment where somebody will ask about it.
    const one = await sentInvoice([
      (await deliveredLoad(brokerId, '1000', 60)).id,
    ])
    const two = await sentInvoice([
      (await deliveredLoad(brokerId, '2000', 62)).id,
    ])
    const three = await sentInvoice([
      (await deliveredLoad(brokerId, '3000', 64)).id,
    ])
    expect([one.totalCents, two.totalCents, three.totalCents]).toEqual([
      100000, 200000, 300000,
    ])

    const check = await payment(550000, 'CHECK')

    expect(
      await inOrg((tx) => applyToInvoice(tx, check, one.invoiceId, 100000)),
    ).toMatchObject({
      ok: true,
      unappliedCents: 450000,
      invoiceBalanceCents: 0,
    })
    expect(
      await inOrg((tx) => applyToInvoice(tx, check, two.invoiceId, 200000)),
    ).toMatchObject({
      ok: true,
      unappliedCents: 250000,
      invoiceBalanceCents: 0,
    })
    // PARTIAL: $2,500.00 against a $3,000.00 invoice leaves $500.00 owed.
    expect(
      await inOrg((tx) => applyToInvoice(tx, check, three.invoiceId, 250000)),
    ).toMatchObject({
      ok: true,
      unappliedCents: 0,
      invoiceBalanceCents: 50000,
    })

    // THREE APPLICATIONS, ONE PAYMENT — the join table doing the job it exists
    // for, and the reason `PaymentApplication` is not a column on Invoice.
    expect(
      await owner.paymentApplication.count({ where: { paymentId: check } }),
    ).toBe(3)

    const balances = await owner.invoice.findMany({
      where: {
        id: { in: [one.invoiceId, two.invoiceId, three.invoiceId] },
      },
      orderBy: { totalCents: 'asc' },
      select: { balanceCents: true, status: true },
    })
    expect(balances).toEqual([
      { balanceCents: 0, status: 'PAID' },
      { balanceCents: 0, status: 'PAID' },
      { balanceCents: 50000, status: 'PARTIALLY_PAID' },
    ])

    // THE UNAPPLIED REMAINDER, VISIBLE. A $600.00 check against a $500.00
    // balance settles it and leaves $100.00 sitting on the payment.
    const surplus = await payment(60000, 'CHECK')
    expect(
      await inOrg((tx) => applyToInvoice(tx, surplus, three.invoiceId, 50000)),
    ).toMatchObject({ ok: true, unappliedCents: 10000, invoiceBalanceCents: 0 })

    const listed = await inOrg((tx) => listPayments(tx, { id: surplus }))
    expect(listed[0]).toMatchObject({
      amountCents: 60000,
      unappliedCents: 10000,
    })
  }, 300_000)

  it('refuses more than the invoice still owes', async () => {
    const load = await deliveredLoad(brokerId, '1000', 6)
    const invoice = await sentInvoice([load.id])
    const id = await payment(500000, 'CHECK')

    const outcome = await inOrg((tx) =>
      applyToInvoice(tx, id, invoice.invoiceId, 200000),
    )
    expect(outcome).toMatchObject({ ok: false, reason: 'exceeds_balance' })

    // And nothing was written on the way to refusing.
    const row = await owner.payment.findUnique({
      where: { id },
      select: { unappliedCents: true },
    })
    expect(row?.unappliedCents).toBe(500000)
  }, 300_000)

  it('refuses more than the payment has left', async () => {
    const load = await deliveredLoad(brokerId, '3000', 9)
    const invoice = await sentInvoice([load.id])
    const id = await payment(100000, 'CHECK')

    await inOrg((tx) => applyToInvoice(tx, id, invoice.invoiceId, 100000))
    const again = await inOrg((tx) =>
      applyToInvoice(tx, id, invoice.invoiceId, 1),
    )
    expect(again).toMatchObject({ ok: false, reason: 'exceeds_unapplied' })
  }, 300_000)

  it('refuses money that belongs to the other authority', async () => {
    const load = await deliveredLoad(brokerId, '1500', 12, otherCompanyId)
    const invoice = await sentInvoice([load.id])
    const id = await payment(150000, 'CHECK')

    expect(
      await inOrg((tx) => applyToInvoice(tx, id, invoice.invoiceId, 150000)),
    ).toMatchObject({ ok: false, reason: 'wrong_carrier' })
  }, 300_000)
})

describe('an invoice that was sold', () => {
  it('takes the factor’s money and refuses the broker’s', async () => {
    const factor = await inOrg((tx) =>
      saveFactor(tx, organizationId, {
        companyId,
        name: `Triumph ${nonce}`,
        advanceRateBps: 9000,
        feeBps: 300,
      }),
    )
    if (!factor.ok) throw new Error(factor.reason)

    const load = await deliveredLoad(brokerId, '4000', 15)
    const invoice = await sentInvoice([load.id])
    await inOrg((tx) =>
      markFactored(tx, invoice.invoiceId, { factoringCompanyId: factor.id }),
    )

    // A check from the broker. The FACTOR collects this invoice now, so this
    // means somebody has been paid twice — refused rather than recorded.
    const check = await payment(400000, 'CHECK')
    expect(
      await inOrg((tx) => applyToInvoice(tx, check, invoice.invoiceId, 400000)),
    ).toMatchObject({ ok: false, reason: 'factored_invoice' })

    // The advance: 90% of $4,000.00.
    const advance = await payment(360000, 'FACTORING_ADVANCE')
    expect(
      await inOrg((tx) =>
        applyToInvoice(tx, advance, invoice.invoiceId, 360000),
      ),
    ).toMatchObject({ ok: true, invoiceBalanceCents: 40000 })

    // The reserve, six weeks later: 7% after the 3% fee. Releasing it stamps
    // the date the factored view reads to stop counting it as outstanding.
    const reserve = await payment(28000, 'FACTORING_RESERVE')
    expect(
      await inOrg((tx) =>
        applyToInvoice(tx, reserve, invoice.invoiceId, 28000),
      ),
    ).toMatchObject({ ok: true, invoiceBalanceCents: 12000 })

    const after = await owner.invoice.findUnique({
      where: { id: invoice.invoiceId },
      select: { reserveReleasedAt: true, amountPaidCents: true },
    })
    expect(after?.reserveReleasedAt).toBeInstanceOf(Date)
    // $3,600 + $280 = $3,880. The remaining $120 is the factor's fee, which
    // the factor keeps — it is not money anybody will ever send.
    expect(after?.amountPaidCents).toBe(388000)
  }, 300_000)

  it('refuses a factoring advance against an invoice nobody sold', async () => {
    const load = await deliveredLoad(brokerId, '1100', 18)
    const invoice = await sentInvoice([load.id])
    const advance = await payment(100000, 'FACTORING_ADVANCE')

    expect(
      await inOrg((tx) =>
        applyToInvoice(tx, advance, invoice.invoiceId, 100000),
      ),
    ).toMatchObject({ ok: false, reason: 'not_factored' })
  }, 300_000)
})

describe('the Relay path: one ACH, many loads, no invoice', () => {
  it('pays direct-settled loads without an invoice existing', async () => {
    const a = await deliveredLoad(relayId, '850', 20)
    const b = await deliveredLoad(relayId, '1200', 22)
    const c = await deliveredLoad(relayId, '975', 24)

    // These never enter the invoice path at all.
    const ready = await inOrg((tx) =>
      statementCandidates(tx, companyId, relayId),
    )
    expect(ready.map((row) => row.loadId).sort()).toEqual(
      [a.id, b.id, c.id].sort(),
    )
    expect(ready.every((row) => row.outstandingCents > 0)).toBe(true)

    // $3,025.00 of freight, and the statement pays exactly that.
    const id = await payment(302500)
    const outcome = await inOrg((tx) =>
      applyToLoads(tx, id, [
        { loadId: a.id, amountCents: 85000 },
        { loadId: b.id, amountCents: 120000 },
        { loadId: c.id, amountCents: 97500 },
      ]),
    )
    expect(outcome).toMatchObject({
      ok: true,
      appliedCents: 302500,
      unappliedCents: 0,
      shortfallCents: 0,
    })

    for (const load of [a, b, c]) {
      expect(await billingOf(load.id)).toBe('PAID')
    }

    // And no invoice was created anywhere along the way.
    expect(
      await owner.invoiceLine.count({
        where: { loadId: { in: [a.id, b.id, c.id] } },
      }),
    ).toBe(0)
  }, 300_000)

  it('leaves a statement that paid too little as an unreconciled shortfall', async () => {
    const a = await deliveredLoad(relayId, '1000', 30)
    const b = await deliveredLoad(relayId, '1000', 32)

    // $2,000.00 of freight, $1,940.00 paid. Amazon shorted the second load by
    // $60.00 — recorded as it happened, on the load it happened to.
    const id = await payment(194000)
    const outcome = await inOrg((tx) =>
      applyToLoads(tx, id, [
        { loadId: a.id, amountCents: 100000 },
        { loadId: b.id, amountCents: 94000 },
      ]),
    )
    expect(outcome).toMatchObject({
      ok: true,
      appliedCents: 194000,
      unappliedCents: 0,
      shortfallCents: 6000,
    })

    // NOT FORCED TO MATCH. The first load is paid, the second is not, and the
    // $60 stays owed where somebody can ask about it.
    expect(await billingOf(a.id)).toBe('PAID')
    expect(await billingOf(b.id)).toBe('PARTIALLY_PAID')
  }, 300_000)

  it('leaves a statement that paid too much as unapplied money', async () => {
    const load = await deliveredLoad(relayId, '500', 35)

    // $700 arrived against $500 of freight. The extra $200 stays on the
    // payment rather than being spread onto loads to make the total agree.
    const id = await payment(70000)
    const outcome = await inOrg((tx) =>
      applyToLoads(tx, id, [{ loadId: load.id, amountCents: 50000 }]),
    )
    expect(outcome).toMatchObject({
      ok: true,
      appliedCents: 50000,
      unappliedCents: 20000,
      shortfallCents: 0,
    })
    expect(await billingOf(load.id)).toBe('PAID')
  }, 300_000)

  it('refuses to apply a statement to invoiced freight', async () => {
    // The load is billed by invoice, so it is paid through the invoice.
    // Applying a statement here would credit the money twice, and neither
    // figure would look wrong on its own.
    const load = await deliveredLoad(brokerId, '1400', 38)
    const id = await payment(140000)

    const outcome = await inOrg((tx) =>
      applyToLoads(tx, id, [{ loadId: load.id, amountCents: 140000 }]),
    )
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'not_direct_settled',
      loadNumbers: [load.loadNumber],
    })
  }, 300_000)

  it('refuses to pay a load more than it is worth', async () => {
    const load = await deliveredLoad(relayId, '600', 41)
    const id = await payment(200000)

    expect(
      await inOrg((tx) =>
        applyToLoads(tx, id, [{ loadId: load.id, amountCents: 70000 }]),
      ),
    ).toMatchObject({
      ok: false,
      reason: 'exceeds_load_balance',
      loadNumbers: [load.loadNumber],
    })
  }, 300_000)

  it('takes a second statement against the same load without double counting', async () => {
    const load = await deliveredLoad(relayId, '900', 44)

    const first = await payment(50000)
    await inOrg((tx) =>
      applyToLoads(tx, first, [{ loadId: load.id, amountCents: 50000 }]),
    )
    expect(await billingOf(load.id)).toBe('PARTIALLY_PAID')

    const second = await payment(40000)
    const outcome = await inOrg((tx) =>
      applyToLoads(tx, second, [{ loadId: load.id, amountCents: 40000 }]),
    )
    expect(outcome).toMatchObject({ ok: true, shortfallCents: 0 })
    expect(await billingOf(load.id)).toBe('PAID')

    // Two payments, two rows — the unique index is per (payment, load), not
    // per load, and the second statement must not overwrite the first.
    expect(
      await owner.paymentLoadApplication.count({ where: { loadId: load.id } }),
    ).toBe(2)
  }, 300_000)
})

describe('the drift checks', () => {
  it('every payment and every load still agrees with the money', async () => {
    expect(await inOrg((tx) => findPaymentDrift(tx))).toEqual([])
    expect(await inOrg((tx) => findBillingStatusDrift(tx))).toEqual([])
  }, 300_000)

  it('finds an unapplied figure somebody edited by hand', async () => {
    const id = await payment(123400)
    await owner.payment.update({
      where: { id },
      data: { unappliedCents: 100000 },
    })

    const drift = await inOrg((tx) => findPaymentDrift(tx))
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatchObject({
      paymentId: id,
      storedUnappliedCents: 100000,
      computedUnappliedCents: 123400,
    })

    // Put it back, so the run leaves the database as it found it — the same
    // check sweeps every organization in tests/integrity.test.ts.
    await owner.payment.update({
      where: { id },
      data: { unappliedCents: 123400 },
    })
    expect(await inOrg((tx) => findPaymentDrift(tx))).toEqual([])
  }, 300_000)

  it('finds a billing status somebody edited by hand', async () => {
    const load = await deliveredLoad(relayId, '700', 47)
    expect(await billingOf(load.id)).toBe('READY_TO_INVOICE')

    await owner.load.update({
      where: { id: load.id },
      data: { billingStatus: 'PAID' },
    })

    const drift = await inOrg((tx) => findBillingStatusDrift(tx))
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatchObject({
      loadId: load.id,
      stored: 'PAID',
      computed: 'READY_TO_INVOICE',
    })

    await owner.load.update({
      where: { id: load.id },
      data: { billingStatus: 'READY_TO_INVOICE' },
    })
    expect(await inOrg((tx) => findBillingStatusDrift(tx))).toEqual([])
  }, 300_000)

  it('leaves a disputed load alone rather than recomputing over it', async () => {
    // DISPUTED is a decision somebody made, not arithmetic. A recomputation
    // that cleared it because a partial payment arrived would erase the only
    // record that the argument is still open.
    const load = await deliveredLoad(relayId, '800', 50)
    await owner.load.update({
      where: { id: load.id },
      data: { billingStatus: 'DISPUTED' },
    })

    const id = await payment(80000)
    await inOrg((tx) =>
      applyToLoads(tx, id, [{ loadId: load.id, amountCents: 80000 }]),
    )

    expect(await billingOf(load.id)).toBe('DISPUTED')
    expect(await inOrg((tx) => findBillingStatusDrift(tx))).toEqual([])
  }, 300_000)
})

describe('§7: every money mutation is audited, and the billing axis has a timeline', () => {
  // Two acceptance boxes in one fixture, because they are two views of the
  // same events: what changed (AuditLog) and how the load's billing state got
  // where it is (LoadStatusEvent on the BILLING axis).
  it('leaves an audit row with the money in the diff, for each kind of write', async () => {
    const load = await deliveredLoad(brokerId, '2450', 80)
    const invoice = await sentInvoice([load.id])
    const check = await payment(245000, 'CHECK')
    await inOrg((tx) => applyToInvoice(tx, check, invoice.invoiceId, 245000))

    const rows = await owner.auditLog.findMany({
      where: {
        organizationId,
        entityType: {
          in: ['Load', 'Invoice', 'Payment', 'PaymentApplication'],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 400,
      select: {
        entityType: true,
        entityId: true,
        action: true,
        changes: true,
        userId: true,
      },
    })

    // EVERY KIND OF MONEY WRITE IS THERE. Not a spot check: each of the four
    // models this path touches has to appear, because a gap in the trail is
    // invisible until somebody needs it.
    for (const entityType of [
      'Load',
      'Invoice',
      'Payment',
      'PaymentApplication',
    ]) {
      expect(
        rows.some((row) => row.entityType === entityType),
        `${entityType} has no audit row`,
      ).toBe(true)
    }

    const changesOf = (row: (typeof rows)[number]) =>
      row.changes as Record<string, { from: unknown; to: unknown }>

    // THE DIFF IS CORRECT, not merely present. Setting the rate moved
    // `totalRevenueCents` from 0 to 245000, and the row carries both sides —
    // a trail that records "something changed" is a trail nobody can use.
    const rate = rows.find(
      (row) =>
        row.entityType === 'Load' &&
        row.entityId === load.id &&
        changesOf(row).totalRevenueCents?.to === 245000,
    )
    expect(rate, 'no audit row carries the rate').toBeDefined()
    expect(changesOf(rate!).totalRevenueCents).toEqual({
      from: 0,
      to: 245000,
    })
    expect(rate!.action).toBe('UPDATE')

    // The payment application carries the amount and names who applied it.
    const applied = rows.find((row) => row.entityType === 'PaymentApplication')
    expect(applied!.action).toBe('CREATE')
    expect(
      changesOf(applied!).amountCents?.to,
      JSON.stringify(applied!.changes),
    ).toBe(245000)
    expect(applied!.userId).toBe(userId)

    // And the invoice reaching zero is recorded on both sides.
    const settled = rows.find(
      (row) =>
        row.entityType === 'Invoice' &&
        row.entityId === invoice.invoiceId &&
        changesOf(row).balanceCents?.to === 0,
    )
    expect(
      settled,
      'no audit row shows the invoice reaching zero',
    ).toBeDefined()
    expect(changesOf(settled!).balanceCents).toEqual({ from: 245000, to: 0 })
  }, 300_000)

  it('writes a BILLING event per transition, each naming its source', async () => {
    const load = await deliveredLoad(brokerId, '1750', 85)
    const invoice = await sentInvoice([load.id])
    const check = await payment(100000, 'CHECK')
    await inOrg((tx) => applyToInvoice(tx, check, invoice.invoiceId, 100000))
    const rest = await payment(75000, 'CHECK')
    await inOrg((tx) => applyToInvoice(tx, rest, invoice.invoiceId, 75000))

    const billing = await owner.loadStatusEvent.findMany({
      where: { loadId: load.id, axis: 'BILLING' },
      orderBy: { occurredAt: 'asc' },
      select: { fromStatus: true, toStatus: true, source: true },
    })

    // The whole journey, in order, on its own axis: uninvoiced when the POD
    // landed and the rate was on it, invoiced, part paid, paid.
    expect(billing.map((event) => event.toStatus)).toEqual([
      'READY_TO_INVOICE',
      'INVOICED',
      'PARTIALLY_PAID',
      'PAID',
    ])

    // EVERY EVENT NAMES ITS SOURCE — the box asks for exactly this. All of
    // these are AUTOMATIC because nothing on this axis is clicked.
    expect(billing.every((event) => event.source === 'AUTOMATIC')).toBe(true)

    // And the chain is continuous: each event starts where the last one ended.
    for (let index = 1; index < billing.length; index++) {
      expect(billing[index]!.fromStatus).toBe(billing[index - 1]!.toStatus)
    }

    // The operational axis is untouched by any of it — two axes, moving
    // independently (schema convention 4).
    const operational = await owner.loadStatusEvent.count({
      where: { loadId: load.id, axis: 'OPERATIONAL' },
    })
    expect(operational).toBeGreaterThan(0)
  }, 300_000)
})
