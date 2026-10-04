import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { invoiceStrip, paymentStrip } from '@/lib/accounting-reports'
import {
  invoiceShape,
  paymentShape,
  readInvoices,
  readPayments,
} from '@/lib/accounting-grids'
import { applyList, readListParams } from '@/lib/list-view'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// §6.2.8's PROMISE: EVERY FIGURE ON THE STRIP IS THE LIST ITS LINK OPENS.
//
// ── THE TEST IS THE LINK, NOT A RESEMBLANCE OF IT ────────────────────────
//
// Each case runs the strip reader, then runs the LIST through the same
// `applyList` the screen uses, with the same query parameters the strip's href
// writes. If the figure and the filtered rows disagree by a cent, the link is a
// lie — and the lie would be invisible, because both numbers look plausible.
//
// So the parameters below are the ones in `listHref`: a state, the window, the
// authority. Nothing is hand-filtered.
//
// ── BOTH SIDES SEEDED ABOVE ZERO ─────────────────────────────────────────
//
// An agreement between two empty sets passes and proves nothing. Every case
// asserts its own fixture arrived first.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let alphaId = ''
let userId = ''
let brokerId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const NOW = new Date(Date.UTC(2026, 9, 2))
const WINDOW = {
  from: new Date(Date.UTC(2026, 6, 5)),
  to: new Date(Date.UTC(2026, 9, 4)),
}

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'accounting-strips.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

const sum = <T>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0)

/**
 * The list, filtered exactly as the strip's link filters it.
 *
 * `scope: 'balance'` IS THE UNWINDOWED LIST — what `?period=all` opens. Owner's
 * ruling 2026-10-04: a balance has no date bound, so its link must not impose
 * one, or the figure above the rows stops being the sum of the rows.
 *
 * `scope: 'flow'` is the windowed list the picker produces, via the same
 * `from`/`to` the page pushes in through `windowed()`.
 */
