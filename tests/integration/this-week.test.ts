import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createLoad } from '@/lib/loads'
import { thisWeekFor, type ThisWeek } from '@/lib/this-week'
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

/**
 * ONE PAGE NOW, so "the company's block" is a filter over the page's lists.
 *
 * Settlement is org-wide by ruling: there is one Ready total, one held list and
 * one blocked list for the whole operation. What used to be a per-company
 * section is a company COLUMN, so these tests narrow the way the screen's
 * filter does rather than looking up a block that no longer exists.
 */
const forCompany = (week: ThisWeek, id: string) => ({
  held: week.held.filter((row) => row.companyId === id),
  blocked: week.blocked.filter((row) => row.companyId === id),
  remittance: week.remittances.find((row) => row.companyId === id) ?? null,
  werner: week.factoring.find((row) => row.companyId === id) ?? null,
})

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
    const company = forCompany(await readWeek(), amazonCompanyId)

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
    const company = forCompany(await readWeek(), amazonCompanyId)
    expect(company.blocked).toHaveLength(1)
    expect(company.blocked[0]!.driverId).toBe(blockedDriverId)
    expect(company.blocked[0]!.driverName).toContain('NORULE')
  }, 300_000)

  it('reports the remittance it found, by invoice number', async () => {
    const company = forCompany(await readWeek(), amazonCompanyId)
    expect(company.remittance?.found).toBe(true)
    expect(company.remittance?.payments[0]?.invoiceNumber).toBe(`INV-${nonce}`)
    expect(company.remittance?.payments[0]?.totalCents).toBe(275_000)
  }, 300_000)

  // THE READY SET IS WHAT BECOMES THE BATCH, AND THE BATCH IS ORG-WIDE.
  //
  // Three loads settle across the whole operation: the matched Amazon load on
  // this authority, and the broker authority's two. The short Amazon load is
  // held, the blocked driver's freight cannot pay, and the closed-history load
  // is not freight at all.
  //
  // THIS NUMBER USED TO BE 1, when Ready was a per-company figure. It is the
  // ruling changing what the screen is counting rather than the count going
  // wrong — so the assertion names every load it expects rather than trusting
  // a total that would also be satisfied by the wrong three.
  it('counts only what would actually settle, across the operation', async () => {
    const week = await readWeek()
    expect(week.ready.loads).toBe(3)
    expect(week.ready.grossCents).toBe(100_000 + 148_806 + 120_000)

    // And the Amazon side of it is exactly the matched load: the short one is
    // held and names itself, which is what keeps this from being a bare sum.
    const amazon = forCompany(week, amazonCompanyId)
    expect(amazon.held).toHaveLength(1)
    expect(amazon.held[0]!.loadId).toBe(shortLoadId)
  }, 300_000)

  // CLOSED HISTORY NEVER APPEARS — not in ready, not in held, not anywhere.
  it('never shows a load closed in Datatruck', async () => {
    const week = await readWeek()
    expect(week.ready.grossCents).not.toBe(877_000)
    expect(week.held.some((row) => row.bookedCents === 777_000)).toBe(false)
  }, 300_000)

  // NO FACTORING SECTION on an authority whose freight settles directly...
  // except this one also carries the blocked driver's broker load, so the
  // section IS present. The pure case is asserted on a company below.
  // ONE BATCH FOR THE ORGANIZATION, so this is a page-level fact now rather
  // than a per-company one.
  it('offers Open batch, because no batch exists for the period yet', async () => {
    const week = await readWeek()
    expect(week.batch.state).toBe('none')
    expect(week.batch.action).toBe('open')
  }, 300_000)
})

describe('the broker authority', () => {
  it('reports filed-unpaid, ready and not-ready with the missing piece', async () => {
    const company = forCompany(await readWeek(), wernerCompanyId)
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
    const company = forCompany(await readWeek(), wernerCompanyId)
    expect(company.remittance).toBeNull()
  }, 300_000)
})

