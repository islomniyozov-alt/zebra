import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { transitionOperational } from '@/lib/load-status'
import { setLoadRate } from '@/lib/rates'
import { generateInvoice, markInvoiceSent } from '@/lib/invoices'
import {
  directAging,
  factoredInvoices,
  findFactoringDrift,
  markFactored,
  saveFactor,
} from '@/lib/factoring'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Selling an invoice, against real Postgres.
//
// The arithmetic is covered in tests/factoring-math.test.ts. What can only be
// asserted here:
//
//   * the fee really lands on the loads, and really sums back to the invoice
//   * `findFactoringDrift` really finds a share somebody edited by hand
//   * a factored invoice really leaves direct aging
//   * a factor really cannot be used by the other authority
//
// TWO COMPANIES on purpose. One authority proves nothing about a rule whose
// whole point is that the terms are negotiated separately.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let alphaId = ''
let betaId = ''
let userId = ''
let brokerId = ''
let alphaFactorId = ''
let betaFactorId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'factoring.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

const labels = {
  linehaul: 'Linehaul',
  fuelSurcharge: 'Fuel surcharge',
  accessorial: (type: string) => type,
}

const day = (d: number) => new Date(Date.UTC(2026, 8, d, 8, 0, 0))

async function deliveredLoad(
  companyId: string,
  linehaul: string,
  fuel: string,
  offset: number,
) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
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
    setLoadRate(tx, load.id, { linehaul, fuelSurcharge: fuel }),
  )
  await inOrg((tx) =>
    transitionOperational(tx, load.id, 'POD_RECEIVED', {
      source: 'AUTOMATIC',
      userId,
    }),
  )
  return load
}

