import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createLoad } from '@/lib/loads'
import {
  batchInputForOrg,
  batchNumberOf,
  finaliseBatch,
  markBatchPaid,
  refreshDraft,
  statementNumberOf,
  SETTLEMENT_BATCH_TIMEOUT_MS,
  openBatch,
} from '@/lib/settlement-batch'
import { weekOf } from '@/lib/settlement-week'
import { renderStatementPdf } from '@/lib/statement-pdf'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE LIVE PATH, ON SEEDED FREIGHT.
//
// The second half of item 3's acceptance, and deliberately the WHOLE path:
// seeded loads, a remittance with one matched_exact and one short, a batch, the
// short named as held, dispatch confirming it, FINAL, the PDF read back out of
// its own bytes, and a second batch that cannot see the settled loads.
//
// `tests/settlement-week.test.ts` grades the arithmetic against six real
// statements. Nothing here re-checks arithmetic; what it checks is everything
// the database is responsible for — which loads are visible, what a number
// series does, when the escrow ledger moves, and what FINAL refuses.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let driverId = ''
let amazonId = ''
let brokerId = ''

const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'settlement-batch.test' },
    timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS,
  })

/** The week of 2026-08-16, which is the period two real statements cover. */
const PERIOD = weekOf(new Date(Date.UTC(2026, 7, 19)))

async function seedLoad(input: {
  number: string
  rateCents: number
  customerId: string
  delDay: number
  /** Defaults to the suite's own authority. Set for cross-authority freight. */
  companyId?: string
}) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        // CREATED ON THE RIGHT AUTHORITY rather than moved onto it: a lint rule
        // forbids reassigning `companyId` by column, because an asset's
        // authority is a period and `transferAsset` is what opens and closes
        // those. A load seeded in the wrong place and corrected is exactly the
        // shape that rule exists to stop.
        companyId: input.companyId ?? companyId,
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
    data: {
      driverId,
      operationalStatus: 'POD_RECEIVED',
      actualMiles: 400,
    },
  })
  return load
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: { name: `Batch ${nonce}`, slug: `batch-${nonce}` },
  })
  organizationId = organization.id

  const company = await owner.company.create({
    data: {
      organizationId,
      name: `RAM ${nonce}`,
      addressLine1: '5062 Free Pike',
      city: 'Dayton',
      state: 'OH',
      postalCode: '45426',
    },
  })
  companyId = company.id

  const user = await owner.user.create({
    data: { email: `batch-${nonce}@example.test`, name: 'Batch Runner' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  const driver = await owner.driver.create({
    data: {
      organizationId,
      companyId,
      firstName: 'JERRY ROBERT',
      lastName: 'MCKANE',
      // A SYNTHETIC LAG, TO EXERCISE THE FIELD — not a fact about this driver.
      //
      // The real MCKANE's lag is 0, like everyone's: the company pays two
      // weeks behind uniformly, and that lives in the batch's typed check date
      // (MONEY-DESIGN §0, Islom 2026-09-11). An earlier reading of the ruling
      // put a 1 here as if it were his property, and this comment is the
      // correction rather than a deletion — the arithmetic still has to work
      // the day one driver genuinely is paid on a different schedule.
      payoutLagWeeks: 1,
    },
  })
  driverId = driver.id

  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId,
      type: 'PERCENT_GROSS',
      percentBps: 3000,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    },
  })

  const amazon = await inOrg((tx) =>
    createBroker(tx, organizationId, { name: `RELAY ${nonce}` }),
  )
  amazonId = amazon.id
  await owner.customer.update({
    where: { id: amazonId },
    data: { settlesDirectly: true },
  })

  const broker = await inOrg((tx) =>
    createBroker(tx, organizationId, { name: `WERNER ${nonce}` }),
  )
  brokerId = broker.id
}, 300_000)

afterAll(async () => {
  await owner.$disconnect()
})

