import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { companyScopeFilter, withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { transitionOperational } from '@/lib/load-status'
import { createLoad, LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  batchInputForOrg,
  openBatch,
  SETTLEMENT_BATCH_TIMEOUT_MS,
} from '@/lib/settlement-batch'
import { computeBatch, weekOf } from '@/lib/settlement-week'
import { weekBatch, weekTrouble } from '@/lib/payroll'
import { readBatches } from '@/lib/accounting-grids'
import { pipelineStrip } from '@/lib/accounting-reports'
import { readGridColumns } from '@/lib/grid-columns'
import { readPayrollBatchesPage } from '@/lib/payroll-batches-page'
import { createPrismaClient, statementsOf } from '@/lib/db'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// /payroll/batches IN FOUR STATEMENTS AND SEVEN STREAMED (§6.2.9 v11.01).
//
// TWO CLAIMS, EACH HELD TO WHAT IT REPLACED:
//
// 1. The page's one-row statement returns what the six reads it replaced
//    return — `weekBatch`, the opened-weeks read, `readBatches`,
//    `pipelineStrip` and the stored column row — unscoped and scoped to one
//    authority, and it is ONE statement.
// 2. The blockers strip's gross-only engine read (`netPay: false`) names the
//    same blockers and the same held lines as the full read, and costs at
//    most four statements.
//
// EVERY SIDE IS SEEDED ABOVE EMPTY: a batch whose breakdown has two
// authorities (so the scope has something to narrow), two batch states (so
// the strip has two figures), a stored column row, a blocked driver, a held
// line, and recurring deductions on a paid driver and an idle one (so the
// full read genuinely reads more than the gross half). Agreement between two
// empty answers proves nothing.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let alphaId = ''
let betaId = ''
let userId = ''
let paidDriver = ''
let blockedDriver = ''
let idleDriver = ''
let relayId = ''
let wernerId = ''
const nonce = Math.random().toString(36).slice(2, 8)

/** The week of 2026-08-16. */
const PERIOD = weekOf(new Date(Date.UTC(2026, 7, 19)))
const OFFERED = [
  weekOf(new Date(Date.UTC(2026, 7, 26))),
  PERIOD,
  weekOf(new Date(Date.UTC(2026, 7, 12))),
  weekOf(new Date(Date.UTC(2026, 7, 5))),
]
const PAID_WEEK = weekOf(new Date(Date.UTC(2026, 7, 5)))
/**
 * The week of 2026-08-23, which has NO batch: the strip's engine path reads
 * only unbatched freight, so its cases run here, where the paid driver's
 * loads still need the pay rule. (On PERIOD they sit in the draft batch and
 * a strip that read no rules at all would pass — watched, 2026-11-14.)
 */
const TROUBLE_WEEK = weekOf(new Date(Date.UTC(2026, 7, 26)))

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'payroll-page.test' },
    timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