/** A sent invoice over the given loads, ready to be sold. */
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

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Factoring ${nonce}`,
      slug: `factoring-${nonce}`,
      maxCompanies: 5,
      companies: {
        create: [{ name: `Alpha ${nonce}` }, { name: `Beta ${nonce}` }],
      },
    },
    include: { companies: { orderBy: { name: 'asc' } } },
  })
  organizationId = organization.id
  alphaId = organization.companies[0]!.id
  betaId = organization.companies[1]!.id

  const user = await owner.user.create({
    data: { email: `factoring-${nonce}@example.test`, name: 'Factor Tester' },
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

  // Both carriers factor with the same house, on different terms — which is
  // exactly the real arrangement and exactly why the row carries the authority.
  const alphaFactor = await inOrg((tx) =>
    saveFactor(tx, organizationId, {
      companyId: alphaId,
      name: `Triumph ${nonce}`,
      advanceRateBps: 9700,
      feeBps: 300,
    }),
  )
  if (!alphaFactor.ok) throw new Error(`alpha factor: ${alphaFactor.reason}`)
  alphaFactorId = alphaFactor.id

  const betaFactor = await inOrg((tx) =>
    saveFactor(tx, organizationId, {
      companyId: betaId,
      name: `Triumph Beta ${nonce}`,
      advanceRateBps: 9000,
      feeBps: 300,
    }),
  )
  if (!betaFactor.ok) throw new Error(`beta factor: ${betaFactor.reason}`)
  betaFactorId = betaFactor.id
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('terms are per authority', () => {
  it('refuses terms that would leave a negative reserve', async () => {
    // 97 + 4 = 101%. Refused at entry rather than surfaced later as an invoice
    // whose reserve is a negative number nobody can act on.
    const outcome = await inOrg((tx) =>
      saveFactor(tx, organizationId, {
        companyId: alphaId,
        name: `Impossible ${nonce}`,
        advanceRateBps: 9700,
        feeBps: 400,
      }),
    )
    expect(outcome).toMatchObject({ ok: false, reason: 'over_hundred' })
  }, 300_000)

  it("will not sell one authority's invoice under another's agreement", async () => {
    const load = await deliveredLoad(alphaId, '1000', '0', 20)
    const invoice = await sentInvoice([load.id])

    const outcome = await inOrg((tx) =>
      markFactored(tx, invoice.invoiceId, {
        factoringCompanyId: betaFactorId,
      }),
    )
    expect(outcome).toMatchObject({ ok: false, reason: 'wrong_carrier' })
  }, 300_000)
})

describe('selling an invoice', () => {
  it('will not sell one the broker has never been given', async () => {
    const load = await deliveredLoad(alphaId, '1200', '0', 24)
    const outcome = await inOrg((tx) =>
      generateInvoice(tx, organizationId, { loadIds: [load.id], labels }),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const sold = await inOrg((tx) =>
      markFactored(tx, outcome.invoiceId, {
        factoringCompanyId: alphaFactorId,
      }),
    )
    expect(sold).toMatchObject({ ok: false, reason: 'not_sent' })
  }, 300_000)

  it('splits the money and lands the fee on every load it covers', async () => {
    // $2,450.00 + $380.00 and $1,900.00 + $295.00 = $5,025.00, which is the
    // worked example in tests/factoring-math.test.ts.
    const first = await deliveredLoad(alphaId, '2450', '380', 1)
    const second = await deliveredLoad(alphaId, '1900', '295', 3)
    const invoice = await sentInvoice([first.id, second.id])
    expect(invoice.totalCents).toBe(502500)

    const sold = await inOrg((tx) =>
      markFactored(tx, invoice.invoiceId, {
        factoringCompanyId: alphaFactorId,
      }),
    )
    expect(sold.ok).toBe(true)
    if (!sold.ok) return

    // 97% advance, 3% fee, and the reserve is what is left.
    expect(sold.advanceCents).toBe(487425)
    expect(sold.feeCents).toBe(15075)
    expect(sold.reserveCents).toBe(0)

    const stored = await owner.invoice.findUnique({
      where: { id: invoice.invoiceId },
      select: {
        isFactored: true,
        factoredAt: true,
        advanceCents: true,
        factoringFeeCents: true,
        factoringCompanyId: true,
      },
    })
    expect(stored).toMatchObject({
      isFactored: true,
      advanceCents: 487425,
      factoringFeeCents: 15075,
      factoringCompanyId: alphaFactorId,
    })
    expect(stored?.factoredAt).toBeInstanceOf(Date)

    // THE APPORTIONMENT. $2,830.00 and $2,195.00 of a $5,025.00 invoice.
    //   2830/5025 x 15075 = 8490 exactly
    //   2195/5025 x 15075 = 6585 exactly
    // Both divide evenly here because 15075 is 3% of the total and each load's
    // share is a whole number of cents; the awkward cases are covered by the
    // math tests, and the invariant below is what matters either way.
    const loads = await owner.load.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { id: true, isFactored: true, factoringFeeCents: true },
    })
    // By id rather than by sort order: `loadNumber` is a string, and a test
    // that depends on "L-1009" sorting before "L-1010" is a test that passes
    // until the counter reaches four digits.
    const feeFor = (id: string) =>
      loads.find((load) => load.id === id)?.factoringFeeCents
    expect(feeFor(first.id)).toBe(8490)
    expect(feeFor(second.id)).toBe(6585)
    expect(loads.every((load) => load.isFactored)).toBe(true)
    expect(loads.reduce((sum, load) => sum + load.factoringFeeCents, 0)).toBe(
      15075,
    )

    // And it will not be sold twice.
    const again = await inOrg((tx) =>
      markFactored(tx, invoice.invoiceId, {
        factoringCompanyId: alphaFactorId,
      }),
    )
    expect(again).toMatchObject({ ok: false, reason: 'already_factored' })
  }, 300_000)

  it('honours a one-off rate without touching the standing terms', async () => {
    const load = await deliveredLoad(alphaId, '5025', '0', 30)
    const invoice = await sentInvoice([load.id])

    const sold = await inOrg((tx) =>
      markFactored(tx, invoice.invoiceId, {
        factoringCompanyId: alphaFactorId,
        advanceRateBps: 9000,
        feeBps: 300,
      }),
    )
    expect(sold).toMatchObject({
      ok: true,
      advanceCents: 452250,
      feeCents: 15075,
      reserveCents: 35175,
    })

    // The factor's own row is untouched: a one-off is one invoice, not a
    // renegotiation nobody wrote down.
    const factor = await owner.factoringCompany.findUnique({
      where: { id: alphaFactorId },
      select: { advanceRateBps: true, feeBps: true },
    })
    expect(factor).toMatchObject({ advanceRateBps: 9700, feeBps: 300 })
  }, 300_000)
})

describe('what the two receivables questions answer', () => {
  it('a factored invoice leaves aging and appears with its reserve', async () => {
    const load = await deliveredLoad(betaId, '4000', '0', 40)
    const invoice = await sentInvoice([load.id])

    const before = await inOrg((tx) => directAging(tx, { companyId: betaId }))
    expect(before.rows.map((row) => row.id)).toContain(invoice.invoiceId)

    await inOrg((tx) =>
      markFactored(tx, invoice.invoiceId, {
        factoringCompanyId: betaFactorId,
      }),
    )

    // Gone from "who owes us" — the factor collects it now. An aging report
    // that still counted it would be answering a question nobody asked.
    const after = await inOrg((tx) => directAging(tx, { companyId: betaId }))
    expect(after.rows.map((row) => row.id)).not.toContain(invoice.invoiceId)
    expect(after.totalCents).toBe(before.totalCents - 400000)

    // And present in "what has the factor not paid yet": 90% advance, 3% fee,
    // so 7% of $4,000.00 is still with the factor.
    const factored = await inOrg((tx) =>
      factoredInvoices(tx, { companyId: betaId }),
    )
    const row = factored.find((entry) => entry.id === invoice.invoiceId)
    expect(row).toMatchObject({
      advanceCents: 360000,
      feeCents: 12000,
      reserveCents: 28000,
      reserveReleasedAt: null,
    })
  }, 300_000)

  it('buckets an overdue invoice by days past its DUE date', async () => {
    const load = await deliveredLoad(betaId, '700', '0', 44)
    const invoice = await sentInvoice([load.id])

    // Issued 1 Jan, due 31 Jan, read on 1 Apr. Counted rather than recalled:
    // from the DUE date, Jan 31 -> Feb 28 is 28 days, -> Mar 31 is 59, -> Apr 1
    // is 60, which is the 31–60 bucket. From the ISSUE date it would be 90 days
    // and the 61–90 bucket. Two different answers on the same invoice, and the
    // due date is the one a broker on net-30 terms would agree with.
    const issued = new Date(Date.UTC(2026, 0, 1))
    await owner.invoice.update({
      where: { id: invoice.invoiceId },
      data: { issueDate: issued, dueDate: new Date(Date.UTC(2026, 0, 31)) },
    })

    const aging = await inOrg((tx) =>
      directAging(
        tx,
        { id: invoice.invoiceId },
        new Date(Date.UTC(2026, 3, 1)),
      ),
    )
    expect(aging.rows).toHaveLength(1)
    expect(aging.rows[0]).toMatchObject({ daysPastDue: 60, bucket: 'd31_60' })
    expect(aging.totals.d31_60).toBe(70000)
  }, 300_000)
})

describe('the drift check', () => {
  it('finds a share somebody edited by hand, and is silent otherwise', async () => {
    const first = await deliveredLoad(alphaId, '1500', '0', 50)
    const second = await deliveredLoad(alphaId, '2500', '0', 52)
    const invoice = await sentInvoice([first.id, second.id])
    await inOrg((tx) =>
      markFactored(tx, invoice.invoiceId, {
        factoringCompanyId: alphaFactorId,
      }),
    )

    expect(await inOrg((tx) => findFactoringDrift(tx))).toEqual([])

    // One cent, by hand — the smallest edit that makes per-load profitability
    // wrong forever and announces nothing.
    const before = await owner.load.findUnique({
      where: { id: first.id },
      select: { factoringFeeCents: true },
    })
    await owner.load.update({
      where: { id: first.id },
      data: { factoringFeeCents: before!.factoringFeeCents - 1 },
    })

    const drift = await inOrg((tx) => findFactoringDrift(tx))
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatchObject({
      invoiceId: invoice.invoiceId,
      invoiceFeeCents: 12000,
      loadFeeTotalCents: 11999,
    })

    // Put it back, so the run leaves the database as it found it — the same
    // check runs across every organization in tests/integrity.test.ts.
    await owner.load.update({
      where: { id: first.id },
      data: { factoringFeeCents: before!.factoringFeeCents },
    })
    expect(await inOrg((tx) => findFactoringDrift(tx))).toEqual([])
  }, 300_000)
})