describe('a week of freight becomes a batch', () => {
  let batchId = ''
  let shortLoadId = ''
  let matchedLoadId = ''
  let brokerLoadId = ''

  it('seeds two Amazon loads and one broker load, and remits against them', async () => {
    const matched = await seedLoad({
      number: 'AMZ-MATCH',
      rateCents: 100_000,
      customerId: amazonId,
      delDay: 17,
    })
    const short = await seedLoad({
      number: 'AMZ-SHORT',
      rateCents: 200_000,
      customerId: amazonId,
      delDay: 18,
    })
    const werner = await seedLoad({
      number: 'WER-1',
      rateCents: 148_806,
      customerId: brokerId,
      delDay: 19,
    })
    matchedLoadId = matched.id
    shortLoadId = short.id
    brokerLoadId = werner.id

    // THE REMITTANCE, as the importer writes it: a payment with an application
    // per load. One pays the rate exactly; one pays $250 less.
    const payment = await owner.payment.create({
      data: {
        organizationId,
        companyId,
        customerId: amazonId,
        method: 'ACH',
        receivedAt: new Date(Date.UTC(2026, 7, 21)),
        amountCents: 275_000,
      },
    })
    await owner.paymentLoadApplication.createMany({
      data: [
        {
          paymentId: payment.id,
          loadId: matched.id,
          organizationId,
          amountCents: 100_000,
        },
        {
          paymentId: payment.id,
          loadId: short.id,
          organizationId,
          amountCents: 175_000,
        },
      ],
    })
  }, 300_000)

  it('drafts the batch and names the short line as held', async () => {
    const batch = await owner.settlementBatch.create({
      data: {
        organizationId,
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
        statementDate: new Date(Date.UTC(2026, 7, 25)),
        checkDate: new Date(Date.UTC(2026, 7, 27)),
      },
    })
    batchId = batch.id

    const refreshed = await inOrg((tx) => refreshDraft(tx, batchId))
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return

    // The matched Amazon load and the broker load settle; the short one does
    // not, and it is NAMED rather than quietly left out.
    const settlement = refreshed.result.settlements[0]!
    expect(settlement.lines.map((line) => line.basis).sort()).toEqual([
      'rate',
      'remitted',
    ])
    expect(refreshed.result.held).toHaveLength(1)
    expect(refreshed.result.held[0]!.line.reason.kind).toBe('short')
    expect(refreshed.result.held[0]!.line.loadId).toBe(shortLoadId)

    // AND THE PERCENTAGE IS OF THE REMITTED FIGURE, not the booked rate.
    const amazonLine = settlement.lines.find(
      (line) => line.basis === 'remitted',
    )
    expect(amazonLine!.grossCents).toBe(100_000)
    expect(amazonLine!.amountCents).toBe(30_000)

    // A HELD LINE DOES NOT BLOCK. It is a line left out of a statement that is
    // otherwise correct; next week's batch takes it once somebody confirms.
    expect(refreshed.result.canFinalise).toBe(true)
  }, 300_000)

  it('settles the held line once dispatch confirms what it pays on', async () => {
    await owner.load.update({
      where: { id: shortLoadId },
      data: {
        settledGrossCents: 175_000,
        settledGrossConfirmedAt: new Date(),
        settledGrossConfirmedById: userId,
      },
    })

    const refreshed = await inOrg((tx) => refreshDraft(tx, batchId))
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect(refreshed.result.held).toHaveLength(0)

    const settlement = refreshed.result.settlements[0]!
    const confirmed = settlement.lines.find(
      (line) => line.loadId === shortLoadId,
    )
    // 30% OF THE CONFIRMED $1,750 — never of the booked $2,000.
    expect(confirmed!.grossCents).toBe(175_000)
    expect(confirmed!.amountCents).toBe(52_500)
  }, 300_000)

  it('finalises, allocating one SB- and one ST- from the shared series', async () => {
    const before = await owner.driverEscrowEntry.count({ where: { driverId } })

    const outcome = await inOrg((tx) => finaliseBatch(tx, batchId, userId))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.batchNumber).toMatch(/^SB-\d{6}$/)

    const batch = await owner.settlementBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { status: true, batchNumber: true },
    })
    expect(batch.status).toBe('FINAL')

    const settlements = await owner.settlement.findMany({ where: { batchId } })
    expect(settlements).toHaveLength(1)
    expect(settlements[0]!.settlementNumber).toMatch(/^ST-\d{6}$/)
    expect(settlements[0]!.payTariffLabel).toBe('30% from gross')

    // THE PAYOUT DATE CARRIES WHATEVER LAG THE DRIVER HAS, frozen at FINAL.
    // This fixture's is 1 to prove the arithmetic; in production every driver
    // is 0 and this equals the batch's own check date.
    expect(settlements[0]!.payoutDate?.toISOString().slice(0, 10)).toBe(
      '2026-09-03',
    )

    // No escrow rule here, so the ledger must NOT have moved.
    expect(await owner.driverEscrowEntry.count({ where: { driverId } })).toBe(
      before,
    )
  }, 300_000)

  it('reads the statement back out of its own bytes', async () => {
    const settlement = await owner.settlement.findFirstOrThrow({
      where: { batchId },
      include: {
        loadLines: { orderBy: { sortOrder: 'asc' } },
        deductionLines: true,
        batch: true,
        company: true,
        driver: true,
      },
    })

    const pdf = renderStatementPdf({
      statementNumber: settlement.settlementNumber,
      batchNumber: settlement.batch!.batchNumber!,
      company: { name: settlement.company.name, address: 'Dayton, OH' },
      driverName: `${settlement.driver.firstName} ${settlement.driver.lastName}`,
      unitNumber: settlement.unitNumber,
      payTariffLabel: settlement.payTariffLabel,
      statementDate: settlement.batch!.statementDate,
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
      checkDate: settlement.payoutDate!,
      loads: settlement.loadLines,
      totals: {
        grossCents: settlement.grossCents,
        milesHundredths: settlement.milesHundredths,
        amountCents: settlement.earningsCents,
      },
      deductions: settlement.deductionLines.filter((l) => l.totalCents < 0),
      otherPay: settlement.deductionLines.filter((l) => l.totalCents > 0),
      summary: {
        earningsCents: settlement.earningsCents,
        advancesCents: settlement.advancesCents,
        reimbursementsCents: settlement.reimbursementsCents,
        deductionsCents: settlement.deductionsCents,
        otherPayCents: settlement.otherPayCents,
        netCents: settlement.netCents,
      },
      ytd: {
        earningsCents: settlement.earningsCents,
        advancesCents: 0,
        reimbursementsCents: 0,
        deductionsCents: 0,
        otherPayCents: 0,
        netCents: settlement.netCents,
      },
      ytdFromPeriodStart: settlement.periodStart,
    })

    const text = new TextDecoder('latin1').decode(pdf)
    // THE VERBATIM LABELS, from the artefact.
    for (const label of [
      'Driver Pay Settlement',
      'Statement Date:',
      'Period Start:',
      'Check Date:',
      'Payment tariff:',
      'Load number',
      'Total amount',
      'Net Pay:',
    ]) {
      expect(text, label).toContain(label)
    }
    expect(text).toContain(settlement.settlementNumber)
    expect(text).toContain('30% from gross')
    // THE DRIVER'S OWN CHECK DATE, with his lag on it.
    expect(text).toContain('9/3/2026')
    // YTD IS LABELLED BY ITS PERIOD when there is no opening balance, rather
    // than claiming a year it does not cover.
    expect(text).toContain('since 8/16/2026')
    expect(text).not.toContain('YTD Net Pay')

    // THREE LOADS, ONE PER LINE, and the section's own total.
    expect(settlement.loadLines).toHaveLength(3)
    for (const line of settlement.loadLines) {
      expect(text).toContain(line.loadNumber)
    }
  }, 300_000)

  it('is invisible to a second batch — a load settles once', async () => {
    const second = await owner.settlementBatch.create({
      data: {
        organizationId,
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
        statementDate: new Date(Date.UTC(2026, 7, 25)),
        checkDate: new Date(Date.UTC(2026, 7, 27)),
      },
    })

    const refreshed = await inOrg((tx) => refreshDraft(tx, second.id))
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return

    const lines = refreshed.result.settlements.flatMap(
      (settlement) => settlement.lines,
    )
    expect(lines.map((line) => line.loadId)).not.toContain(matchedLoadId)
    expect(lines.map((line) => line.loadId)).not.toContain(brokerLoadId)
    expect(lines).toHaveLength(0)
  }, 300_000)

  it('refuses to recompute a batch that is no longer a draft', async () => {
    const refreshed = await inOrg((tx) => refreshDraft(tx, batchId))
    expect(refreshed.ok).toBe(false)
    if (refreshed.ok) return
    expect(refreshed.reason.kind).toBe('not_draft')
  }, 300_000)

  it('moves FINAL to PAID when a person says so', async () => {
    const outcome = await inOrg((tx) => markBatchPaid(tx, batchId, userId))
    expect(outcome.ok).toBe(true)
    expect(
      (
        await owner.settlementBatch.findUniqueOrThrow({
          where: { id: batchId },
          select: { status: true },
        })
      ).status,
    ).toBe('PAID')
  }, 300_000)
})

