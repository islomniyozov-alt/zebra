import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { netPayByDriverWeek, pipelineStrip } from '@/lib/accounting-reports'
import { readBatches } from '@/lib/accounting-grids'
import { recentSundays, sundayOf } from '@/lib/rolling-period'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// §6.2.9's FIGURES: THE PIPELINE STRIP AND THE PER-DRIVER SHAPE.
//
// ── WHAT EACH ONE HAS TO AGREE WITH ──────────────────────────────────────
//
// The pipeline figures tie to the batches grid — `readBatches`, the reader the
// screen lists with — one state at a time. The per-batch gross and deductions
// tie to the settlements they are summed from. And the sparkline's series has to
// put a driver's week where the calendar puts it, with a GAP for a week they
// were not paid, because a zero there asserts something false.
//
// EVERY CASE SEEDS BOTH SIDES ABOVE ZERO, and the pipeline cases seed all three
// states, because three figures that are all empty agree about nothing.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let alphaId = ''
let userId = ''
let driverA = ''
let driverB = ''
const nonce = Math.random().toString(36).slice(2, 8)

/** The Sunday that opens the current settlement week, and the twelve before it. */
const WEEKS = recentSundays(new Date(), 13)
const WEEK = (back: number) => WEEKS[WEEKS.length - 1 - back]!

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'payroll-figures.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

