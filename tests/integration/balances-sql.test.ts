import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { tenantReader, txReader, withOrg, type TxClient } from '@/lib/tenancy'
import { readBalances, type BalanceGridRow } from '@/lib/accounting-grids'
import { readPayrollBatchesPage } from '@/lib/payroll-batches-page'
import { weekOf } from '@/lib/settlement-week'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { createPrismaClient, prisma, statementsOf } from '@/lib/db'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE BALANCES GRID IN ONE STATEMENT (§6.2.9 v11.06).
//
// 1. `balancesSql`, through `readBalances`, equals the three Prisma reads and
//    the name lookup it replaced (`balancesByPrisma` below is that code, kept
//    here as the reference), row by row, for the year with rows and a year
//    with none.
// 2. The payroll page's one call carries the same rows on the Balances tab.
// 3. Through the tenant reader, as `zebra_app` outside any transaction, that
//    call is ONE statement, and another organization's settlement, opening
//    balance and escrow are in no row.
//
// EVERY RULE HAS A ROW ON BOTH SIDES OF IT: FINAL and PAID batches counted,
// a DRAFT batch not; last year's batch not; a deleted settlement and a
// deleted batch not; a deleted driver not listed; the NET_PAY opening
// balance counted and an EARNINGS one not; escrow summed across entries.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let otherOrgId = ''
let userId = ''
const drivers: Record<string, string> = {}
const nonce = Math.random().toString(36).slice(2, 8)
const YEAR = 2026

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'balances-sql.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

/** The code `balancesSql` replaced, verbatim in its reads. */
async function balancesByPrisma(
  tx: TxClient,
  year: number,
): Promise<BalanceGridRow[]> {
  const from = new Date(Date.UTC(year, 0, 1))
  const to = new Date(Date.UTC(year + 1, 0, 1))
  const [rows, opening, escrow] = await Promise.all([
    tx.settlement.groupBy({
      by: ['driverId'],
      where: {
        deletedAt: null,
        batch: {
          deletedAt: null,
          status: { in: ['FINAL', 'PAID'] },
          periodStart: { gte: from, lt: to },
        },
      },
      _sum: { earningsCents: true, deductionsCents: true, netCents: true },
      _count: { _all: true },
    }),
    tx.driverOpeningBalance.findMany({
      where: { year, category: 'NET_PAY' },
      select: { driverId: true, amountCents: true },
    }),
    tx.driverEscrowEntry.groupBy({
      by: ['driverId'],
      _sum: { amountCents: true },
    }),
  ])
  const names = await tx.driver.findMany({
    where: { deletedAt: null, id: { in: rows.map((row) => row.driverId) } },
    select: { id: true, firstName: true, lastName: true },
  })
  const nameOf = new Map(
    names.map((row) => [row.id, `${row.firstName} ${row.lastName}`]),
  )
  const openingOf = new Map(opening.map((r) => [r.driverId, r.amountCents]))
  const escrowOf = new Map(
    escrow.map((r) => [r.driverId, r._sum.amountCents ?? 0]),
  )
  return rows
    .filter((row) => nameOf.has(row.driverId))
    .map((row) => {
      const openingNetCents = openingOf.get(row.driverId) ?? 0
      const netCents = row._sum.netCents ?? 0
      return {
        driverId: row.driverId,
        driverName: nameOf.get(row.driverId) ?? '',
        year,
        openingNetCents,
        grossCents: row._sum.earningsCents ?? 0,
        deductionsCents: row._sum.deductionsCents ?? 0,
        netCents,
        weeks: row._count._all,
        ytdNetCents: openingNetCents + netCents,
        escrowHeldCents: escrowOf.get(row.driverId) ?? 0,
      }
    })
}

const byDriver = (rows: BalanceGridRow[]) =>
  [...rows].sort((a, b) => a.driverId.localeCompare(b.driverId))

const WEEKS = [5, 12, 19, 26].map((day) =>
  weekOf(new Date(Date.UTC(YEAR, 6, day))),
)

