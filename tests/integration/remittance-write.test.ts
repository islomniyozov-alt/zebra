import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { writeRemittance } from '@/lib/amazon/remittance-write'
import type { RemittanceReading } from '@/lib/amazon/remittance'
import type { FreightRef } from '@/lib/amazon/remittance-preview'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE WRITE HALF, AND THE ONE THING IT MUST NOT DO.
//
// ── THE ACCEPTANCE IS SMALL BECAUSE THE EVIDENCE IS SMALL ────────────────
//
// Six real weeks produced 881 payable units and only 5 are live —
// matched_exact 3 and over 2, $7,446.35 between them. Everything else is
// closed history. So the acceptance set is those five shapes, plus the
// refusal that covers the other 847.
//
// ── AND THE REFUSAL IS WATCHED FAILING ───────────────────────────────────
//
// A closed-history unit in the SAME workbook as a live one must write nothing
// at all: no Payment share, no application, no accessorial. That is asserted
// from both ends — the row counts are zero, and the money is left unapplied on
// the Payment rather than quietly vanishing.
//
// Then the flag is removed and the same fixture is run again, and the unit
// writes. A test that only ever saw closed history would pass just as happily
// against a writer that wrote nothing at all, ever.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let customerId = ''
let userId = ''

const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'remittance-write.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: LOAD_WRITE_TIMEOUT_MS,
  })

/** A reading with one tour and one single load, shaped like the real file. */
const reading = (): RemittanceReading =>
  ({
    summary: {
      carrier: 'RAM HAULAGE LLC',
      scac: 'ABFQZ',
      invoiceNumber: `AZNG-TEST-${nonce}`,
      invoiceDate: 'Sep 8, 2026',
      invoiceTotalCents: 200000,
      workPeriod: 'Aug 30 - Sep 5, 2026',
      paymentStatus: 'Paid',
      paymentDate: 'Sep 9, 2026',
      workType: 'SPOT',
      payTerm: 'Net 7',
      adjustments: [],
      adjustmentTotalCents: 0,
    },
    rows: [
      {
        at: 2,
        invoiceNumber: `AZNG-TEST-${nonce}`,
        tripId: null,
        loadId: 'LIVE-1',
        itemType: 'LOAD - COMPLETED',
        item: { scope: 'LOAD', outcome: 'COMPLETED' },
        money: {
          'Base Rate': 40000,
          'Fuel Surcharge': 5000,
          Tolls: 0,
          Detention: 0,
          TONU: 0,
          Others: 0,
        },
        grossCents: 45000,
        startDate: 'Sep 1, 2026',
        endDate: 'Sep 1, 2026',
        route: 'A->B',
      },
      {
        at: 3,
        invoiceNumber: `AZNG-TEST-${nonce}`,
        tripId: null,
        loadId: 'CLOSED-1',
        itemType: 'LOAD - COMPLETED',
        item: { scope: 'LOAD', outcome: 'COMPLETED' },
        money: {
          'Base Rate': 90000,
          'Fuel Surcharge': 12000,
          Tolls: 3000,
          Detention: 0,
          TONU: 0,
          Others: 0,
        },
        grossCents: 105000,
        startDate: 'Sep 2, 2026',
        endDate: 'Sep 2, 2026',
        route: 'C->D',
      },
    ],
    footer: [],
    census: { counts: [], unrecognised: [], adjustments: [] },
    dormantColumnsSeen: [],
    totals: {
      bodyCents: 150000,
      headerCents: 200000,
      footerCents: 150000,
      perColumn: {},
    },
  }) as RemittanceReading

let liveLoadId = ''
let closedLoadId = ''

const freight = (closedIsClosed: boolean): Map<string, FreightRef[]> =>
  new Map([
    [
      'LIVE-1',
      [
        {
          id: liveLoadId,
          loadNumber: 'L1',
          reference: 'LIVE-1',
          totalRevenueCents: 45000,
          closedHistory: false,
        },
      ],
    ],
    [
      'CLOSED-1',
      [
        {
          id: closedLoadId,
          loadNumber: 'L2',
          reference: 'CLOSED-1',
          totalRevenueCents: 105000,
          closedHistory: closedIsClosed,
        },
      ],
    ],
  ])

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Remittance ${nonce}`,
      slug: `remittance-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: { email: `remit-${nonce}@example.test`, name: 'Remittance Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  customerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Amazon ${nonce}` }),
    )
  ).id

  const make = async (reference: string, cents: number) => {
    const load = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId,
          customerId,
          referenceNumber: reference,
          stops: [
            {
              type: 'PICKUP',
              city: 'Chicago',
              state: 'IL',
              scheduledAt: new Date(Date.UTC(2026, 8, 1)),
            },
            {
              type: 'DELIVERY',
              city: 'Dallas',
              state: 'TX',
              scheduledAt: new Date(Date.UTC(2026, 8, 2)),
            },
          ],
          linehaulCents: cents,
        },
        { byUserId: userId },
      ),
    )
    return load.id
  }

  liveLoadId = await make('LIVE-1', 45000)
  closedLoadId = await make('CLOSED-1', 105000)
}, 300_000)