describe('the week a remittance belongs to is what it PAID FOR', () => {
  // Owner's ruling, 2026-09-26. This block used to assert the opposite: that the
  // label Amazon prints is the better answer and the applications are a fallback.
  //
  // THE LABEL IS AMAZON'S PAYMENT PERIOD AND IT SPANS TWO OF OUR WEEKS. The
  // workbook for `Sep 13 - Sep 19` pays that week's freight AND clears held lines
  // from the week before, so one invoice is partly one week's remittance and
  // partly another's. Keying on the label made the screen answer for one of them
  // and silently deny the other.
  it('does NOT find one that only declares the period and paid nothing into it', async () => {
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

    // NOT ONE APPLICATION ON IT. A label is a claim; an application is money
    // landing on a load with a delivery date. Only the second can place a
    // payment in a week.
    const company = forCompany(await readWeek(), amazonCompanyId)
    expect(company.remittance?.payments[0]?.invoiceNumber).not.toBe(
      `DECLARED-${nonce}`,
    )

    await owner.payment.delete({ where: { id: payment.id } })
  }, 300_000)

  // ── THE CASE THE RULING EXISTS FOR ──────────────────────────────────────
  it('DOES find one whose label says another week but which paid into this one', async () => {
    // Tuesday's workbook, in miniature: labelled for the following week, and it
    // clears freight delivered in this one. Under the old question this was
    // invisible for the week it actually paid.
    const settled = await owner.load.findFirst({
      where: {
        companyId: amazonCompanyId,
        stops: {
          some: {
            type: 'DELIVERY',
            scheduledAt: { gte: PERIOD.start, lte: PERIOD.end },
          },
        },
      },
      select: { id: true },
    })
    expect(settled).not.toBeNull()

    const payment = await owner.payment.create({
      data: {
        organizationId,
        companyId: amazonCompanyId,
        customerId: relayId,
        method: 'ACH',
        remittanceKey: `NEXTWEEK-${nonce}`,
        receivedAt: new Date(PERIOD.end.getTime() + 9 * 86_400_000),
        amountCents: 12_345,
        // The label says the FOLLOWING week.
        periodStart: new Date(PERIOD.start.getTime() + 7 * 86_400_000),
        periodEnd: new Date(PERIOD.end.getTime() + 7 * 86_400_000),
        loadApplications: {
          create: {
            organizationId,
            loadId: settled!.id,
            amountCents: 12_345,
          },
        },
      },
    })

    const company = forCompany(await readWeek(), amazonCompanyId)
    expect(company.remittance?.found).toBe(true)
    // AND IT IS THE ONE SHOWN, because `receivedAt` leads the ordering: the most
    // recent cash is what "is the remittance in" is asking about.
    expect(company.remittance?.payments[0]?.invoiceNumber).toBe(
      `NEXTWEEK-${nonce}`,
    )

    await owner.paymentLoadApplication.deleteMany({
      where: { paymentId: payment.id },
    })
    await owner.payment.delete({ where: { id: payment.id } })
  }, 300_000)

  // ── WHICH ONE THE SCREEN NAMES WHEN TWO PAID INTO THE WEEK ──────────────
  //
  // Next Tuesday there will be two: the invoice for this week and the one for
  // the following week that clears this week's held lines. The screen shows one,
  // and ordering them by the LABEL would name the invoice labelled for another
  // week as this week's remittance — the same confusion as keying membership on
  // it, one layer down.
  //
  // THE TWO PAYMENTS BELOW DISAGREE UNDER THE TWO ORDERINGS, which is the only
  // way this can be proven. The first attempt at this test did not: both its
  // payments sorted the same way whichever key led, so breaking the ordering
  // changed nothing and `watch-guard` reported THE BREAK DID NOT FIRE.
  it('names the one whose CASH arrived last, not the one labelled latest', async () => {
    const settled = await owner.load.findFirst({
      where: {
        companyId: amazonCompanyId,
        stops: {
          some: {
            type: 'DELIVERY',
            scheduledAt: { gte: PERIOD.start, lte: PERIOD.end },
          },
        },
      },
      select: { id: true },
    })
    expect(settled).not.toBeNull()

    // Labelled for the FOLLOWING week, cash arrived EARLIER.
    const lateLabel = await owner.payment.create({
      data: {
        organizationId,
        companyId: amazonCompanyId,
        customerId: relayId,
        method: 'ACH',
        remittanceKey: `LATELABEL-${nonce}`,
        receivedAt: new Date(PERIOD.end.getTime() + 5 * 86_400_000),
        amountCents: 1_111,
        periodStart: new Date(PERIOD.start.getTime() + 7 * 86_400_000),
        periodEnd: new Date(PERIOD.end.getTime() + 7 * 86_400_000),
        loadApplications: {
          create: { organizationId, loadId: settled!.id, amountCents: 1_111 },
        },
      },
    })

    // Labelled for THIS week, cash arrived LATER.
    const lateCash = await owner.payment.create({
      data: {
        organizationId,
        companyId: amazonCompanyId,
        customerId: relayId,
        method: 'ACH',
        remittanceKey: `LATECASH-${nonce}`,
        receivedAt: new Date(PERIOD.end.getTime() + 12 * 86_400_000),
        amountCents: 2_222,
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
        loadApplications: {
          create: { organizationId, loadId: settled!.id, amountCents: 2_222 },
        },
      },
    })

    const company = forCompany(await readWeek(), amazonCompanyId)
    // `receivedAt` leads: the most recent cash is what "is the remittance in"
    // asks about. Leading on the label would name LATELABEL instead.
    expect(company.remittance?.payments[0]?.invoiceNumber).toBe(
      `LATECASH-${nonce}`,
    )

    for (const id of [lateLabel.id, lateCash.id]) {
      await owner.paymentLoadApplication.deleteMany({
        where: { paymentId: id },
      })
      await owner.payment.delete({ where: { id } })
    }
  }, 300_000)

  // ── EVERY PAYMENT, NOT ONE ──────────────────────────────────────────────
  //
  // Owner's ruling, 2026-09-26. Two invoices pay into this week: the one for the
  // week and the one for the following week that clears its held lines. The
  // screen lists both, newest cash first, each with its label and the amount it
  // put into THIS period — which is not its ACH total when it spans two weeks.
  it('lists every payment that paid into the week, newest cash first', async () => {
    const settled = await owner.load.findFirst({
      where: {
        companyId: amazonCompanyId,
        stops: {
          some: {
            type: 'DELIVERY',
            scheduledAt: { gte: PERIOD.start, lte: PERIOD.end },
          },
        },
      },
      select: { id: true },
    })
    expect(settled).not.toBeNull()

    const older = await owner.payment.create({
      data: {
        organizationId,
        companyId: amazonCompanyId,
        customerId: relayId,
        method: 'ACH',
        remittanceKey: `OLDCASH-${nonce}`,
        receivedAt: new Date(PERIOD.end.getTime() + 4 * 86_400_000),
        amountCents: 5_000,
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
        loadApplications: {
          create: { organizationId, loadId: settled!.id, amountCents: 5_000 },
        },
      },
    })

    // FREIGHT OUTSIDE THE PERIOD, so the payment below genuinely spans two
    // weeks. Without this the in-period filter on the applications cannot be
    // proven: a payment whose only application is inside the week sums the same
    // whether the filter is there or not, and `watch-guard` said so —
    // THE BREAK DID NOT FIRE.
    const nextWeekLoad = await seedLoad({
      companyId: amazonCompanyId,
      customerId: relayId,
      driverId: paidDriverId,
      rateCents: 82_500,
      deliveredOn: new Date(PERIOD.end.getTime() + 3 * 86_400_000),
    })

    // Labelled for the FOLLOWING week, cash newer, and only PART of its ACH
    // lands in this period — the rest pays the load above.
    const newer = await owner.payment.create({
      data: {
        organizationId,
        companyId: amazonCompanyId,
        customerId: relayId,
        method: 'ACH',
        remittanceKey: `NEWCASH-${nonce}`,
        receivedAt: new Date(PERIOD.end.getTime() + 11 * 86_400_000),
        amountCents: 90_000,
        periodStart: new Date(PERIOD.start.getTime() + 7 * 86_400_000),
        periodEnd: new Date(PERIOD.end.getTime() + 7 * 86_400_000),
        loadApplications: {
          create: [
            { organizationId, loadId: settled!.id, amountCents: 7_500 },
            {
              organizationId,
              loadId: nextWeekLoad.id,
              amountCents: 82_500,
            },
          ],
        },
      },
    })

    const company = forCompany(await readWeek(), amazonCompanyId)
    const keys = company.remittance!.payments.map((row) => row.invoiceNumber)

    // BOTH ARE LISTED, and the newer cash is first.
    expect(keys).toContain(`NEWCASH-${nonce}`)
    expect(keys).toContain(`OLDCASH-${nonce}`)
    expect(keys.indexOf(`NEWCASH-${nonce}`)).toBeLessThan(
      keys.indexOf(`OLDCASH-${nonce}`),
    )

    const shown = company.remittance!.payments.find(
      (row) => row.invoiceNumber === `NEWCASH-${nonce}`,
    )!
    // THE AMOUNT IS WHAT LANDED IN THIS WEEK, not the whole ACH and not the sum
    // of every application it carries. $75.00 here, $825.00 on next week's load,
    // $900.00 of cash — three different numbers, and only the first belongs to
    // this week.
    expect(shown.appliedIntoPeriodCents).toBe(7_500)
    expect(shown.totalCents).toBe(90_000)
    // AND THE LABEL IS SHOWN AS FILED — the following week, not this one.
    expect(shown.labelStart?.getTime()).toBe(
      PERIOD.start.getTime() + 7 * 86_400_000,
    )

    // The authority's figure for the week is the sum of what landed in it.
    expect(company.remittance!.appliedIntoPeriodCents).toBeGreaterThanOrEqual(
      12_500,
    )

    for (const id of [older.id, newer.id]) {
      await owner.paymentLoadApplication.deleteMany({
        where: { paymentId: id },
      })
      await owner.payment.delete({ where: { id } })
    }
  }, 300_000)

  // AND THE ORDINARY CASE IS UNCHANGED.
  it('still finds one with no declared period, through what it paid for', async () => {
    const company = forCompany(await readWeek(), amazonCompanyId)
    expect(company.remittance?.found).toBe(true)
    expect(company.remittance?.payments[0]?.invoiceNumber).toBe(`INV-${nonce}`)
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

    const company = forCompany(await readWeek(), amazonCompanyId)
    expect(company.remittance?.payments[0]?.invoiceNumber).not.toBe(
      `OTHERWEEK-${nonce}`,
    )

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

    const company = forCompany(await readWeek(), wernerCompanyId)
    expect(company.werner!.oldestFiledAt?.toISOString()).toBe(
      filedOn.toISOString(),
    )

    // Touching the row for an unrelated reason must not age the filing.
    await owner.load.update({
      where: { id: filedLoadId },
      data: { internalNotes: `touched ${nonce}` },
    })
    const again = forCompany(await readWeek(), wernerCompanyId)
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
    const company = forCompany(await readWeek(), wernerCompanyId)
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

    const company = forCompany(await readWeek(), pure.id)
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
    const week = await readWeek()
    expect(week.batch.state).toBe('DRAFT')
    expect(week.batch.action).toBe('continue')
    expect(week.batch.id).toBe(opened.batchId)
    expect(week.recent[0]?.id).toBe(opened.batchId)
  }, 300_000)
})

