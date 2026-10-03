import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  deductionsByCategory,
  receivablesSeries,
  scopeSql,
  settlementsPaidSeries,
} from '@/lib/accounting-reports'
import { agingSums, directAging, agingBucketFor } from '@/lib/factoring'
import { readInvoices, readBatches } from '@/lib/accounting-grids'
import { listPayments, FACTORING_METHODS } from '@/lib/payments'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// §6.2.7's PROMISE: EVERY FIGURE TIES TO THE CENT TO THE SCREEN IT SUMMARISES.
//
// One test per charted figure, against the reader the other screen actually
// lists with — not against a hand-written query that resembles it. A reference
// nothing runs agrees with itself.
//
// ── BOTH SIDES SEEDED ABOVE ZERO, EVERY TIME ─────────────────────────────
//
// An agreement test over two empty sets passes and proves nothing, which is
// the most comfortable way to be wrong. Each test asserts its own fixture
// arrived before it compares anything.
//
// ── AND THE LIMIT OF THE CLAIM IS PART OF THE CONTRACT ───────────────────
//
// `readInvoices` takes 2000 rows, `listPayments` 300, `directAging` 500. These
// windows hold a handful of records, so the lists are not truncated and the
// comparison is meaningful. §6.2.7 says so out loud: the charts aggregate in
// SQL precisely because the lists cannot be trusted to be complete at scale.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let alphaId = ''
let betaId = ''
let userId = ''
let brokerId = ''
const nonce = Math.random().toString(36).slice(2, 8)

// A FIXED CLOCK. The window is thirteen weeks back from a Friday, so every
// seeded date below is inside it on any day this suite runs.
const NOW = new Date(Date.UTC(2026, 9, 2))
const WINDOW = {
  from: new Date(Date.UTC(2026, 6, 5)),
  to: new Date(Date.UTC(2026, 9, 4)),
}
const PERIOD_START = new Date(Date.UTC(2026, 8, 6))
const PERIOD_END = new Date(Date.UTC(2026, 8, 12))

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'accounting-reports.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

/** Sum of a window of buckets, for comparing a series against a list. */
const sum = <T>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0)