afterAll(async () => {
  await owner.$disconnect()
})

describe('a closed-history unit beside a live one', () => {
  it('writes for the live unit and nothing at all for the closed one', async () => {
    const result = await inOrg((tx) =>
      writeRemittance(tx, {
        organizationId,
        companyId,
        customerId,
        reading: reading(),
        freightByReference: freight(true),
        receivedAt: new Date(Date.UTC(2026, 8, 9)),
        recordedByUserId: userId,
      }),
    )

    expect(result.alreadyImported).toBe(false)
    expect(result.appliedUnits).toBe(1)
    expect(result.appliedCents).toBe(45000)
    expect(result.skippedClosedHistory).toBe(1)

    // THE PAYMENT IS THE ACH, not the sum of what was matched. The closed
    // unit's money stays unapplied and visible rather than disappearing.
    const payment = await owner.payment.findUniqueOrThrow({
      where: { id: result.paymentId },
      select: { amountCents: true, unappliedCents: true },
    })
    expect(payment.amountCents).toBe(200000)
    expect(payment.unappliedCents).toBe(155000)

    // NOTHING ON THE CLOSED LOAD. Both relations asserted, because "no
    // application" and "no accessorial" are different ways to touch a load.
    const closedApplications = await owner.paymentLoadApplication.count({
      where: { loadId: closedLoadId },
    })
    const closedAccessorials = await owner.loadAccessorial.count({
      where: { loadId: closedLoadId },
    })
    expect(closedApplications).toBe(0)
    expect(closedAccessorials).toBe(0)

    // And the live load did get both.
    expect(
      await owner.paymentLoadApplication.count({
        where: { loadId: liveLoadId },
      }),
    ).toBe(1)
    // One accessorial: the fuel surcharge. Base Rate is linehaul, not a charge,
    // and the three zero columns write nothing.
    const live = await owner.loadAccessorial.findMany({
      where: { loadId: liveLoadId },
      select: { type: true, amountCents: true, sourceKey: true },
    })
    expect(live).toHaveLength(1)
    expect(live[0]!.amountCents).toBe(5000)
  }, 300_000)

  // ── THE SAME FILE TWICE ────────────────────────────────────────────────
  it('writes nothing the second time the same remittance arrives', async () => {
    const before = await owner.paymentLoadApplication.count({
      where: { organizationId },
    })
    const result = await inOrg((tx) =>
      writeRemittance(tx, {
        organizationId,
        companyId,
        customerId,
        reading: reading(),
        freightByReference: freight(true),
        receivedAt: new Date(Date.UTC(2026, 8, 9)),
        recordedByUserId: userId,
      }),
    )
    expect(result.alreadyImported).toBe(true)
    expect(result.appliedUnits).toBe(0)
    expect(
      await owner.paymentLoadApplication.count({ where: { organizationId } }),
    ).toBe(before)
    expect(await owner.payment.count({ where: { organizationId } })).toBe(1)
  }, 300_000)

  // ── THE GATE OPENED, AND THE WRITE HAPPENS ─────────────────────────────
  //
  // The same fixture with `closedHistory: false`. Without this the first test
  // would pass against a writer that never wrote anything for any unit.
  it('writes for that same unit once it is no longer closed history', async () => {
    const second = reading()
    second.summary.invoiceNumber = `AZNG-TEST-${nonce}-B`

    const result = await inOrg((tx) =>
      writeRemittance(tx, {
        organizationId,
        companyId,
        customerId,
        reading: second,
        freightByReference: freight(false),
        receivedAt: new Date(Date.UTC(2026, 8, 9)),
        recordedByUserId: userId,
      }),
    )

    expect(result.skippedClosedHistory).toBe(0)
    expect(result.appliedUnits).toBe(2)
    expect(result.appliedCents).toBe(150000)
    expect(
      await owner.paymentLoadApplication.count({
        where: { loadId: closedLoadId },
      }),
    ).toBe(1)
    // Fuel surcharge and tolls — two non-zero columns, two charges, and the
    // source key carries the column so neither collides with the other.
    const charges = await owner.loadAccessorial.findMany({
      where: { loadId: closedLoadId },
      select: { amountCents: true, sourceKey: true },
      orderBy: { amountCents: 'desc' },
    })
    expect(charges.map((c) => c.amountCents)).toEqual([12000, 3000])
    expect(new Set(charges.map((c) => c.sourceKey)).size).toBe(2)
  }, 300_000)
})