describe('when the remittance is removed', () => {
  it('warns, drops the ready count, and does not crash', async () => {
    // THE DRAFT FROM THE TEST ABOVE HOLDS EVERY SETTLEABLE LOAD, because a
    // batch is org-wide now: opening one consumes the whole operation's
    // freight, not one authority's. So it goes before this measures anything —
    // otherwise "ready dropped" would be true of a week that was already zero.
    //
    // It caught the ruling rather than a defect: this test used to open its
    // batch on the broker authority and leave the Amazon side untouched.
    await owner.settlementBatch.deleteMany({ where: { organizationId } })

    const before = await readWeek()
    expect(before.ready.loads).toBe(3)

    await owner.paymentLoadApplication.deleteMany({
      where: { load: { companyId: amazonCompanyId } },
    })
    await owner.payment.deleteMany({ where: { companyId: amazonCompanyId } })

    const page = await readWeek()
    const after = forCompany(page, amazonCompanyId)
    expect(after.remittance?.found).toBe(false)
    // AN EMPTY LIST, not a null invoice number. `found` and an empty `payments`
    // are the same fact said twice, which is what the screen reads.
    expect(after.remittance?.payments).toEqual([])
    expect(after.remittance?.appliedIntoPeriodCents).toBe(0)

    // BOTH AMAZON LOADS NOW HOLD, with "no remittance" rather than vanishing.
    expect(after.held).toHaveLength(2)
    expect(after.held.every((row) => row.reason === 'no_remittance')).toBe(true)

    // THE READY SET IS THE ORGANIZATION'S. Both Amazon loads now hold and the
    // blocked driver's freight cannot pay, so what remains ready is the broker
    // authority's two — which is the point of the ruling: pulling the Amazon
    // file does not stop the rest of the operation settling.
    expect(page.ready.loads).toBe(2)
    expect(forCompany(page, amazonCompanyId).blocked).toHaveLength(1)
  }, 300_000)
})

