import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createLoad } from '@/lib/loads'
import { thisWeekFor, type CompanyWeek } from '@/lib/this-week'
import { openBatch, SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import { payWeekFor, weekOf } from '@/lib/settlement-week'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE TUESDAY SCREEN, ON SEEDED FREIGHT.
//
// Two companies, because half the rules on this page are about which sections a
// company gets: an Amazon authority has a remittance row and no factoring row,
// a broker authority the reverse. One company would let either mistake pass.
//
// EVERY FIGURE IS CHECKED BY NAME, not by count. "held: 1" is true of a screen
// naming the wrong load.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let amazonCompanyId = ''
let wernerCompanyId = ''
let userId = ''
let relayId = ''
let brokerId = ''
let shortLoadId = ''
let matchedLoadId = ''
let notReadyLoadId = ''
let filedLoadId = ''
let blockedDriverId = ''
let idleDriverId = ''
let paidDriverId = ''

const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'this-week.test' },
    timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS,
  })

/** A Tuesday. The period due is the one that ended two Saturdays before. */
const TUESDAY = new Date(Date.UTC(2026, 8, 15))
const { period: PERIOD, payDay: PAY_DAY } = payWeekFor(TUESDAY)

const readWeek = () =>
  inOrg((tx) => thisWeekFor(tx, { period: PERIOD, payDay: PAY_DAY }))

const companyIn = (week: { companies: CompanyWeek[] }, id: string) =>
  week.companies.find((row) => row.companyId === id)!