const listedWith = async (
  params: Record<string, string>,
  scope: 'balance' | 'flow' = 'balance',
) => {
  const rows = await inOrg((tx) =>
    readInvoices(tx, { companyId: { in: [alphaId] } }, NOW),
  )
  const raw =
    scope === 'balance'
      ? { ...params }
      : {
          ...params,
          from: WINDOW.from.toISOString().slice(0, 10),
          to: new Date(WINDOW.to.getTime() - 1).toISOString().slice(0, 10),
        }
  return applyList(rows, readListParams(raw), invoiceShape, raw)
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Strips ${nonce}`,
      slug: `strips-${nonce}`,
      maxCompanies: 3,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  alphaId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: { email: `strips-${nonce}@example.test`, name: 'Strips Tester' },
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
      overdueDays: number
      cents: number
      paid?: number
      factored?: boolean
      status?: 'SENT' | 'DRAFT' | 'WRITTEN_OFF'
    }) =>
      tx.invoice.create({
        data: {
          organizationId,
          companyId: alphaId,
          customerId: brokerId,
          invoiceNumber: `STR-${nonce}-${Math.random().toString(36).slice(2, 9)}`,
          status: spec.status ?? 'SENT',
          issueDate: spec.issued,
          dueDate: new Date(NOW.getTime() - spec.overdueDays * 86_400_000),
          totalCents: spec.cents,
          amountPaidCents: spec.paid ?? 0,
          balanceCents: spec.cents - (spec.paid ?? 0),
          isFactored: spec.factored ?? false,
        },
      })

    const issued = new Date(Date.UTC(2026, 8, 8))

    // OPEN AND NOT YET DUE — due in five days, so open but not overdue.
    await bill({ issued, overdueDays: -5, cents: 100_000 })
    // OPEN AND ONE DAY LATE. The boundary that `bucket !== 'current'` would
    // have called on-time, because agingBucketFor's first bucket is 30 days.
    await bill({ issued, overdueDays: 1, cents: 200_000 })
    // OPEN AND LONG OVERDUE.
    await bill({ issued, overdueDays: 75, cents: 300_000 })
    // PARTLY PAID AND OVERDUE: only the balance is open.
    await bill({ issued, overdueDays: 40, cents: 500_000, paid: 400_000 })
    // SETTLED — in neither figure.
    await bill({ issued, overdueDays: 10, cents: 900_000, paid: 900_000 })
    // SOLD — its own figure, never inside open.
    //
    // PARTLY COLLECTED ON PURPOSE, so `totalCents` and `balanceCents` differ.
    // Seeded unpaid, the two were equal and the break that swaps one for the
    // other changed nothing — the guard reported it, and a fixture that cannot
    // tell two readings apart cannot test which one shipped. The figure is the
    // INVOICE the factor took on, not what is left of it.
    await bill({
      issued,
      overdueDays: 20,
      cents: 700_000,
      paid: 250_000,
      factored: true,
    })
    // SHOWN TO NOBODY, and WRITTEN OFF: neither is open.
    await bill({ issued, overdueDays: 3, cents: 111_111, status: 'DRAFT' })
    await bill({
      issued,
      overdueDays: 3,
      cents: 222_222,
      status: 'WRITTEN_OFF',
    })
    // OUTSIDE THE WINDOW, so the window is what is being tested.
    await bill({
      issued: new Date(Date.UTC(2026, 3, 8)),
      overdueDays: 100,
      cents: 777_777,
    })

    // PAYMENTS: one fully unapplied, one partly, one applied, one outside.
    const pay = (
      receivedAt: Date,
      amountCents: number,
      unappliedCents: number,
    ) =>
      tx.payment.create({
        data: {
          organizationId,
          companyId: alphaId,
          customerId: brokerId,
          method: 'ACH',
          receivedAt,
          amountCents,
          unappliedCents,
        },
      })
    const received = new Date(Date.UTC(2026, 8, 10))
    await pay(received, 150_000, 150_000)
    await pay(received, 80_000, 30_000)
    await pay(received, 60_000, 0)
    await pay(new Date(Date.UTC(2026, 3, 10)), 999_999, 999_999)
  })
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('the Open figure is the list its link opens', () => {
  it('to the cent', async () => {
    const strip = await inOrg((tx) => invoiceStrip(tx, [alphaId], null, NOW))
    const listed = await listedWith({ 'f.state': 'open' })
    const fromList = sum(listed, (row) => row.balanceCents)

    expect(strip.openCents).toBeGreaterThan(0)
    expect(fromList).toBeGreaterThan(0)
    expect(strip.openCents).toBe(fromList)
  }, 300_000)

  it('and includes the overdue rows, because overdue is a subset', async () => {
    // THE TRAP THIS CATCHES: a single-valued state filter would make
    // `?state=open` exclude everything overdue, so the list under the figure
    // would be missing exactly the rows somebody clicked to find.
    const listed = await listedWith({ 'f.state': 'open' })
    const overdue = await listedWith({ 'f.state': 'overdue' })

    expect(overdue.length).toBeGreaterThan(0)
    for (const row of overdue) {
      expect(listed.map((r) => r.id)).toContain(row.id)
    }
    expect(listed.length).toBeGreaterThan(overdue.length)
  }, 300_000)

  it('and leaves out drafts, write-offs, settled and factored paper', async () => {
    const listed = await listedWith({ 'f.state': 'open' })
    for (const row of listed) {
      expect(row.status).not.toBe('DRAFT')
      expect(row.status).not.toBe('WRITTEN_OFF')
      expect(row.isFactored).toBe(false)
      expect(row.balanceCents).toBeGreaterThan(0)
    }
  }, 300_000)
})

describe('the Overdue figure is the list its link opens', () => {
  it('to the cent, counting one day late as late', async () => {
    const strip = await inOrg((tx) => invoiceStrip(tx, [alphaId], null, NOW))
    const listed = await listedWith({ 'f.state': 'overdue' })
    const fromList = sum(listed, (row) => row.balanceCents)

    expect(strip.overdueCents).toBeGreaterThan(0)
    expect(fromList).toBeGreaterThan(0)
    expect(strip.overdueCents).toBe(fromList)

    // AND THE ONE-DAY-LATE ROW IS IN IT. `agingBucketFor` calls the first thirty
    // days "current", so a bucket-based test would have called this on time —
    // which is why `isOverdue` exists rather than `bucket !== 'current'`.
    expect(listed.some((row) => row.bucket === 'current')).toBe(true)
  }, 300_000)

  it('and is smaller than Open, which is what a subset means', async () => {
    const strip = await inOrg((tx) => invoiceStrip(tx, [alphaId], null, NOW))
    expect(strip.overdueCents).toBeLessThan(strip.openCents)
  }, 300_000)
})

describe('the Factored figure is the Factored tab', () => {
  it('to the cent, and by count', async () => {
    const strip = await inOrg((tx) => invoiceStrip(tx, [alphaId], null, NOW))
    const listed = await listedWith({ 'f.state': 'factored' })
    // THE WHOLE TOTAL, not the balance: what the factor took on is the invoice.
    const fromList = sum(listed, (row) => row.totalCents)

    expect(strip.factoredCents).toBeGreaterThan(0)
    expect(strip.factoredCents).toBe(fromList)
    expect(strip.factoredCount).toBe(listed.length)
  }, 300_000)

  it('and is never inside Open', async () => {
    const open = await listedWith({ 'f.state': 'open' })
    expect(open.some((row) => row.isFactored)).toBe(false)
  }, 300_000)
})

describe('the Unapplied figure is the payments list its link opens', () => {
  it('to the cent, and with its count', async () => {
    const { strip, listed } = await inOrg(async (tx) => {
      const scope = { companyId: { in: [alphaId] } }
      const rows = await readPayments(tx, scope)
      // NO DATE BOUND, because Unapplied is a BALANCE and its link carries
      // `?period=all`. The April payment's 999,999 belongs in both the figure
      // and the rows — it is money sitting unapplied right now, which is the
      // whole question. Windowed, this test compared 1,179,999 against 180,000
      // and the figure was the one telling the truth.
      const raw = { state: 'unapplied' }
      return {
        strip: await paymentStrip(tx, [alphaId], null),
        // THE SCREEN NARROWS BY STATE ITSELF, before applyList — so this does
        // the same, then runs the same date and sort pipeline.
        listed: applyList(
          rows.filter((row) => row.unappliedCents > 0),
          readListParams(raw),
          paymentShape,
          raw,
        ),
      }
    })

    const fromList = sum(listed, (row) => row.unappliedCents)
    expect(strip.unappliedCents).toBeGreaterThan(0)
    expect(fromList).toBeGreaterThan(0)
    expect(strip.unappliedCents).toBe(fromList)
    expect(strip.unappliedCount).toBe(listed.length)
  }, 300_000)

  it('counts applied and unapplied to the same total', async () => {
    // THE CONTROL ON THE TWO CHIP COUNTS: they are now separate COUNT(*)s, and
    // two counts that are supposed to partition a set can both be wrong in the
    // same direction without anything noticing.
    const strip = await inOrg((tx) => paymentStrip(tx, [alphaId], null))
    expect(strip.unappliedCount).toBeGreaterThan(0)
    expect(strip.appliedCount).toBeGreaterThan(0)
    expect(strip.unappliedCount + strip.appliedCount).toBe(strip.totalCount)
  }, 300_000)
})

describe('the window and the authority govern the strip', () => {
  // ── THE BALANCE IGNORES THE WINDOW, WHICH IS THE RULING ────────────────
  it('reports the same Open figure whatever window it is given', async () => {
    // FLAG 49 RESOLVED. The April invoice (777,777) is outside the thirteen-week
    // window and MUST be in Open anyway — it is exactly the five-month-old unpaid
    // invoice the windowed version hid, on the screen whose job is to show what
    // is owed.
    const unbounded = await inOrg((tx) =>
      invoiceStrip(tx, [alphaId], null, NOW),
    )
    const windowedToo = await inOrg((tx) =>
      invoiceStrip(tx, [alphaId], WINDOW, NOW),
    )

    expect(unbounded.openCents).toBeGreaterThan(0)
    expect(windowedToo.openCents).toBe(unbounded.openCents)
    expect(windowedToo.overdueCents).toBe(unbounded.overdueCents)
    expect(windowedToo.factoredCents).toBe(unbounded.factoredCents)
  }, 300_000)

  it('and the April invoice is in it, which is what was hidden before', async () => {
    const strip = await inOrg((tx) => invoiceStrip(tx, [alphaId], null, NOW))
    const listed = await listedWith({ 'f.state': 'open' })
    expect(listed.some((row) => row.totalCents === 777_777)).toBe(true)
    expect(strip.openCents).toBe(sum(listed, (row) => row.balanceCents))
  }, 300_000)

  // ── AND THE FLOW IS THE ONE THE PICKER MOVES ───────────────────────────
  it('the Invoiced figure is the window, and ties to the windowed list', async () => {
    const strip = await inOrg((tx) => invoiceStrip(tx, [alphaId], WINDOW, NOW))
    const listed = await listedWith({}, 'flow')
    const billed = listed.filter(
      (row) => row.status !== 'DRAFT' && row.status !== 'VOID',
    )
    const fromList = sum(billed, (row) => row.totalCents)

    expect(strip.invoicedCents).toBeGreaterThan(0)
    expect(strip.invoicedCents).toBe(fromList)
    expect(strip.invoicedCount).toBe(billed.length)

    // AND IT EXCLUDES THE APRIL INVOICE, which the balance includes — the two
    // kinds of figure answering two questions, which is the ruling's point.
    expect(strip.invoicedCents).toBeLessThan(
      (await inOrg((tx) => invoiceStrip(tx, [alphaId], null, NOW)))
        .invoicedCents,
    )
  }, 300_000)

  it('the Received figure is the window, and Unapplied is not', async () => {
    const windowed = await inOrg((tx) => paymentStrip(tx, [alphaId], WINDOW))
    const everything = await inOrg((tx) => paymentStrip(tx, [alphaId], null))

    // THE APRIL PAYMENT (999,999, fully unapplied) is outside the window.
    expect(windowed.unappliedCents).toBe(everything.unappliedCents)
    expect(windowed.receivedCents).toBeLessThan(everything.receivedCents)
    expect(everything.receivedCents - windowed.receivedCents).toBe(999_999)
  }, 300_000)

  it('and an empty authority list means every authority, not none', async () => {
    const mine = await inOrg((tx) => invoiceStrip(tx, [alphaId], null, NOW))
    const all = await inOrg((tx) => invoiceStrip(tx, [], WINDOW, NOW))
    expect(mine.openCents).toBeGreaterThan(0)
    expect(all.openCents).toBeGreaterThanOrEqual(mine.openCents)
  }, 300_000)
})