const inWindow = (at: Date | null) =>
  at !== null && at >= WINDOW.from && at < WINDOW.to

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Reports ${nonce}`,
      slug: `reports-${nonce}`,
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
    data: { email: `reports-${nonce}@example.test`, name: 'Reports Tester' },
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

  await inOrg(async (tx) => {
    const bill = (spec: {
      issued: Date
      due: Date
      cents: number
      status?: 'SENT' | 'DRAFT' | 'WRITTEN_OFF'
      factored?: boolean
      paid?: number
    }) =>
      tx.invoice.create({
        data: {
          organizationId,
          companyId: alphaId,
          customerId: brokerId,
          invoiceNumber: `RPT-${nonce}-${Math.random().toString(36).slice(2, 9)}`,
          status: spec.status ?? 'SENT',
          issueDate: spec.issued,
          dueDate: spec.due,
          totalCents: spec.cents,
          amountPaidCents: spec.paid ?? 0,
          balanceCents: spec.cents - (spec.paid ?? 0),
          isFactored: spec.factored ?? false,
        },
      })

    // ── RECEIVABLES: ONE WEEK WITH EVERYTHING IN IT ────────────────────
    const issued = new Date(Date.UTC(2026, 8, 8))
    // Outstanding, aged into each of the four buckets by its DUE date.
    await bill({
      issued,
      due: new Date(NOW.getTime() - 5 * 86_400_000),
      cents: 100_000,
    })
    await bill({
      issued,
      due: new Date(NOW.getTime() - 45 * 86_400_000),
      cents: 200_000,
    })
    await bill({
      issued,
      due: new Date(NOW.getTime() - 75 * 86_400_000),
      cents: 300_000,
    })
    await bill({
      issued,
      due: new Date(NOW.getTime() - 200 * 86_400_000),
      cents: 400_000,
    })
    // SOLD: its own series, and out of the aging entirely.
    await bill({
      issued,
      due: new Date(NOW.getTime() - 5 * 86_400_000),
      cents: 500_000,
      factored: true,
    })
    // NOT BILLING: a draft was shown to nobody.
    await bill({
      issued,
      due: new Date(NOW.getTime() - 5 * 86_400_000),
      cents: 999_999,
      status: 'DRAFT',
    })
    // ── OUTSIDE THE WINDOW, SO THE WINDOW IS WHAT IS BEING TESTED ──────
    //
    // Without this row every seeded invoice is inside the window and a reader
    // that ignored the window entirely would still agree with the list — the
    // break that drops the lower bound was watched NOT firing until this
    // existed. Same for the payment below and the draft batch further down.
    await bill({
      issued: new Date(Date.UTC(2026, 3, 8)),
      due: new Date(Date.UTC(2026, 4, 8)),
      cents: 777_777,
    })

    // ── COLLECTED, AND THE FACTORING PAYMENT THAT IS NOT COLLECTION ────
    const received = new Date(Date.UTC(2026, 8, 10))
    await tx.payment.create({
      data: {
        organizationId,
        companyId: alphaId,
        customerId: brokerId,
        method: 'ACH',
        receivedAt: received,
        amountCents: 150_000,
        unappliedCents: 150_000,
      },
    })
    await tx.payment.create({
      data: {
        organizationId,
        companyId: alphaId,
        customerId: brokerId,
        method: 'FACTORING_ADVANCE',
        receivedAt: received,
        amountCents: 450_000,
        unappliedCents: 450_000,
      },
    })

    await tx.payment.create({
      data: {
        organizationId,
        companyId: alphaId,
        customerId: brokerId,
        method: 'CHECK',
        receivedAt: new Date(Date.UTC(2026, 3, 10)),
        amountCents: 888_888,
        unappliedCents: 888_888,
      },
    })

    // ── A PAID BATCH, WITH ONE DEDUCTION OF EACH CATEGORY ──────────────
    const driver = await tx.driver.create({
      data: {
        organizationId,
        companyId: alphaId,
        firstName: 'Reports',
        lastName: `Driver ${nonce}`,
        hireDate: new Date(Date.UTC(2026, 0, 5)),
      },
    })
    const standing = await tx.standingCharge.create({
      data: {
        organizationId,
        type: 'Fuel',
        description: 'Org-wide fuel admin',
        amountCents: 2_500,
        cadence: 'WEEKLY',
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    })
    const batch = await tx.settlementBatch.create({
      data: {
        organizationId,
        status: 'PAID',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        statementDate: PERIOD_END,
        checkDate: PERIOD_END,
      },
    })
    const settlement = await tx.settlement.create({
      data: {
        organizationId,
        companyId: alphaId,
        driverId: driver.id,
        batchId: batch.id,
        settlementNumber: `RPT-${nonce}-1`,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        grossCents: 300_000,
        // THE ENGINE'S OWN TOTAL, positive, which the donut is tested against.
        deductionsCents: 2_500 + 7_500 + 1_000 + 4_000,
        netCents: 300_000 - (2_500 + 7_500 + 1_000 + 4_000),
      },
    })
    const line = (spec: {
      type: string
      cents: number
      ruleId?: string | null
    }) =>
      tx.settlementDeductionLine.create({
        data: {
          organizationId,
          settlementId: settlement.id,
          type: spec.type,
          description: spec.type,
          rateCents: spec.cents,
          // SIGNED: negative is money off the driver.
          totalCents: -spec.cents,
          recurringDeductionId: spec.ruleId ?? null,
        },
      })

    // SOURCE BEATS LABEL: this one prints as Fuel and is a standing charge, so
    // it belongs to `standing` and NOT to `fuelTolls`. The precedence is the
    // contract (§6.2.7) and this row is what tests it.
    await line({ type: 'Fuel', cents: 2_500, ruleId: standing.id })
    await line({ type: 'Fuel', cents: 7_500 })
    await line({ type: 'Advance', cents: 1_000 })
    await line({ type: 'Insurance', cents: 4_000 })
    // ── A DRAFT BATCH IN THE SAME WINDOW, WHICH BOTH MUST IGNORE ──────
    //
    // A draft is recomputed on every refresh, so its figures change under the
    // reader between two readings. It is seeded so the status filter is TESTED
    // rather than merely present: without it, a reader that counted every batch
    // would still agree with the grid.
    const draftBatch = await tx.settlementBatch.create({
      data: {
        organizationId,
        status: 'DRAFT',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        statementDate: PERIOD_END,
        checkDate: PERIOD_END,
      },
    })
    const draftSettlement = await tx.settlement.create({
      data: {
        organizationId,
        companyId: alphaId,
        driverId: driver.id,
        batchId: draftBatch.id,
        settlementNumber: `RPT-${nonce}-draft`,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        grossCents: 111_111,
        deductionsCents: 9_999,
        netCents: 101_112,
      },
    })
    await tx.settlementDeductionLine.create({
      data: {
        organizationId,
        settlementId: draftSettlement.id,
        type: 'Escrow',
        description: 'Draft escrow',
        rateCents: 9_999,
        totalCents: -9_999,
      },
    })

    // OTHER PAY SHARES THE TABLE and must not reach the donut.
    await tx.settlementDeductionLine.create({
      data: {
        organizationId,
        settlementId: settlement.id,
        type: 'Reimbursement',
        description: 'Lumper',
        rateCents: 6_000,
        totalCents: 6_000,
      },
    })
  })
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('receivables tie to the invoices list', () => {
  it('invoiced per period sums to what the list shows for the window', async () => {
    const { series, list } = await inOrg(async (tx) => ({
      series: await receivablesSeries(tx, [alphaId], WINDOW, 'week'),
      list: await readInvoices(tx, { companyId: { in: [alphaId] } }, NOW),
    }))

    // THE LIST'S OWN PREDICATE, applied to the list's own rows: issued, in the
    // window, not factored, and not a draft — which is what `invoicedCents`
    // claims to be. `readInvoices` returns every status, so the filtering is
    // the part being compared.
    const fromList = sum(
      list.filter(
        (row) =>
          inWindow(row.issued) && !row.isFactored && row.status !== 'DRAFT',
      ),
      (row) => row.totalCents,
    )

    expect(fromList).toBeGreaterThan(0)
    expect(sum(series, (point) => point.invoicedCents)).toBeGreaterThan(0)
    expect(sum(series, (point) => point.invoicedCents)).toBe(fromList)
  }, 300_000)

  it('factored is its own series and never inside invoiced', async () => {
    const { series, list } = await inOrg(async (tx) => ({
      series: await receivablesSeries(tx, [alphaId], WINDOW, 'week'),
      list: await readInvoices(tx, { companyId: { in: [alphaId] } }, NOW),
    }))

    const factoredOnList = sum(
      list.filter((row) => inWindow(row.issued) && row.isFactored),
      (row) => row.totalCents,
    )

    expect(factoredOnList).toBeGreaterThan(0)
    expect(sum(series, (point) => point.factoredCents)).toBe(factoredOnList)
    // AND NOT DOUBLE-COUNTED. The invoiced series must not contain it — which
    // is the whole reason it has a series of its own.
    const invoicedOnList = sum(
      list.filter(
        (row) =>
          inWindow(row.issued) && !row.isFactored && row.status !== 'DRAFT',
      ),
      (row) => row.totalCents,
    )
    expect(sum(series, (point) => point.invoicedCents)).toBe(invoicedOnList)
  }, 300_000)

  it('collected ties to the payments list, with factoring excluded', async () => {
    const { series, payments } = await inOrg(async (tx) => ({
      series: await receivablesSeries(tx, [alphaId], WINDOW, 'week'),
      payments: await listPayments(tx, { companyId: { in: [alphaId] } }),
    }))

    const inside = payments.filter((row) => inWindow(row.receivedAt))
    const collectedOnList = sum(
      inside.filter((row) => !FACTORING_METHODS.includes(row.method as never)),
      (row) => row.amountCents,
    )
    const factoringOnList = sum(
      inside.filter((row) => FACTORING_METHODS.includes(row.method as never)),
      (row) => row.amountCents,
    )

    // BOTH SIDES ABOVE ZERO, and the factoring payment above zero too — without
    // that the exclusion below is satisfied by there being nothing to exclude.
    expect(collectedOnList).toBeGreaterThan(0)
    expect(factoringOnList).toBeGreaterThan(0)
    expect(sum(series, (point) => point.collectedCents)).toBe(collectedOnList)
  }, 300_000)
})

describe('the aging bar ties to the invoices screen and the Cash panel', () => {
  it('bucket for bucket, against directAging', async () => {
    const { sums, aging } = await inOrg(async (tx) => ({
      sums: await agingSums(tx, scopeSql('i', [alphaId]), NOW),
      aging: await directAging(tx, { companyId: { in: [alphaId] } }, NOW),
    }))

    // THE CONTROL: all four buckets seeded, so no comparison below is between
    // two zeroes.
    for (const bucket of ['current', 'd31_60', 'd61_90', 'd90_plus'] as const) {
      expect(aging.totals[bucket]).toBeGreaterThan(0)
    }

    expect(sums.d0_30).toBe(aging.totals.current)
    expect(sums.d31_60).toBe(aging.totals.d31_60)
    expect(sums.d61_90).toBe(aging.totals.d61_90)
    expect(sums.d90plus).toBe(aging.totals.d90_plus)
  }, 300_000)

  it('agrees at every boundary day, which is where it was wrong', async () => {
    // FLAG 46: the SQL said `dueDate > now - interval '30 days'`, which is
    // `daysPastDue < 30`, while `agingBucketFor` says `<= 30`. An invoice
    // exactly thirty days past due was current on one screen and 31-60 on the
    // other. These are the days either side of all three boundaries.
    const days = [29, 30, 31, 59, 60, 61, 89, 90, 91]

    await inOrg(async (tx) => {
      for (const day of days) {
        await tx.invoice.create({
          data: {
            organizationId,
            companyId: betaId,
            customerId: brokerId,
            invoiceNumber: `EDGE-${nonce}-${String(day)}`,
            status: 'SENT',
            issueDate: new Date(Date.UTC(2026, 8, 8)),
            dueDate: new Date(NOW.getTime() - day * 86_400_000),
            totalCents: 1_000 + day,
            balanceCents: 1_000 + day,
          },
        })
      }
    })

    const { sums, aging } = await inOrg(async (tx) => ({
      sums: await agingSums(tx, scopeSql('i', [betaId]), NOW),
      aging: await directAging(tx, { companyId: { in: [betaId] } }, NOW),
    }))

    // AND THE THIRD EXPRESSION TOO: what the pure function says each invoice is,
    // which is the rule both of the other two are meant to implement.
    const byRule = { current: 0, d31_60: 0, d61_90: 0, d90_plus: 0 }
    for (const day of days) {
      byRule[agingBucketFor(day)] += 1_000 + day
    }

    expect(byRule.current).toBeGreaterThan(0)
    expect(sums.d0_30).toBe(byRule.current)
    expect(sums.d31_60).toBe(byRule.d31_60)
    expect(sums.d61_90).toBe(byRule.d61_90)
    expect(sums.d90plus).toBe(byRule.d90_plus)

    expect(aging.totals.current).toBe(byRule.current)
    expect(aging.totals.d31_60).toBe(byRule.d31_60)
    expect(aging.totals.d61_90).toBe(byRule.d61_90)
    expect(aging.totals.d90_plus).toBe(byRule.d90_plus)
  }, 300_000)
})

describe('settlements tie to the batches grid', () => {
  it('net paid per period sums to the paid batches the grid lists', async () => {
    const { series, batches } = await inOrg(async (tx) => ({
      series: await settlementsPaidSeries(tx, [alphaId], WINDOW, 'week'),
      batches: await readBatches(tx, { companyId: { in: [alphaId] } }),
    }))

    const paid = batches.filter(
      (row) => row.status === 'PAID' && inWindow(row.periodStart),
    )
    const fromGrid = sum(paid, (row) => row.amountCents)

    expect(fromGrid).toBeGreaterThan(0)
    expect(sum(series, (point) => point.netCents)).toBeGreaterThan(0)
    expect(sum(series, (point) => point.netCents)).toBe(fromGrid)
  }, 300_000)

  it('and gross is above net, because deductions came off it', async () => {
    const series = await inOrg((tx) =>
      settlementsPaidSeries(tx, [alphaId], WINDOW, 'week'),
    )
    const gross = sum(series, (point) => point.grossCents)
    const net = sum(series, (point) => point.netCents)

    expect(gross).toBeGreaterThan(0)
    expect(net).toBeGreaterThan(0)
    expect(gross).toBeGreaterThan(net)
  }, 300_000)
})

describe('the deductions donut ties to the settlements it draws from', () => {
  it('the four categories sum to the engine stored total', async () => {
    const { slices, stored } = await inOrg(async (tx) => ({
      slices: await deductionsByCategory(tx, [alphaId], WINDOW),
      // THE INDEPENDENT COLUMN. `Settlement.deductionsCents` is written by the
      // engine from its own lines; the donut sums the line rows. Two routes to
      // one figure, which is what makes this an agreement rather than a
      // restatement.
      stored: await tx.settlement.aggregate({
        where: {
          deletedAt: null,
          companyId: alphaId,
          periodStart: { gte: WINDOW.from, lt: WINDOW.to },
          batch: { status: 'PAID', deletedAt: null },
        },
        _sum: { deductionsCents: true },
      }),
    }))

    const total = sum(slices, (slice) => slice.cents)
    expect(stored._sum.deductionsCents ?? 0).toBeGreaterThan(0)
    expect(total).toBe(stored._sum.deductionsCents ?? 0)
  }, 300_000)

  it('puts a standing charge under standing even when it prints as Fuel', async () => {
    // SOURCE BEATS LABEL (§6.2.7). The fixture seeds a $25.00 fuel-labelled
    // line FROM a standing charge and a $75.00 fuel line that is not, so a
    // mapping that went by label alone would show $100 of fuel and no standing
    // charges at all.
    const slices = await inOrg((tx) =>
      deductionsByCategory(tx, [alphaId], WINDOW),
    )
    const of = (category: string) =>
      slices.find((slice) => slice.category === category)

    expect(of('standing')?.cents).toBe(2_500)
    expect(of('fuelTolls')?.cents).toBe(7_500)
    expect(of('advances')?.cents).toBe(1_000)
    expect(of('other')?.cents).toBe(4_000)
  }, 300_000)

  it('leaves Other Pay out, and keeps every category in the legend', async () => {
    const slices = await inOrg((tx) =>
      deductionsByCategory(tx, [alphaId], WINDOW),
    )

    // THE REIMBURSEMENT IS POSITIVE and must reach no slice: $60.00 would
    // otherwise net against the deductions and make one category too small.
    expect(sum(slices, (slice) => slice.cents)).toBe(15_000)
    // FOUR SLICES ALWAYS, in a fixed order, including any that are empty — a
    // category that vanishes on a quiet week reads as one somebody deleted.
    expect(slices.map((slice) => slice.category)).toEqual([
      'standing',
      'fuelTolls',
      'advances',
      'other',
    ])
  }, 300_000)
})

describe('the authority chip narrows every figure', () => {
  it('and an unscoped read is every authority, not none', async () => {
    const { alpha, all } = await inOrg(async (tx) => ({
      alpha: await receivablesSeries(tx, [alphaId], WINDOW, 'week'),
      all: await receivablesSeries(tx, [], WINDOW, 'week'),
    }))

    const alphaInvoiced = sum(alpha, (point) => point.invoicedCents)
    const allInvoiced = sum(all, (point) => point.invoicedCents)

    // AN EMPTY LIST MEANS EVERY AUTHORITY. Rendered as `= ANY('{}')` it would
    // match nothing and empty every chart at once — the failure here that looks
    // like good news.
    expect(alphaInvoiced).toBeGreaterThan(0)
    expect(allInvoiced).toBeGreaterThanOrEqual(alphaInvoiced)
  }, 300_000)
})
