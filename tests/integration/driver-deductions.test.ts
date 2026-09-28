import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  closeRecurringDeduction,
  isDeductionType,
  saveOpeningBalance,
  saveRecurringDeduction,
  DEDUCTION_TYPES,
} from '@/lib/driver-deductions'
import { computeDeductions } from '@/lib/deductions'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// WHAT COMES OFF A CHEQUE, ENTERED BY A PERSON RATHER THAN BY HAND IN SQL.
//
// `RecurringDeduction` and `DriverOpeningBalance` have been in the schema since
// Phase 3 with NO screen and no writer — the engine read them, the statement
// printed them, and nothing could put one in. Every statement diff on the four
// replayed dev weeks showed Datatruck's deductions against Zebra's $0.00 for
// exactly that reason.
//
// SO THESE TESTS READ THE ROW BACK AND THEN PRICE A WEEK FROM IT. "The writer
// returned ok" is not the claim; the claim is that what it wrote is what
// `computeDeductions` prices, because those two agreeing is the entire point of
// the column existing.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let driverId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'driver-deductions.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d))

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: { name: `Deduct ${nonce}`, slug: `deduct-${nonce}` },
  })
  organizationId = organization.id
  const company = await owner.company.create({
    data: { organizationId, name: `Deduct Carrier ${nonce}` },
  })
  companyId = company.id
  const user = await owner.user.create({
    data: { email: `deduct-${nonce}@example.test`, name: 'Deduct Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
  const driver = await owner.driver.create({
    data: {
      organizationId,
      companyId,
      firstName: 'Hassan Ali',
      lastName: `Hirsi ${nonce}`,
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

describe('a weekly deduction, entered and then priced', () => {
  it('writes the row and computeDeductions charges it', async () => {
    const saved = await inOrg((tx) =>
      saveRecurringDeduction(tx, driverId, {
        type: 'Ifta',
        amountCents: 5_000,
        cadence: 'WEEKLY',
        effectiveFrom: day(2026, 7, 1),
      }),
    )
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const row = await owner.recurringDeduction.findFirstOrThrow({
      where: { id: saved.deductionId },
    })
    expect(row.amountCents).toBe(5_000)
    expect(row.cadence).toBe('WEEKLY')
    // CLEARED, NOT LEFT BEHIND: a weekly rule carrying a monthly total is a
    // figure the next reader would trust.
    expect(row.monthlyTotalCents).toBeNull()

    // ── AND THE ENGINE PRICES WHAT WAS WRITTEN ──────────────────────────
    const priced = computeDeductions({
      period: { start: day(2026, 7, 23), end: day(2026, 7, 29) },
      rules: [
        {
          id: row.id,
          type: row.type,
          description: row.description,
          amountCents: row.amountCents,
          cadence: row.cadence,
          monthlyTotalCents: row.monthlyTotalCents,
          targetCents: row.targetCents,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
        },
      ],
      charges: [],
      escrowHeldCents: 0,
      fuelCents: 0,
    })
    // `totalCents` IS THE SIGNED FIGURE — negative is money off the driver.
    expect(priced.lines.map((line) => line.totalCents)).toEqual([-5_000])
  }, 300_000)

  // ── THE $1800/$450 SHAPE, WHICH IS THE ONE THE STATEMENTS PRINT ─────────
  it('refuses a monthly split with the two figures the wrong way round', async () => {
    const wrong = await inOrg((tx) =>
      saveRecurringDeduction(tx, driverId, {
        type: 'Insurance',
        amountCents: 180_000,
        cadence: 'MONTHLY_SPLIT_WEEKLY',
        monthlyTotalCents: 45_000,
        effectiveFrom: day(2026, 7, 1),
      }),
    )
    expect(wrong).toEqual({ ok: false, reason: 'bad_monthly_total' })
  }, 300_000)

  it('refuses a monthly split with no month total to true up to', async () => {
    const none = await inOrg((tx) =>
      saveRecurringDeduction(tx, driverId, {
        type: 'Insurance',
        amountCents: 45_000,
        cadence: 'MONTHLY_SPLIT_WEEKLY',
        effectiveFrom: day(2026, 7, 1),
      }),
    )
    expect(none).toEqual({ ok: false, reason: 'bad_monthly_total' })
  }, 300_000)

  it('refuses a weekly rule that carries one anyway', async () => {
    const stale = await inOrg((tx) =>
      saveRecurringDeduction(tx, driverId, {
        type: 'Admin Fee',
        amountCents: 5_000,
        cadence: 'WEEKLY',
        monthlyTotalCents: 20_000,
        effectiveFrom: day(2026, 7, 1),
      }),
    )
    expect(stale).toEqual({ ok: false, reason: 'bad_monthly_total' })
  }, 300_000)

  it('refuses nothing, and refuses a negative', async () => {
    for (const amountCents of [0, -5_000]) {
      const bad = await inOrg((tx) =>
        saveRecurringDeduction(tx, driverId, {
          type: 'Tolls',
          amountCents,
          cadence: 'WEEKLY',
          effectiveFrom: day(2026, 7, 1),
        }),
      )
      expect(bad).toEqual({ ok: false, reason: 'bad_amount' })
    }
  }, 300_000)

  it('refuses a type nobody has ruled on', async () => {
    const bad = await inOrg((tx) =>
      saveRecurringDeduction(tx, driverId, {
        type: 'Parking',
        amountCents: 5_000,
        cadence: 'WEEKLY',
        effectiveFrom: day(2026, 7, 1),
      }),
    )
    expect(bad).toEqual({ ok: false, reason: 'unknown_type' })
    expect(isDeductionType('Parking')).toBe(false)
    expect(DEDUCTION_TYPES).toContain('Escrow')
  }, 300_000)
})

describe('several deductions at once, which is the normal case', () => {
  // A DRIVER RUNS INSURANCE AND ESCROW AND A LOAN TOGETHER. `saveDriverPayRule`
  // refuses ANY overlap because one pay rule is in force at a time; scoping that
  // rule to the driver here would refuse the second deduction they ever have.
  it('accepts a second type overlapping the first', async () => {
    const insurance = await inOrg((tx) =>
      saveRecurringDeduction(tx, driverId, {
        type: 'Insurance',
        amountCents: 45_000,
        cadence: 'MONTHLY_SPLIT_WEEKLY',
        monthlyTotalCents: 180_000,
        effectiveFrom: day(2026, 8, 1),
      }),
    )
    expect(insurance.ok).toBe(true)

    const escrow = await inOrg((tx) =>
      saveRecurringDeduction(tx, driverId, {
        type: 'Escrow',
        amountCents: 25_000,
        cadence: 'WEEKLY',
        targetCents: 250_000,
        effectiveFrom: day(2026, 8, 1),
      }),
    )
    expect(escrow.ok).toBe(true)
  }, 300_000)

  // ── BUT NOT THE SAME TYPE TWICE ─────────────────────────────────────────
  //
  // Two overlapping `Insurance` rows charge insurance twice, and which figure
  // lands depends on which row is read first.
  it('REFUSES the same type overlapping itself', async () => {
    const again = await inOrg((tx) =>
      saveRecurringDeduction(tx, driverId, {
        type: 'Escrow',
        amountCents: 10_000,
        cadence: 'WEEKLY',
        effectiveFrom: day(2026, 8, 15),
      }),
    )
    expect(again).toEqual({ ok: false, reason: 'overlaps' })
  }, 300_000)

  it('accepts it once the first is closed', async () => {
    const open = await owner.recurringDeduction.findFirstOrThrow({
      where: { driverId, type: 'Escrow', effectiveTo: null },
      select: { id: true },
    })
    const closed = await inOrg((tx) =>
      closeRecurringDeduction(tx, open.id, day(2026, 8, 14)),
    )
    expect(closed).toEqual({ ok: true })

    const after = await inOrg((tx) =>
      saveRecurringDeduction(tx, driverId, {
        type: 'Escrow',
        amountCents: 10_000,
        cadence: 'WEEKLY',
        effectiveFrom: day(2026, 8, 15),
      }),
    )
    expect(after.ok).toBe(true)
  }, 300_000)

  // CLOSING KEEPS THE ROW. A settlement already computed from it printed a line
  // that has to stay explicable, so closing is a date and never a delete.
  it('closes by date rather than deleting, and refuses a date before the start', async () => {
    const row = await owner.recurringDeduction.findFirstOrThrow({
      where: { driverId, type: 'Insurance' },
      select: { id: true, effectiveFrom: true },
    })
    const tooEarly = await inOrg((tx) =>
      closeRecurringDeduction(tx, row.id, day(2026, 6, 1)),
    )
    expect(tooEarly).toEqual({ ok: false, reason: 'bad_dates' })

    const still = await owner.recurringDeduction.findFirst({
      where: { id: row.id },
    })
    expect(still).not.toBeNull()
  }, 300_000)
})

describe('the opening balance a driver brought into the year', () => {
  it('writes every category the statements print, including ADVANCES', async () => {
    for (const category of [
      'EARNINGS',
      'ADVANCES',
      'DEDUCTIONS',
      'NET_PAY',
    ] as const) {
      const saved = await inOrg((tx) =>
        saveOpeningBalance(tx, driverId, {
          year: 2026,
          category,
          amountCents: category === 'DEDUCTIONS' ? -2_294_202 : 24_239_248,
          asOf: day(2026, 7, 31),
          source: 'ST-005352 year-to-date block',
        }),
      )
      expect(saved.ok, `${category} was refused`).toBe(true)
    }
    const rows = await owner.driverOpeningBalance.findMany({
      where: { driverId, year: 2026 },
    })
    expect(rows).toHaveLength(4)
  }, 300_000)

  // ── ENTERING IT TWICE IS A CORRECTION, NOT A SECOND BALANCE ─────────────
  //
  // `@@unique([driverId, year, category])` says so. A create would reach the
  // accountant as a five-hundred; a second row would make the year's opening
  // depend on which was read first.
  it('corrects in place rather than failing the unique or doubling', async () => {
    const again = await inOrg((tx) =>
      saveOpeningBalance(tx, driverId, {
        year: 2026,
        category: 'EARNINGS',
        amountCents: 25_000_000,
        asOf: day(2026, 8, 5),
        source: 'corrected from the September statement',
      }),
    )
    expect(again.ok).toBe(true)

    const rows = await owner.driverOpeningBalance.findMany({
      where: { driverId, year: 2026, category: 'EARNINGS' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amountCents).toBe(25_000_000)
    expect(rows[0]!.source).toContain('corrected')
  }, 300_000)

  // A YEAR-TO-DATE NOBODY CAN TRACE TO A DOCUMENT IS ONE NOBODY CAN DEFEND.
  it('REFUSES a figure with no source', async () => {
    const bad = await inOrg((tx) =>
      saveOpeningBalance(tx, driverId, {
        year: 2026,
        category: 'OTHER_PAY',
        amountCents: 1_000,
        asOf: day(2026, 7, 31),
        source: '   ',
      }),
    )
    expect(bad).toEqual({ ok: false, reason: 'no_source' })
  }, 300_000)

  it('REFUSES a year that is a typo', async () => {
    for (const year of [226, 20_026]) {
      const bad = await inOrg((tx) =>
        saveOpeningBalance(tx, driverId, {
          year,
          category: 'NET_PAY',
          amountCents: 1_000,
          asOf: day(2026, 7, 31),
          source: 'a statement',
        }),
      )
      expect(bad).toEqual({ ok: false, reason: 'bad_year' })
    }
  }, 300_000)

  // DEDUCTIONS ARE NEGATIVE AS THEY PRINT, so a signed figure must survive.
  it('keeps a negative deductions balance negative', async () => {
    const row = await owner.driverOpeningBalance.findFirstOrThrow({
      where: { driverId, year: 2026, category: 'DEDUCTIONS' },
    })
    expect(row.amountCents).toBe(-2_294_202)
  }, 300_000)
})