describe('what a batch refuses to do', () => {
  it('blocks by name when a driver has freight and no pay rule', async () => {
    const bare = await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'NO',
        lastName: `RULE ${nonce}`,
      },
    })
    const load = await seedLoad({
      number: 'NORULE',
      rateCents: 100_000,
      customerId: brokerId,
      delDay: 26,
    })
    await owner.load.update({
      where: { id: load.id },
      data: { driverId: bare.id },
    })

    const period = weekOf(new Date(Date.UTC(2026, 7, 26)))
    const batch = await owner.settlementBatch.create({
      data: {
        organizationId,
        periodStart: period.start,
        periodEnd: period.end,
        statementDate: new Date(Date.UTC(2026, 8, 2)),
        checkDate: new Date(Date.UTC(2026, 8, 4)),
      },
    })

    const refreshed = await inOrg((tx) => refreshDraft(tx, batch.id))
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return

    // NAMED, NOT SKIPPED. The driver appears, with the reason.
    expect(refreshed.result.canFinalise).toBe(false)
    const blocker = refreshed.result.blockers.find((row) =>
      row.driverName.includes('RULE'),
    )
    expect(blocker).toBeDefined()
    expect(blocker!.blocker.kind).toBe('no_pay_rule')

    // AND FINAL REFUSES. The screen's check is not the promise; this is.
    const outcome = await inOrg((tx) => finaliseBatch(tx, batch.id, userId))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason.kind).toBe('blocked')

    await owner.settlementBatch.delete({ where: { id: batch.id } })
    await owner.load.delete({ where: { id: load.id } })
    await owner.driver.delete({ where: { id: bare.id } })
  }, 300_000)

  // CLOSED HISTORY NEVER ENTERS A BATCH. `SETTLEABLE_LOAD` is the one
  // definition of settleable and this is the half of it that matters most:
  // years of imported Datatruck freight sits in the same table.
  it('never sees a load closed in Datatruck', async () => {
    const closed = await seedLoad({
      number: 'CLOSED',
      rateCents: 90_000,
      customerId: brokerId,
      delDay: 12,
    })
    await owner.load.update({
      where: { id: closed.id },
      data: { billingStatus: 'CLOSED_IN_DATATRUCK' },
    })

    const period = weekOf(new Date(Date.UTC(2026, 7, 12)))
    const drivers = await inOrg((tx) =>
      batchInputForOrg(tx, {
        organizationId,
        period,
        statementDate: new Date(Date.UTC(2026, 7, 18)),
        checkDate: new Date(Date.UTC(2026, 7, 20)),
      }),
    )
    const seen = drivers.flatMap((driver) =>
      driver.loads.map((load) => load.id),
    )
    expect(seen).not.toContain(closed.id)

    await owner.load.delete({ where: { id: closed.id } })
  }, 300_000)

  // THE DATABASE REFUSES THE SECOND ONE, not the code. A driver paid twice for
  // one load is money out of the door that reconciles against nothing.
  it('refuses a second settlement line for the same load', async () => {
    const settlement = await owner.settlement.findFirstOrThrow({
      where: { driverId },
      select: { id: true, loadLines: { select: { loadId: true } } },
    })
    const loadId = settlement.loadLines[0]!.loadId

    await expect(
      owner.settlementLoadLine.create({
        data: {
          settlementId: settlement.id,
          organizationId,
          // THE SAME DRIVER, which is what the unique still refuses.
          driverId,
          loadId,
          loadNumber: 'DUPLICATE',
          companyId,
          companyName: 'Duplicate Co',
          puPlace: 'A',
          delPlace: 'B',
          puDate: new Date(),
          delDate: new Date(),
          grossCents: 1,
          milesHundredths: 1,
          amountCents: 1,
          settledBasis: 'rate',
        },
      }),
    ).rejects.toThrow()
  }, 300_000)
})