describe('a retired authority whose freight is all closed history', () => {
  // BOTH FINDINGS OF 2026-09-11, ON ONE COMPANY. Production carries two such
  // authorities: Midwest Global with 2,108 direct-settled loads and ZERO that
  // are not closed history, and American Soldier with 424 and zero. Before
  // this, each got a remittance row and a no-remittance warning every Tuesday
  // for a file that is never coming — and a warning nobody can clear teaches
  // the person reading this screen that the yellow box means nothing.
  it('gets no remittance section, and says why nothing is ready', async () => {
    const retired = await owner.company.create({
      data: { organizationId, name: `Z Retired ${nonce}` },
    })
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId: retired.id,
        firstName: 'RETIRED',
        lastName: `DRIVER ${nonce}`,
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

    // Amazon freight, delivered in the period, ALL of it closed in Datatruck.
    for (let n = 0; n < 2; n++) {
      const load = await seedLoad({
        companyId: retired.id,
        customerId: relayId,
        driverId: driver.id,
        rateCents: 80_000,
        deliveredOn: new Date(PERIOD.start.getTime() + n * 86_400_000),
      })
      await owner.load.update({
        where: { id: load.id },
        data: { billingStatus: 'CLOSED_IN_DATATRUCK' },
      })
    }

    const page = await readWeek()
    const company = forCompany(page, retired.id)

    // NO REMITTANCE ROW AT ALL — not "no remittance found", which would be a
    // warning about a file nobody is waiting for.
    expect(company.remittance).toBeNull()

    // AND THIS AUTHORITY CONTRIBUTES NOTHING, which on a page-level Ready is
    // asserted as the absence of its rows rather than as a zero of its own.
    expect(company.held).toHaveLength(0)
    expect(company.blocked).toHaveLength(0)

    await owner.load.deleteMany({ where: { companyId: retired.id } })
    await owner.driver.delete({ where: { id: driver.id } })
    await owner.company.delete({ where: { id: retired.id } })
  }, 300_000)

  // THE FACTORING COUNTS ALREADY EXCLUDED CLOSED HISTORY, and this holds them
  // to it: the reading that prompted all this was 17 not-ready on a retired
  // authority, and those seventeen turned out to be UNINVOICED rather than
  // closed. The filter was doing its job; the data was the surprise.
  it('never counts a closed-history load as not-ready to file', async () => {
    const retired = await owner.company.create({
      data: { organizationId, name: `Z Broker ${nonce}` },
    })
    const closed = await seedLoad({
      companyId: retired.id,
      customerId: brokerId,
      driverId: null,
      rateCents: 70_000,
      deliveredOn: new Date(PERIOD.start.getTime() + 86_400_000),
    })
    await owner.load.update({
      where: { id: closed.id },
      data: { billingStatus: 'CLOSED_IN_DATATRUCK' },
    })

    const company = forCompany(await readWeek(), retired.id)
    expect(company.werner).toBeNull()

    // Give it ONE live broker load and the section appears, counting only that.
    const live = await seedLoad({
      companyId: retired.id,
      customerId: brokerId,
      driverId: null,
      rateCents: 60_000,
      deliveredOn: new Date(PERIOD.start.getTime() + 86_400_000),
    })
    const withLive = forCompany(await readWeek(), retired.id)
    expect(withLive.werner!.notReady).toBe(1)
    expect(withLive.werner!.filedUnpaid).toBe(0)

    await owner.load.deleteMany({ where: { id: { in: [closed.id, live.id] } } })
    await owner.company.delete({ where: { id: retired.id } })
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