async function seedLoad(input: {
  number: string
  rateCents: number
  customerId: string
  companyId: string
  driverId: string
  delDay: number
}) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId: input.companyId,
        customerId: input.customerId,
        referenceNumber: `${input.number}-${nonce}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: new Date(Date.UTC(2026, 7, input.delDay)),
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: new Date(Date.UTC(2026, 7, input.delDay)),
          },
        ],
        linehaulCents: input.rateCents,
      },
      { byUserId: userId },
    ),
  )
  await owner.load.update({
    where: { id: load.id },
    data: { driverId: input.driverId, actualMiles: 400 },
  })
  // THE POD IS AN EVENT, dated at the delivery, as settlement-batch.test.ts
  // seeds it — the settleable predicate wants the status and the event.
  await inOrg((tx) =>
    transitionOperational(tx, load.id, 'POD_RECEIVED', {
      source: 'INTEGRATION',
      occurredAt: new Date(Date.UTC(2026, 7, input.delDay)),
    }),
  )
  return load
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Payroll page ${nonce}`,
      slug: `payroll-page-${nonce}`,
      maxCompanies: 3,
      companies: {
        create: [{ name: `Alpha ${nonce}` }, { name: `Beta ${nonce}` }],
      },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  alphaId = organization.companies.find((c) => c.name.startsWith('Alpha'))!.id
  betaId = organization.companies.find((c) => c.name.startsWith('Beta'))!.id

  const user = await owner.user.create({
    data: { email: `payroll-page-${nonce}@example.test`, name: 'Page Reader' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  const driver = (first: string, companyId: string) =>
    owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: first,
        lastName: `Page ${nonce}`,
        hireDate: new Date(Date.UTC(2026, 0, 5)),
      },
    })
  paidDriver = (await driver('Paid', alphaId)).id
  blockedDriver = (await driver('Blocked', betaId)).id
  idleDriver = (await driver('Idle', alphaId)).id

  // ONLY THE PAID DRIVER HAS A RULE: the blocked one is the no_pay_rule case.
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId: paidDriver,
      type: 'PERCENT_GROSS',
      percentBps: 3000,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    },
  })
  // DEDUCTIONS ON A PAID DRIVER AND AN IDLE ONE — what the full read reads
  // and the gross half does not.
  for (const driverId of [paidDriver, idleDriver]) {
    await owner.recurringDeduction.create({
      data: {
        organizationId,
        driverId,
        type: 'Escrow',
        description: 'Escrow',
        amountCents: 10_000,
        cadence: 'WEEKLY',
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    })
  }

  relayId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `RELAY ${nonce}` }),
    )
  ).id
  await owner.customer.update({
    where: { id: relayId },
    data: { settlesDirectly: true },
  })
  wernerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `WERNER ${nonce}` }),
    )
  ).id

  // Paid freight on BOTH authorities, so the breakdown has two rows.
  await seedLoad({
    number: 'W-ALPHA',
    rateCents: 150_000,
    customerId: wernerId,
    companyId: alphaId,
    driverId: paidDriver,
    delDay: 17,
  })
  await seedLoad({
    number: 'W-BETA',
    rateCents: 90_000,
    customerId: wernerId,
    companyId: betaId,
    driverId: paidDriver,
    delDay: 18,
  })
  // A direct-settling customer with no remittance yet: a HELD line.
  await seedLoad({
    number: 'R-HELD',
    rateCents: 100_000,
    customerId: relayId,
    companyId: alphaId,
    driverId: paidDriver,
    delDay: 19,
  })
  // A driver with freight and no rule: a BLOCKER.
  await seedLoad({
    number: 'W-BLOCK',
    rateCents: 120_000,
    customerId: wernerId,
    companyId: betaId,
    driverId: blockedDriver,
    delDay: 19,
  })

  // THE UNBATCHED WEEK: paid, blocked and held freight, never batched.
  await seedLoad({
    number: 'T-PAID',
    rateCents: 130_000,
    customerId: wernerId,
    companyId: alphaId,
    driverId: paidDriver,
    delDay: 25,
  })
  await seedLoad({
    number: 'T-BLOCK',
    rateCents: 110_000,
    customerId: wernerId,
    companyId: betaId,
    driverId: blockedDriver,
    delDay: 26,
  })
  await seedLoad({
    number: 'T-HELD',
    rateCents: 70_000,
    customerId: relayId,
    companyId: alphaId,
    driverId: paidDriver,
    delDay: 27,
  })

  const opened = await inOrg((tx) =>
    openBatch(tx, {
      organizationId,
      period: PERIOD,
      statementDate: PERIOD.end,
    }),
  )
  if (!opened.ok) throw new Error(`openBatch: ${JSON.stringify(opened)}`)

  // A SECOND STATE for the strip: a PAID batch with one settlement.
  await inOrg(async (tx) => {
    const batch = await tx.settlementBatch.create({
      data: {
        organizationId,
        status: 'PAID',
        periodStart: PAID_WEEK.start,
        periodEnd: PAID_WEEK.end,
        statementDate: PAID_WEEK.end,
        checkDate: PAID_WEEK.end,
      },
    })
    await tx.settlement.create({
      data: {
        organizationId,
        companyId: alphaId,
        driverId: paidDriver,
        batchId: batch.id,
        settlementNumber: `PP-${nonce}`,
        status: 'PAID',
        periodStart: PAID_WEEK.start,
        periodEnd: PAID_WEEK.end,
        grossCents: 200_000,
        deductionsCents: 20_000,
        netCents: 181_000,
      },
    })
    // AND ONE ON BETA, so the strip scoped to Alpha differs from unscoped.
    await tx.settlement.create({
      data: {
        organizationId,
        companyId: betaId,
        driverId: blockedDriver,
        batchId: batch.id,
        settlementNumber: `PP-${nonce}-B`,
        status: 'PAID',
        periodStart: PAID_WEEK.start,
        periodEnd: PAID_WEEK.end,
        grossCents: 50_000,
        deductionsCents: 5_000,
        netCents: 46_000,
      },
    })
  })

  // A STORED COLUMN ROW, in the current shape (no legacy rewrite).
  await owner.userPreference.create({
    data: {
      organizationId,
      userId,
      key: 'columns.payroll.batches',
      value: { hidden: ['notes'] },
    },
  })
}, 600_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