async function seedLoad(input: {
  companyId: string
  customerId: string
  driverId: string | null
  rateCents: number
  deliveredOn: Date
}) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId: input.companyId,
        customerId: input.customerId,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: input.deliveredOn,
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: input.deliveredOn,
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
      driverId: input.driverId,
      operationalStatus: 'POD_RECEIVED',
      actualMiles: 300,
    },
  })
  return load
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: { name: `Week ${nonce}`, slug: `week-${nonce}` },
  })
  organizationId = organization.id

  const user = await owner.user.create({
    data: { email: `week-${nonce}@example.test`, name: 'Week Reader' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  const amazon = await owner.company.create({
    data: { organizationId, name: `A Dolphins ${nonce}` },
  })
  amazonCompanyId = amazon.id
  const werner = await owner.company.create({
    data: { organizationId, name: `B RAM ${nonce}` },
  })
  wernerCompanyId = werner.id

  const relay = await inOrg((tx) =>
    createBroker(tx, organizationId, { name: `RELAY ${nonce}` }),
  )
  relayId = relay.id
  await owner.customer.update({
    where: { id: relayId },
    data: { settlesDirectly: true },
  })
  const broker = await inOrg((tx) =>
    createBroker(tx, organizationId, { name: `WERNER ${nonce}` }),
  )
  brokerId = broker.id

  // ── the Amazon authority ────────────────────────────────────────────────
  const paid = await owner.driver.create({
    data: {
      organizationId,
      companyId: amazonCompanyId,
      firstName: 'PAID',
      lastName: `DRIVER ${nonce}`,
    },
  })
  paidDriverId = paid.id
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId: paidDriverId,
      type: 'PERCENT_GROSS',
      percentBps: 3000,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    },
  })

  const blocked = await owner.driver.create({
    data: {
      organizationId,
      companyId: amazonCompanyId,
      firstName: 'NORULE',
      lastName: `DRIVER ${nonce}`,
    },
  })
  blockedDriverId = blocked.id

  // AN IDLE OWNER-OPERATOR: no freight, a standing deduction, still a statement.
  const idle = await owner.driver.create({
    data: {
      organizationId,
      companyId: amazonCompanyId,
      firstName: 'IDLE',
      lastName: `OWNER ${nonce}`,
    },
  })
  idleDriverId = idle.id
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId: idleDriverId,
      type: 'PERCENT_GROSS',
      percentBps: 8800,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    },
  })
  await owner.recurringDeduction.create({
    data: {
      organizationId,
      driverId: idleDriverId,
      type: 'Escrow',
      description: 'Security Deposit {split}',
      amountCents: 25_000,
      cadence: 'WEEKLY',
      targetCents: 250_000,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    },
  })

  const inPeriod = new Date(PERIOD.start.getTime() + 2 * 86_400_000)
  const matched = await seedLoad({
    companyId: amazonCompanyId,
    customerId: relayId,
    driverId: paidDriverId,
    rateCents: 100_000,
    deliveredOn: inPeriod,
  })
  const short = await seedLoad({
    companyId: amazonCompanyId,
    customerId: relayId,
    driverId: paidDriverId,
    rateCents: 200_000,
    deliveredOn: inPeriod,
  })
  matchedLoadId = matched.id
  shortLoadId = short.id

  // The blocked driver's own freight — settleable, and with no rule to pay it.
  await seedLoad({
    companyId: amazonCompanyId,
    customerId: brokerId,
    driverId: blockedDriverId,
    rateCents: 90_000,
    deliveredOn: inPeriod,
  })

  // CLOSED HISTORY, which must never appear anywhere on this page.
  const closed = await seedLoad({
    companyId: amazonCompanyId,
    customerId: relayId,
    driverId: paidDriverId,
    rateCents: 777_000,
    deliveredOn: inPeriod,
  })
  await owner.load.update({
    where: { id: closed.id },
    data: { billingStatus: 'CLOSED_IN_DATATRUCK' },
  })

  const payment = await owner.payment.create({
    data: {
      organizationId,
      companyId: amazonCompanyId,
      customerId: relayId,
      method: 'ACH',
      remittanceKey: `INV-${nonce}`,
      receivedAt: new Date(PERIOD.end.getTime() + 3 * 86_400_000),
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

  // ── the broker authority ────────────────────────────────────────────────
  const wernerDriver = await owner.driver.create({
    data: {
      organizationId,
      companyId: wernerCompanyId,
      firstName: 'WERNER',
      lastName: `DRIVER ${nonce}`,
    },
  })
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId: wernerDriver.id,
      type: 'PERCENT_GROSS',
      percentBps: 8800,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    },
  })

  const filed = await seedLoad({
    companyId: wernerCompanyId,
    customerId: brokerId,
    driverId: wernerDriver.id,
    rateCents: 148_806,
    deliveredOn: inPeriod,
  })
  filedLoadId = filed.id
  await owner.load.update({
    where: { id: filedLoadId },
    data: {
      billingStatus: 'FILED_WITH_FACTOR',
      // AS THE ACTION WOULD HAVE WRITTEN IT. `fileWithFactor` sets both in one
      // write; seeding only the status would be seeding a state the application
      // cannot produce.
      filedAt: new Date(Date.UTC(2026, 8, 1, 12)),
    },
  })

  // NOT READY, MISSING ITS BOL — it has the other three pieces.
  const notReady = await seedLoad({
    companyId: wernerCompanyId,
    customerId: brokerId,
    driverId: wernerDriver.id,
    rateCents: 120_000,
    deliveredOn: inPeriod,
  })
  notReadyLoadId = notReady.id
  const invoice = await owner.invoice.create({
    data: {
      organizationId,
      companyId: wernerCompanyId,
      invoiceNumber: `RAM-${nonce}`,
      customerId: brokerId,
      issueDate: new Date(PERIOD.end),
      termsDays: 30,
    },
  })
  await owner.invoiceLine.create({
    data: {
      invoiceId: invoice.id,
      organizationId,
      loadId: notReadyLoadId,
      description: 'Linehaul',
      unitCents: 120_000,
      amountCents: 120_000,
    },
  })
  for (const type of ['POD', 'RATE_CONFIRMATION'] as const) {
    await owner.document.create({
      data: {
        organizationId,
        companyId: wernerCompanyId,
        loadId: notReadyLoadId,
        r2Key: `${organizationId}/${notReadyLoadId}/${type}`,
        filename: `${type}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 512,
        type,
      },
    })
  }
}, 300_000)

afterAll(async () => {
  await owner.$disconnect()
})

describe('the period the screen is about', () => {
  it('is two Saturdays ago, not the week that just closed', () => {
    expect(PERIOD.start.toISOString().slice(0, 10)).toBe('2026-08-30')
    expect(PERIOD.end.toISOString().slice(0, 10)).toBe('2026-09-05')
    expect(PAY_DAY.toISOString().slice(0, 10)).toBe('2026-09-18')
    expect(weekOf(TUESDAY).start.getTime()).not.toBe(PERIOD.start.getTime())
  })
})

describe('the Amazon authority', () => {
  it('names the short line, with both figures, and not the matched one', async () => {
    const company = companyIn(await readWeek(), amazonCompanyId)

    expect(company.held).toHaveLength(1)
    const held = company.held[0]!
    expect(held.loadId).toBe(shortLoadId)
    expect(held.reason).toBe('short')
    expect(held.remittedCents).toBe(175_000)
    expect(held.bookedCents).toBe(200_000)
    expect(held.driverName).toContain('PAID')

    expect(company.held.map((row) => row.loadId)).not.toContain(matchedLoadId)
  }, 300_000)

  it('names the blocked driver rather than skipping him', async () => {
    const company = companyIn(await readWeek(), amazonCompanyId)
    expect(company.blocked).toHaveLength(1)
    expect(company.blocked[0]!.driverId).toBe(blockedDriverId)
    expect(company.blocked[0]!.driverName).toContain('NORULE')
  }, 300_000)

  it('reports the remittance it found, by invoice number', async () => {
    const company = companyIn(await readWeek(), amazonCompanyId)
    expect(company.remittance?.found).toBe(true)
    expect(company.remittance?.invoiceNumber).toBe(`INV-${nonce}`)
    expect(company.remittance?.totalCents).toBe(275_000)
  }, 300_000)

  // THE READY SET IS WHAT BECOMES THE BATCH. The matched Amazon load settles;
  // the short one is held; the closed-history load is not freight at all.
  it('counts only what would actually settle', async () => {
    const company = companyIn(await readWeek(), amazonCompanyId)
    expect(company.ready.loads).toBe(1)
    expect(company.ready.grossCents).toBe(100_000)
  }, 300_000)

  // CLOSED HISTORY NEVER APPEARS — not in ready, not in held, not anywhere.
  it('never shows a load closed in Datatruck', async () => {
    const company = companyIn(await readWeek(), amazonCompanyId)
    expect(company.ready.grossCents).not.toBe(877_000)
    expect(company.held.some((row) => row.bookedCents === 777_000)).toBe(false)
  }, 300_000)

  // NO FACTORING SECTION on an authority whose freight settles directly...
  // except this one also carries the blocked driver's broker load, so the
  // section IS present. The pure case is asserted on a company below.
  it('offers Open batch, because no batch exists for the period yet', async () => {
    const company = companyIn(await readWeek(), amazonCompanyId)
    expect(company.batch.state).toBe('none')
    expect(company.batch.action).toBe('open')
  }, 300_000)
})

describe('the broker authority', () => {
  it('reports filed-unpaid, ready and not-ready with the missing piece', async () => {
    const company = companyIn(await readWeek(), wernerCompanyId)
    expect(company.werner).not.toBeNull()
    expect(company.werner!.filedUnpaid).toBe(1)
    expect(company.werner!.oldestFiledAt).not.toBeNull()
    expect(company.werner!.notReady).toBe(1)
    // NAMED, NEVER COUNTED. "3 of 4" sends somebody to work out which.
    expect(company.werner!.commonestMissing).toBe('the BOL')
  }, 300_000)

  // A BROKER AUTHORITY HAS NO REMITTANCE ROW AT ALL — not "no remittance
  // found", which would be a warning about a file that was never coming.
  it('has no Amazon remittance section', async () => {
    const company = companyIn(await readWeek(), wernerCompanyId)
    expect(company.remittance).toBeNull()
  }, 300_000)
})

describe('the declared work period, and the fallback under it', () => {
  // THE LABEL IS THE BETTER ANSWER. Amazon prints the period in the Payment
  // Summary and `parseWorkPeriod` stores it, so the screen asks the remittance
  // what week it is FOR rather than inferring it from what it touched.
  it('finds a remittance by the period it declares', async () => {
    const payment = await owner.payment.create({
      data: {
        organizationId,
        companyId: amazonCompanyId,
        customerId: relayId,
        method: 'ACH',
        remittanceKey: `DECLARED-${nonce}`,
        receivedAt: new Date(PERIOD.end.getTime() + 3 * 86_400_000),
        amountCents: 42_000,
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
      },
    })

    // NOT ONE APPLICATION ON IT. Under the old question this payment was
    // invisible — which is the gap the columns close: a remittance that paid
    // nothing in the period is still that period's remittance.
    const company = companyIn(await readWeek(), amazonCompanyId)
    expect(company.remittance?.found).toBe(true)
    expect(company.remittance?.invoiceNumber).toBe(`DECLARED-${nonce}`)

    await owner.payment.delete({ where: { id: payment.id } })
  }, 300_000)

  // AND THE FALLBACK STILL WORKS, which is what makes the columns safe to add:
  // every payment already in the database has no period, and dropping the old
  // question would have made this week's remittance vanish for all of them.
  it('still finds one with no declared period, through what it paid for', async () => {
    const company = companyIn(await readWeek(), amazonCompanyId)
    expect(company.remittance?.found).toBe(true)
    expect(company.remittance?.invoiceNumber).toBe(`INV-${nonce}`)
  }, 300_000)

  it('ignores a remittance that declares a different week', async () => {
    const other = await owner.payment.create({
      data: {
        organizationId,
        companyId: amazonCompanyId,
        customerId: relayId,
        method: 'ACH',
        remittanceKey: `OTHERWEEK-${nonce}`,
        receivedAt: new Date(PERIOD.end.getTime() + 3 * 86_400_000),
        amountCents: 9_900,
        periodStart: new Date(PERIOD.start.getTime() - 7 * 86_400_000),
        periodEnd: new Date(PERIOD.end.getTime() - 7 * 86_400_000),
      },
    })

    const company = companyIn(await readWeek(), amazonCompanyId)
    expect(company.remittance?.invoiceNumber).not.toBe(`OTHERWEEK-${nonce}`)

    await owner.payment.delete({ where: { id: other.id } })
  }, 300_000)
})

describe('when a packet was filed', () => {
  // `filedAt` IS WRITTEN BY THE ACTION, and the screen reads it rather than
  // `updatedAt` — which was right on the day a load was filed and drifted every
  // time anything else touched the row.
  it('reports the date the action recorded, not the row last change', async () => {
    const filedOn = new Date(Date.UTC(2026, 8, 1, 12))
    await owner.load.update({
      where: { id: filedLoadId },
      data: { filedAt: filedOn },
    })

    const company = companyIn(await readWeek(), wernerCompanyId)
    expect(company.werner!.oldestFiledAt?.toISOString()).toBe(
      filedOn.toISOString(),
    )

    // Touching the row for an unrelated reason must not age the filing.
    await owner.load.update({
      where: { id: filedLoadId },
      data: { internalNotes: `touched ${nonce}` },
    })
    const again = companyIn(await readWeek(), wernerCompanyId)
    expect(again.werner!.oldestFiledAt?.toISOString()).toBe(
      filedOn.toISOString(),
    )
  }, 300_000)

  // A LOAD FILED BEFORE THE COLUMN EXISTED HAS NONE, and is skipped rather
  // than counted as filed today. Backfilling from `updatedAt` would have
  // manufactured a history that reads like a record.
  it('skips a filing with no recorded date rather than dating it now', async () => {
    await owner.load.update({
      where: { id: filedLoadId },
      data: { filedAt: null },
    })
    const company = companyIn(await readWeek(), wernerCompanyId)
    expect(company.werner!.filedUnpaid).toBe(1)
    expect(company.werner!.oldestFiledAt).toBeNull()
  }, 300_000)
})

describe('a company with only direct-settled freight', () => {
  // THE GUARD THE BRIEF NAMES: the factoring section must not appear where
  // nothing is ever invoiced or factored.
  it('has no factoring section', async () => {
    const pure = await owner.company.create({
      data: { organizationId, name: `C Relay-only ${nonce}` },
    })
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId: pure.id,
        firstName: 'ONLY',
        lastName: `RELAY ${nonce}`,
      },
    })
    await owner.driverPayRule.create({
      data: {
        organizationId,
        driverId: driver.id,
        type: 'PERCENT_GROSS',
        percentBps: 3000,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    })
    await seedLoad({
      companyId: pure.id,
      customerId: relayId,
      driverId: driver.id,
      rateCents: 50_000,
      deliveredOn: new Date(PERIOD.start.getTime() + 86_400_000),
    })

    const company = companyIn(await readWeek(), pure.id)
    expect(company.werner).toBeNull()
    expect(company.remittance).not.toBeNull()

    await owner.load.deleteMany({ where: { companyId: pure.id } })
    await owner.driver.delete({ where: { id: driver.id } })
    await owner.company.delete({ where: { id: pure.id } })
  }, 300_000)
})

describe('opening the batch from this screen', () => {
  it('lands on a DRAFT with the prefilled dates', async () => {
    const opened = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        companyId: wernerCompanyId,
        period: PERIOD,
        statementDate: TUESDAY,
        checkDate: PAY_DAY,
      }),
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const batch = await owner.settlementBatch.findUniqueOrThrow({
      where: { id: opened.batchId },
      select: {
        status: true,
        periodStart: true,
        periodEnd: true,
        statementDate: true,
        checkDate: true,
        settlements: { select: { id: true } },
      },
    })
    expect(batch.status).toBe('DRAFT')
    expect(batch.periodStart.getTime()).toBe(PERIOD.start.getTime())
    expect(batch.statementDate.toISOString().slice(0, 10)).toBe('2026-09-15')
    // CHECK DATE = PERIOD END + 13, the Friday the money moves (§0).
    expect(batch.checkDate.toISOString().slice(0, 10)).toBe('2026-09-18')
    // Drafted on creation, so there is something to read.
    expect(batch.settlements.length).toBeGreaterThan(0)

    // AND THE SCREEN NOW OFFERS THE NEXT ACTION, not the same one again.
    const company = companyIn(await readWeek(), wernerCompanyId)
    expect(company.batch.state).toBe('DRAFT')
    expect(company.batch.action).toBe('continue')
    expect(company.batch.id).toBe(opened.batchId)
    expect(company.recent[0]?.id).toBe(opened.batchId)
  }, 300_000)
})

describe('when the remittance is removed', () => {
  it('warns, drops the ready count, and does not crash', async () => {
    const before = companyIn(await readWeek(), amazonCompanyId)
    expect(before.ready.loads).toBe(1)

    await owner.paymentLoadApplication.deleteMany({
      where: { load: { companyId: amazonCompanyId } },
    })
    await owner.payment.deleteMany({ where: { companyId: amazonCompanyId } })

    const after = companyIn(await readWeek(), amazonCompanyId)
    expect(after.remittance?.found).toBe(false)
    expect(after.remittance?.invoiceNumber).toBeNull()

    // BOTH AMAZON LOADS NOW HOLD, with "no remittance" rather than vanishing.
    expect(after.held).toHaveLength(2)
    expect(after.held.every((row) => row.reason === 'no_remittance')).toBe(true)

    // The ready set drops to nothing for this company: its only other freight
    // belongs to the driver with no pay rule, who blocks rather than settles.
    expect(after.ready.loads).toBe(0)
    expect(after.blocked).toHaveLength(1)
  }, 300_000)
})

describe('the page never renders a PDF', () => {
  // `filingStatesForCompany` is the light read: rows and `packetReadiness`.
  // A summary that rendered a packet per load to find out whether it was ready
  // would fetch from R2 to answer a question the rows already answer — and R2
  // refuses to run inside a transaction, so it would throw rather than be slow.
  it('reads the whole page inside one transaction, which R2 would forbid', async () => {
    const week = await readWeek()
    expect(week.companies.length).toBeGreaterThan(0)
    expect(week.timings.engine).toBeGreaterThanOrEqual(0)
  }, 300_000)
})