describe('escrow moves at FINAL and only at FINAL', () => {
  it('leaves the ledger alone through every draft refresh', async () => {
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'ESCROW',
        lastName: `HOLDER ${nonce}`,
      },
    })
    await owner.driverPayRule.create({
      data: {
        organizationId,
        driverId: driver.id,
        type: 'PERCENT_GROSS',
        percentBps: 8800,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    })
    await owner.recurringDeduction.create({
      data: {
        organizationId,
        driverId: driver.id,
        type: 'Escrow',
        description: 'Security Deposit {split}',
        amountCents: 25_000,
        cadence: 'WEEKLY',
        targetCents: 250_000,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    })

    const period = weekOf(new Date(Date.UTC(2026, 8, 9)))
    const batch = await owner.settlementBatch.create({
      data: {
        organizationId,
        periodStart: period.start,
        periodEnd: period.end,
        statementDate: new Date(Date.UTC(2026, 8, 16)),
        checkDate: new Date(Date.UTC(2026, 8, 18)),
      },
    })

    // AN IDLE OWNER-OPERATOR STILL GETS A STATEMENT. No loads this week, and
    // the escrow still accrues.
    for (let refresh = 0; refresh < 3; refresh++) {
      const refreshed = await inOrg((tx) => refreshDraft(tx, batch.id))
      expect(refreshed.ok).toBe(true)
      expect(
        await owner.driverEscrowEntry.count({ where: { driverId: driver.id } }),
      ).toBe(0)
    }

    const outcome = await inOrg((tx) => finaliseBatch(tx, batch.id, userId))
    expect(outcome.ok).toBe(true)

    const entries = await owner.driverEscrowEntry.findMany({
      where: { driverId: driver.id },
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.amountCents).toBe(25_000)

    const settlement = await owner.settlement.findFirstOrThrow({
      where: { batchId: batch.id },
    })
    // NEGATIVE NET IS PRINTED AND FLAGGED, never clamped.
    expect(settlement.netCents).toBe(-25_000)
  }, 300_000)
})