const pageInput = (orgId: string) => ({
  organizationId: orgId,
  userId,
  companyScopes: [] as string[],
  period: WEEKS[0]!,
  offered: WEEKS,
  batchesTab: false,
  grid: 'payroll.balances' as const,
  balancesYear: YEAR,
})

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const user = await owner.user.create({
    data: { email: `balances-${nonce}@example.test`, name: 'Balances' },
  })
  userId = user.id

  let serial = 0
  const seedOrg = async (name: string) => {
    const org = await owner.organization.create({
      data: {
        name: `${name} ${nonce}`,
        slug: `${name.toLowerCase()}-${nonce}`,
        companies: { create: [{ name: `${name} Carrier ${nonce}` }] },
      },
      include: { companies: true },
    })
    const companyId = org.companies[0]!.id
    const driver = async (first: string, extra: Record<string, unknown> = {}) =>
      (
        await owner.driver.create({
          data: {
            organizationId: org.id,
            companyId,
            firstName: first,
            lastName: `Bal ${nonce}`,
            hireDate: new Date(Date.UTC(YEAR, 0, 5)),
            ...extra,
          },
        })
      ).id
    const batch = async (
      week: { start: Date; end: Date },
      status: 'DRAFT' | 'FINAL' | 'PAID',
      deletedAt: Date | null = null,
    ) =>
      (
        await owner.settlementBatch.create({
          data: {
            organizationId: org.id,
            periodStart: week.start,
            periodEnd: week.end,
            statementDate: week.end,
            checkDate: week.end,
            status,
            deletedAt,
          },
        })
      ).id
    const settle = async (
      driverId: string,
      batchId: string,
      week: { start: Date; end: Date },
      cents: { earnings: number; deductions: number },
      deletedAt: Date | null = null,
    ) => {
      serial += 1
      await owner.settlement.create({
        data: {
          organizationId: org.id,
          companyId,
          settlementNumber: `B-${nonce}-${serial}`,
          driverId,
          batchId,
          periodStart: week.start,
          periodEnd: week.end,
          earningsCents: cents.earnings,
          deductionsCents: cents.deductions,
          netCents: cents.earnings - cents.deductions,
          teamWith: [],
          referralWith: [],
          deletedAt,
        },
      })
    }
    return { org, companyId, driver, batch, settle }
  }

  const a = await seedOrg('Balances')
  organizationId = a.org.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
  drivers.Ann = await a.driver('Ann')
  drivers.Bob = await a.driver('Bob')
  drivers.Gone = await a.driver('Gone', { deletedAt: new Date() })
  drivers.Idle = await a.driver('Idle')

  const final1 = await a.batch(WEEKS[0]!, 'FINAL')
  const paid2 = await a.batch(WEEKS[1]!, 'PAID')
  const draft3 = await a.batch(WEEKS[2]!, 'DRAFT')
  const deleted4 = await a.batch(WEEKS[3]!, 'FINAL', new Date())
  const lastYearWeek = weekOf(new Date(Date.UTC(YEAR - 1, 6, 5)))
  const lastYear = await a.batch(lastYearWeek, 'FINAL')

  await a.settle(drivers.Ann, final1, WEEKS[0]!, {
    earnings: 100_000,
    deductions: 20_000,
  })
  await a.settle(drivers.Ann, paid2, WEEKS[1]!, {
    earnings: 90_000,
    deductions: 10_000,
  })
  await a.settle(drivers.Ann, draft3, WEEKS[2]!, {
    earnings: 50_000,
    deductions: 0,
  })
  await a.settle(drivers.Ann, deleted4, WEEKS[3]!, {
    earnings: 70_000,
    deductions: 0,
  })
  await a.settle(drivers.Ann, lastYear, lastYearWeek, {
    earnings: 40_000,
    deductions: 0,
  })
  await a.settle(drivers.Bob, final1, WEEKS[0]!, {
    earnings: 80_000,
    deductions: 5_000,
  })
  await a.settle(
    drivers.Bob,
    paid2,
    WEEKS[1]!,
    { earnings: 60_000, deductions: 0 },
    new Date(),
  )
  await a.settle(drivers.Gone, final1, WEEKS[0]!, {
    earnings: 30_000,
    deductions: 0,
  })

  for (const [driverId, category, amountCents] of [
    [drivers.Ann, 'NET_PAY', 12_345],
    [drivers.Ann, 'EARNINGS', 99_999],
    [drivers.Bob, 'NET_PAY', -500],
  ] as const) {
    await owner.driverOpeningBalance.create({
      data: {
        organizationId,
        driverId,
        year: YEAR,
        category,
        amountCents,
        asOf: new Date(Date.UTC(YEAR, 0, 1)),
        source: 'balances-sql.test',
      },
    })
  }
  for (const [driverId, amountCents] of [
    [drivers.Ann, 5_000],
    [drivers.Ann, 2_500],
    [drivers.Idle, 1_000],
  ] as const) {
    await owner.driverEscrowEntry.create({
      data: { organizationId, driverId, amountCents, occurredAt: new Date() },
    })
  }

  // ANOTHER ORGANIZATION, a FINAL settlement in the same week, an opening
  // balance and escrow, so a read that escaped its tenant would list them.
  const b = await seedOrg('BalancesOther')
  otherOrgId = b.org.id
  drivers.Other = await b.driver('Other')
  const otherBatch = await b.batch(WEEKS[0]!, 'FINAL')
  await b.settle(drivers.Other, otherBatch, WEEKS[0]!, {
    earnings: 777_000,
    deductions: 0,
  })
  await owner.driverOpeningBalance.create({
    data: {
      organizationId: otherOrgId,
      driverId: drivers.Other,
      year: YEAR,
      category: 'NET_PAY',
      amountCents: 4_242,
      asOf: new Date(Date.UTC(YEAR, 0, 1)),
      source: 'balances-sql.test',
    },
  })
  await owner.driverEscrowEntry.create({
    data: {
      organizationId: otherOrgId,
      driverId: drivers.Other,
      amountCents: 9_000,
      occurredAt: new Date(),
    },
  })
}, 300_000)