const sum = <T>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0)

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Payroll ${nonce}`,
      slug: `payroll-${nonce}`,
      maxCompanies: 3,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  alphaId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: { email: `payroll-${nonce}@example.test`, name: 'Payroll Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  await inOrg(async (tx) => {
    const makeDriver = async (first: string) =>
      (
        await tx.driver.create({
          data: {
            organizationId,
            companyId: alphaId,
            firstName: first,
            lastName: `Pay ${nonce}`,
            hireDate: new Date(Date.UTC(2026, 0, 5)),
          },
        })
      ).id
    driverA = await makeDriver('Aaa')
    driverB = await makeDriver('Bbb')

    let seq = 0
    const run = async (spec: {
      status: 'DRAFT' | 'FINAL' | 'PAID'
      week: Date
      pays: { driverId: string; gross: number; deductions: number }[]
    }) => {
      const end = new Date(spec.week)
      end.setUTCDate(end.getUTCDate() + 6)
      const batch = await tx.settlementBatch.create({
        data: {
          organizationId,
          status: spec.status,
          periodStart: spec.week,
          periodEnd: end,
          statementDate: end,
          checkDate: end,
        },
      })
      for (const pay of spec.pays) {
        seq += 1
        await tx.settlement.create({
          data: {
            organizationId,
            companyId: alphaId,
            driverId: pay.driverId,
            batchId: batch.id,
            settlementNumber: `PR-${nonce}-${String(seq)}`,
            periodStart: spec.week,
            periodEnd: end,
            grossCents: pay.gross,
            deductionsCents: pay.deductions,
            // NET IS NOT gross − deductions HERE, deliberately: §6.2.9 says the
            // three columns are not an equation, and a fixture where they were
            // would let a reader (or a test) subtract and be right by accident.
            netCents: pay.gross - pay.deductions + 1_000,
          },
        })
      }
      return batch.id
    }

    // ── THREE STATES, SO THE THREE FIGURES ARE ALL NON-ZERO ────────────
    await run({
      status: 'DRAFT',
      week: WEEK(0),
      pays: [{ driverId: driverA, gross: 500_000, deductions: 50_000 }],
    })
    await run({
      status: 'FINAL',
      week: WEEK(1),
      pays: [{ driverId: driverA, gross: 400_000, deductions: 40_000 }],
    })
    // PAID, over several weeks, and driver B is paid in only some of them — the
    // gaps are the point of the sparkline case below.
    await run({
      status: 'PAID',
      week: WEEK(2),
      pays: [
        { driverId: driverA, gross: 300_000, deductions: 30_000 },
        { driverId: driverB, gross: 200_000, deductions: 20_000 },
      ],
    })
    await run({
      status: 'PAID',
      week: WEEK(4),
      pays: [{ driverId: driverA, gross: 310_000, deductions: 31_000 }],
    })
    await run({
      status: 'PAID',
      week: WEEK(5),
      pays: [{ driverId: driverA, gross: 320_000, deductions: 32_000 }],
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

describe('the pipeline strip ties to the batches grid', () => {
  it('state by state, to the cent', async () => {
    const { strip, batches } = await inOrg(async (tx) => ({
      strip: await pipelineStrip(tx, [alphaId]),
      batches: await readBatches(tx, { companyId: { in: [alphaId] } }),
    }))

    const mine = batches.filter(
      (row) => row.batchNumber?.includes(nonce) ?? true,
    )
    const of = (status: string) => mine.filter((row) => row.status === status)

    // ALL THREE SEEDED, so no comparison below is between two zeroes.
    expect(strip.draftCents).toBeGreaterThan(0)
    expect(strip.finalCents).toBeGreaterThan(0)
    expect(strip.paidCents).toBeGreaterThan(0)

    expect(strip.draftCents).toBe(sum(of('DRAFT'), (row) => row.amountCents))
    expect(strip.finalCents).toBe(sum(of('FINAL'), (row) => row.amountCents))
    expect(strip.paidCents).toBe(sum(of('PAID'), (row) => row.amountCents))

    expect(strip.draftCount).toBe(of('DRAFT').length)
    expect(strip.finalCount).toBe(of('FINAL').length)
    expect(strip.paidCount).toBe(of('PAID').length)
  }, 300_000)

  it('and keeps the three apart, because only one has a deadline', async () => {
    // A PIPELINE, NOT A PARTITION (§6.2.9). FINAL is approved and unpaid — the
    // figure with a deadline — so a reader must never see it folded into either
    // neighbour. Asserted as three distinct values rather than as a total.
    const strip = await inOrg((tx) => pipelineStrip(tx, [alphaId]))
    expect(strip.draftCents).not.toBe(strip.finalCents)
    expect(strip.finalCents).not.toBe(strip.paidCents)
  }, 300_000)

  it('is as of today, with no window to give it', async () => {
    // THE SIGNATURE IS THE ASSERTION: `pipelineStrip` takes no period at all, so
    // there is no way to window it by accident. The oldest PAID run is five
    // weeks back and must be in the figure.
    const strip = await inOrg((tx) => pipelineStrip(tx, [alphaId]))
    expect(strip.paidCents).toBe(
      300_000 -
        30_000 +
        1_000 +
        (200_000 - 20_000 + 1_000) +
        (310_000 - 31_000 + 1_000) +
        (320_000 - 32_000 + 1_000),
    )
  }, 300_000)
})

describe('the batch list carries gross and deductions from the same read', () => {
  it('summed from the settlements, and not an equation with net', async () => {
    const batches = await inOrg((tx) =>
      readBatches(tx, { companyId: { in: [alphaId] } }),
    )
    const draft = batches.find((row) => row.status === 'DRAFT')
    expect(draft).toBeDefined()

    expect(draft?.grossCents).toBe(500_000)
    expect(draft?.deductionsCents).toBe(50_000)
    expect(draft?.amountCents).toBe(451_000)

    // THE SUBTRACTION A READER WOULD TRY, asserted to be WRONG — which is what
    // §6.2.9 says out loud. If this ever passes, the fixture has lost the
    // reimbursement and the doc's warning has stopped being testable.
    expect(draft?.amountCents).not.toBe(
      (draft?.grossCents ?? 0) - (draft?.deductionsCents ?? 0),
    )
  }, 300_000)
})

describe('the per-driver sparkline series', () => {
  const from = () => {
    const start = sundayOf(new Date())
    start.setUTCDate(start.getUTCDate() - 12 * 7)
    return start
  }

  it('puts each week where the calendar puts it', async () => {
    const series = await inOrg((tx) =>
      netPayByDriverWeek(tx, [driverA, driverB], from()),
    )

    const forA = series.get(driverA) ?? []
    // FINAL AND PAID ONLY: the DRAFT week is absent, because a draft is
    // recomputed on every refresh and a shape drawn from one moves under the
    // reader between two readings.
    const weeks = forA.map((point) => point.weekStart.getTime())
    expect(weeks).not.toContain(WEEK(0).getTime())
    expect(weeks).toContain(WEEK(1).getTime())
    expect(weeks).toContain(WEEK(2).getTime())
    expect(weeks).toContain(WEEK(4).getTime())
  }, 300_000)

  it('leaves a week with no settlement ABSENT rather than zero', async () => {
    // §6.2.9: unpaid and not-yet-settled are different facts. Driver A has no
    // run in week 3, and the series must say nothing about it rather than zero.
    const series = await inOrg((tx) =>
      netPayByDriverWeek(tx, [driverA, driverB], from()),
    )
    const forA = series.get(driverA) ?? []
    expect(forA.length).toBeGreaterThan(0)
    expect(forA.map((p) => p.weekStart.getTime())).not.toContain(
      WEEK(3).getTime(),
    )
    // AND NO ZERO-VALUED POINT ANYWHERE, which is the shape of the same mistake.
    expect(forA.every((point) => point.netCents !== 0)).toBe(true)
  }, 300_000)

  it('gives each driver their own history and nobody else', async () => {
    const series = await inOrg((tx) =>
      netPayByDriverWeek(tx, [driverA, driverB], from()),
    )
    const forB = series.get(driverB) ?? []
    // B WAS PAID ONCE. A series that leaked A's weeks in would show five.
    expect(forB).toHaveLength(1)
    expect(forB[0]?.netCents).toBe(200_000 - 20_000 + 1_000)
  }, 300_000)

  it('asks Postgres nothing when there are no drivers on screen', async () => {
    const series = await inOrg((tx) => netPayByDriverWeek(tx, [], from()))
    // `= ANY('{}')` MATCHES NOTHING, so the query would be a round trip to learn
    // what the caller already knew.
    expect(series.size).toBe(0)
  }, 300_000)
})