describe('one batch per period, for the whole operation', () => {
  // THE RULING, ENFORCED BY THE ACTION AND NOT BY THE DATABASE.
  //
  // There is deliberately no unique on (organizationId, periodStart): a held
  // line confirmed after FINAL has to land somewhere, and post-FINAL money is a
  // next-week line by a ruling that still stands. A constraint would make the
  // recovery path impossible rather than merely discouraged — so `openBatch`
  // refuses, by name, and hands back the batch that already covers the week.
  it('refuses a second batch and names the one that exists', async () => {
    const period = weekOf(new Date(Date.UTC(2026, 10, 4)))
    const first = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period,
        statementDate: new Date(Date.UTC(2026, 10, 10)),
        checkDate: new Date(Date.UTC(2026, 10, 13)),
      }),
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period,
        statementDate: new Date(Date.UTC(2026, 10, 10)),
        checkDate: new Date(Date.UTC(2026, 10, 13)),
      }),
    )
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason.kind).toBe('period_taken')
    // IT HANDS BACK THE ONE THAT EXISTS, so the screen links rather than
    // reporting a collision somebody has to go and find.
    if (second.reason.kind !== 'period_taken') return
    expect(second.reason.batchId).toBe(first.batchId)
    expect(second.reason.status).toBe('DRAFT')

    // AND THE DATABASE STILL ALLOWS ONE, which is what keeps the recovery path
    // open. Watched by inserting directly rather than through the action.
    const direct = await owner.settlementBatch.create({
      data: {
        organizationId,
        periodStart: period.start,
        periodEnd: period.end,
        statementDate: new Date(Date.UTC(2026, 10, 10)),
        checkDate: new Date(Date.UTC(2026, 10, 13)),
      },
      select: { id: true },
    })
    expect(direct.id).toBeTruthy()

    await owner.settlementBatch.deleteMany({
      where: { id: { in: [first.batchId, direct.id] } },
    })
  }, 300_000)

  // ONE BATCH COVERS EVERY AUTHORITY. The sister companies are one operation,
  // so a driver of either gets a statement under the same SB- number.
  it('settles both authorities under one batch and one number', async () => {
    const second = await owner.company.create({
      data: { organizationId, name: `Sister ${nonce}` },
    })
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId: second.id,
        firstName: 'SISTER',
        lastName: `DRIVER ${nonce}`,
      },
    })
    await owner.driverPayRule.create({
      data: {
        organizationId,
        driverId: driver.id,
        type: 'PERCENT_GROSS',
        percentBps: 5000,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    })
    const period = weekOf(new Date(Date.UTC(2026, 10, 18)))
    const load = await seedLoad({
      number: 'SISTER',
      rateCents: 200_000,
      customerId: brokerId,
      delDay: 18,
      companyId: second.id,
    })
    await owner.load.update({
      where: { id: load.id },
      data: { driverId: driver.id },
    })
    await owner.loadStop.updateMany({
      where: { loadId: load.id },
      data: { scheduledAt: new Date(period.start.getTime() + 86_400_000) },
    })

    const opened = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period,
        statementDate: new Date(Date.UTC(2026, 10, 24)),
        checkDate: new Date(Date.UTC(2026, 10, 27)),
      }),
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const outcome = await inOrg((tx) =>
      finaliseBatch(tx, opened.batchId, userId),
    )
    expect(outcome.ok).toBe(true)

    const settlements = await owner.settlement.findMany({
      where: { batchId: opened.batchId },
      select: { companyId: true, settlementNumber: true },
    })
    // The sister authority's driver is in the same batch as everyone else.
    expect(settlements.some((row) => row.companyId === second.id)).toBe(true)
    // ONE SB- NUMBER for all of them, which is the ruling.
    const batch = await owner.settlementBatch.findUniqueOrThrow({
      where: { id: opened.batchId },
      select: { batchNumber: true },
    })
    expect(batch.batchNumber).toMatch(/^SB-\d{6}$/)

    // THE BATCH GOES FIRST. `SettlementLoadLine_loadId_fkey` is RESTRICT, so a
    // settled load cannot be deleted while its line exists — which is the
    // constraint working, and is why this teardown cascades through the batch
    // rather than reaching for the load.
    await owner.settlementBatch.delete({ where: { id: opened.batchId } })
    await owner.load.delete({ where: { id: load.id } })
    await owner.driver.delete({ where: { id: driver.id } })
  }, 300_000)
})