afterAll(async () => {
  await owner?.$disconnect()
})

describe('the balances grid in one statement', () => {
  it('equals the reads it replaced, for a year with rows and a year without', async () => {
    for (const year of [YEAR, YEAR - 2]) {
      const [one, reference] = await inOrg(
        async (tx) =>
          [
            await readBalances(tx, {}, year),
            await balancesByPrisma(tx, year),
          ] as const,
      )
      expect(byDriver(one), String(year)).toEqual(byDriver(reference))
    }
    // NOT VACUOUS: every rule above has its row.
    const rows = await inOrg((tx) => readBalances(tx, {}, YEAR))
    expect(byDriver(rows)).toEqual(
      byDriver([
        {
          driverId: drivers.Ann!,
          driverName: `Ann Bal ${nonce}`,
          year: YEAR,
          openingNetCents: 12_345,
          grossCents: 190_000,
          deductionsCents: 30_000,
          netCents: 160_000,
          weeks: 2,
          ytdNetCents: 172_345,
          escrowHeldCents: 7_500,
        },
        {
          driverId: drivers.Bob!,
          driverName: `Bob Bal ${nonce}`,
          year: YEAR,
          openingNetCents: -500,
          grossCents: 80_000,
          deductionsCents: 5_000,
          netCents: 75_000,
          weeks: 1,
          ytdNetCents: 74_500,
          escrowHeldCents: 0,
        },
      ]),
    )
  }, 300_000)

  it('rides in the payroll page’s one call on the Balances tab', async () => {
    const [page, own] = await inOrg(
      async (tx) =>
        [
          await readPayrollBatchesPage(txReader(tx), pageInput(organizationId)),
          await readBalances(tx, {}, YEAR),
        ] as const,
    )
    expect(page.balances).toEqual(own)
    expect(page.balances).toHaveLength(2)
    expect(page.batches).toEqual([])
    expect(page.pipeline).toBeNull()
  }, 300_000)

  it('is ONE statement through the tenant reader, and reads nothing of another organization', async () => {
    const client = createPrismaClient(process.env.DATABASE_URL!)
    try {
      const at = statementsOf(client)!
      const page = await readPayrollBatchesPage(
        tenantReader(client, organizationId),
        pageInput(organizationId),
      )
      expect(statementsOf(client)! - at).toBe(1)
      expect(page.balances.map((row) => row.driverId).sort()).toEqual(
        [drivers.Ann!, drivers.Bob!].sort(),
      )
    } finally {
      await client.$disconnect()
    }
    const theirs = await readPayrollBatchesPage(
      tenantReader(prisma, otherOrgId),
      pageInput(otherOrgId),
    )
    expect(theirs.balances).toEqual([
      expect.objectContaining({
        driverId: drivers.Other,
        grossCents: 777_000,
        openingNetCents: 4_242,
        escrowHeldCents: 9_000,
      }),
    ])
  }, 300_000)
})