const pageInput = (companyScopes: string[], batchesTab = true) => ({
  organizationId,
  userId,
  companyScopes,
  period: PERIOD,
  offered: OFFERED,
  batchesTab,
  grid: batchesTab
    ? ('payroll.batches' as const)
    : ('payroll.balances' as const),
})

describe('the page reads in one statement', () => {
  it.each([
    ['unscoped', () => [] as string[]],
    ['scoped to Alpha', () => [alphaId]],
  ])(
    'agrees with the six reads it replaced, %s',
    async (_label, scopesOf) => {
      const scopes = scopesOf()
      const { one, perRead } = await inOrg(async (tx) => ({
        one: await readPayrollBatchesPage(tx, pageInput(scopes)),
        perRead: {
          week: await weekBatch(tx, { organizationId, period: PERIOD }),
          opened: (
            await tx.settlementBatch.findMany({
              where: {
                organizationId,
                deletedAt: null,
                periodStart: { in: OFFERED.map((w) => w.start) },
              },
              select: { periodStart: true },
            })
          ).map((row) => row.periodStart.getTime()),
          batches: await readBatches(tx, companyScopeFilter(scopes)),
          pipeline: await pipelineStrip(tx, scopes),
          columnsRow: await tx.userPreference.findFirst({
            where: { userId, key: 'columns.payroll.batches' },
            select: { value: true, organizationId: true },
          }),
        },
      }))

      expect(one.week).toEqual(perRead.week)
      expect([...one.opened].sort()).toEqual([...perRead.opened].sort())
      expect(one.batches).toEqual(perRead.batches)
      expect(one.pipeline).toEqual(perRead.pipeline)
      expect(one.columnsRow).toEqual(perRead.columnsRow)

      // NOT EMPTY ON EITHER SIDE.
      expect(one.week).not.toBeNull()
      expect(one.opened).toHaveLength(2)
      expect(one.batches).toHaveLength(2)
      expect(one.pipeline!.draftCents).toBeGreaterThan(0)
      expect(one.pipeline!.paidCents).toBeGreaterThan(0)
      expect(one.columnsRow).not.toBeNull()
      const draft = one.batches.find((b) => b.status === 'DRAFT')!
      // THE SCOPE NARROWS THE BREAKDOWN, NOT THE BATCH (readBatches' rule).
      expect(draft.breakdown).toHaveLength(scopes.length === 0 ? 2 : 1)
    },
    300_000,
  )

  it('on Balances, the grid and the strip are not read', async () => {
    const one = await inOrg((tx) =>
      readPayrollBatchesPage(tx, pageInput([], false)),
    )
    expect(one.batches).toEqual([])
    expect(one.pipeline).toBeNull()
    expect(one.week).not.toBeNull()
    expect(one.columnsRow).toBeNull() // no balances preference stored
  }, 300_000)

  it('is ONE statement, and the columns from its row cost none', async () => {
    const client = createPrismaClient(process.env.DIRECT_DATABASE_URL!)
    try {
      const counts = await client.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`
          const atRead = statementsOf(client)!
          const reads = await readPayrollBatchesPage(tx, pageInput([]))
          const read = statementsOf(client)! - atRead
          const atColumns = statementsOf(client)!
          const columns = await readGridColumns(
            tx,
            userId,
            'payroll.batches',
            ['batchNumber', 'status', 'notes'],
            [],
            { row: reads.columnsRow },
          )
          return {
            read,
            columns: statementsOf(client)! - atColumns,
            visible: columns,
            batches: reads.batches.length,
          }
        },
        { maxWait: 20_000, timeout: LOAD_WRITE_TIMEOUT_MS },
      )
      expect(counts.read).toBe(1)
      expect(counts.columns).toBe(0)
      // The stored row was USED: `notes` is hidden by it.
      expect(counts.visible).not.toContain('notes')
      expect(counts.batches).toBe(2)
    } finally {
      await client.$disconnect()
    }
  }, 300_000)
})

describe('the blockers strip reads the gross half', () => {
  it('names the same blockers and held lines as the full engine read', async () => {
    const { strip, full } = await inOrg(async (tx) => ({
      strip: await weekTrouble(tx, {
        organizationId,
        period: TROUBLE_WEEK,
        batchId: null,
        batchStatus: null,
      }),
      full: computeBatch({
        period: TROUBLE_WEEK,
        statementDate: TROUBLE_WEEK.end,
        checkDate: TROUBLE_WEEK.end,
        drivers: await batchInputForOrg(tx, {
          organizationId,
          period: TROUBLE_WEEK,
          statementDate: TROUBLE_WEEK.end,
          checkDate: TROUBLE_WEEK.end,
        }),
      }),
    }))

    const byDriver = <T extends { driverId: string }>(rows: T[]) =>
      [...rows].sort((a, b) => a.driverId.localeCompare(b.driverId))
    expect(byDriver(strip.blockers).map((b) => b.driverId)).toEqual(
      byDriver(full.blockers).map((b) => b.driverId),
    )
    expect(strip.heldCount).toBe(full.held.length)
    expect(strip.heldSumCents).toBe(
      full.held.reduce((sum, row) => sum + row.line.rateCents, 0),
    )
    // NOT EMPTY: one blocked driver, one held line — and the paid driver's
    // freight was priced, so the rule was read and used.
    expect(strip.blockers.map((b) => b.driverId)).toEqual([blockedDriver])
    expect(strip.heldCount).toBe(1)
    expect(strip.fromStored).toBe(false)
    const paid = full.settlements.find((s) => s.driverId === paidDriver)
    expect(paid?.lines.length ?? 0).toBeGreaterThan(0)
  }, 300_000)

  it('costs at most four statements inside its transaction', async () => {
    const client = createPrismaClient(process.env.DIRECT_DATABASE_URL!)
    try {
      const { count, blockers } = await client.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`
          const before = statementsOf(client)!
          const trouble = await weekTrouble(tx, {
            organizationId,
            period: TROUBLE_WEEK,
            batchId: null,
            batchStatus: null,
          })
          return {
            count: statementsOf(client)! - before,
            blockers: trouble.blockers.length,
          }
        },
        { maxWait: 20_000, timeout: SETTLEMENT_BATCH_TIMEOUT_MS },
      )
      // loads, drivers, pay rules, settlement charges. The full read is
      // twelve.
      expect(count).toBeLessThanOrEqual(4)
      expect(blockers).toBe(1)
    } finally {
      await client.$disconnect()
    }
  }, 300_000)
})