describe('the number series', () => {
  it('runs across both carriers rather than per carrier', async () => {
    const second = await owner.company.create({
      data: { organizationId, name: `Dolphins ${nonce}` },
    })

    const batchOf = async (companyIdFor: string, weekDay: number) => {
      const period = weekOf(new Date(Date.UTC(2026, 9, weekDay)))
      const created = await owner.settlementBatch.create({
        data: {
          organizationId,
          periodStart: period.start,
          periodEnd: period.end,
          statementDate: new Date(Date.UTC(2026, 9, weekDay + 6)),
          checkDate: new Date(Date.UTC(2026, 9, weekDay + 8)),
        },
      })
      const outcome = await inOrg((tx) => finaliseBatch(tx, created.id, userId))
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) throw new Error('not finalised')
      return outcome.batchNumber
    }

    // RAM, then Dolphins, then RAM — the artefact's own pattern. The numbers
    // must ASCEND ACROSS the two, not restart for each.
    const first = await batchOf(companyId, 4)
    const middle = await batchOf(second.id, 11)
    const third = await batchOf(companyId, 18)

    const value = (number: string) => Number(number.slice(3))
    expect(value(middle)).toBe(value(first) + 1)
    expect(value(third)).toBe(value(middle) + 1)
  }, 300_000)

  it('formats the two series as the artefact prints them', () => {
    expect(batchNumberOf(436)).toBe('SB-000436')
    expect(statementNumberOf(5284)).toBe('ST-005284')
  })
})
