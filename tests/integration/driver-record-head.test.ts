import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { tenantReader, txReader, withOrg, type TxClient } from '@/lib/tenancy'
import { readDriverRecordHead } from '@/lib/driver-record-head'
import { createBroker } from '@/lib/brokers'
import { createLoad, LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { documentsForRecords, recordsForSubject } from '@/lib/compliance'
import { inspectionsForSubject } from '@/lib/inspections'
import { payRulesFor } from '@/lib/driver-pay'
import { onTimeRateForDriver } from '@/lib/dispatch-fields'
import { dqfFactsForDrivers } from '@/lib/dqf'
import { currentAuthority } from '@/lib/fleet'
import { teamMateFor } from '@/lib/team'
import { signInLinkFor } from '@/lib/driver-link'
import { SELECTABLE_AUTHORITY } from '@/lib/companies'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { createPrismaClient, prisma, statementsOf } from '@/lib/db'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// /drivers/[id] IN ONE STATEMENT (§6.4 part 2 v11.07).
//
// 1. Every field `readDriverRecordHead` returns equals what the page's reads
//    returned before — the helpers other pages still call, and the page's
//    own `findMany`s, verbatim here — for a driver with something in every
//    read and for a sparse one, with and without the sign-in link, scoped
//    and unscoped.
// 2. Through the tenant reader, as `zebra_app` outside any transaction, it
//    is ONE statement, and another organization's driver reads as absent.
//    Watched failing with the reader handed that organization's id.
//
// EVERY FILTER HAS A ROW ON BOTH SIDES: a retired and an inactive authority,
// a sold and a deleted truck and trailer, an INACTIVE crew member on the same
// truck, a deleted compliance record and document, a deleted violation, a
// closed and an open authority period, a cancelled load, a linked user and
// a DRIVER member who is free to link.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let otherOrgId = ''
let otherDriverId = ''
let userId = ''
let alphaId = ''
let betaId = ''
const drivers: Record<string, string> = {}
const nonce = Math.random().toString(36).slice(2, 8)
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000)
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000)

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'driver-record-head.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

/** What the page read before v11.07, read by read. */
async function readByHelpers(
  tx: TxClient,
  id: string,
  scopes: string[],
  withSignIn: boolean,
) {
  const driver = await tx.driver.findUnique({ where: { id } })
  if (!driver) return null
  const records = await recordsForSubject(tx, 'driver', id, NOW)
  return {
    driver,
    companies: await tx.company.findMany({
      where: { ...SELECTABLE_AUTHORITY, ...companyIdScopeFilter(scopes) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    trucks: await tx.truck.findMany({
      where: {
        companyId: driver.companyId,
        deletedAt: null,
        status: { not: 'SOLD' },
      },
      orderBy: { unitNumber: 'asc' },
      select: {
        id: true,
        unitNumber: true,
        company: { select: { name: true } },
      },
    }),
    trailers: await tx.trailer.findMany({
      where: {
        companyId: driver.companyId,
        deletedAt: null,
        status: { not: 'SOLD' },
      },
      orderBy: { unitNumber: 'asc' },
      select: { id: true, unitNumber: true },
    }),
    payRules: await payRulesFor(tx, id, NOW),
    deductions: await tx.recurringDeduction.findMany({
      where: { driverId: id },
      orderBy: [{ effectiveFrom: 'desc' }, { type: 'asc' }],
    }),
    openingBalances: await tx.driverOpeningBalance.findMany({
      where: { driverId: id },
      orderBy: [{ year: 'desc' }, { category: 'asc' }],
    }),
    onTimeRate: await onTimeRateForDriver(tx, id),
    dqf: (await dqfFactsForDrivers(tx, [id])).get(id) ?? {
      hireDate: null,
      compliance: [],
      documents: [],
    },
    authority: await currentAuthority(tx, 'driver', id),
    compliance: records,
    complianceDocuments: await documentsForRecords(
      tx,
      records.map((r) => r.id),
    ),
    inspections: await inspectionsForSubject(tx, 'driver', id),
    documents: await tx.document.findMany({
      where: { driverId: id, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        filename: true,
        type: true,
        uploadedAt: true,
        ocrStatus: true,
        supersededByDocumentId: true,
      },
    }),
    timezone:
      (
        await tx.company.findUnique({
          where: { id: driver.companyId },
          select: { timezone: true },
        })
      )?.timezone ?? null,
    teamMate: await teamMateFor(tx, id),
    signIn: withSignIn ? await signInLinkFor(tx, organizationId, id) : null,
  }
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Driver record ${nonce}`,
      slug: `driver-record-${nonce}`,
      maxCompanies: 5,
      companies: {
        create: [
          { name: `Alpha ${nonce}`, timezone: 'America/New_York' },
          { name: `Beta ${nonce}` },
          { name: `Retired ${nonce}`, retired: true },
          { name: `Dormant ${nonce}`, isActive: false },
        ],
      },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  const company = (prefix: string) =>
    organization.companies.find((c) => c.name.startsWith(prefix))!.id
  alphaId = company('Alpha')
  betaId = company('Beta')
  await owner.companySettings.create({
    data: { organizationId, companyId: alphaId, complianceWarnDays: 45 },
  })
  await owner.companySettings.create({
    data: { organizationId, companyId: betaId, complianceWarnDays: 90 },
  })

  const user = await owner.user.create({
    data: { email: `drec-owner-${nonce}@example.test`, name: 'Record Owner' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
  const linkedUser = await owner.user.create({
    data: { email: `drec-linked-${nonce}@example.test`, name: 'Linked Driver' },
  })
  const freeUser = await owner.user.create({
    data: { email: `drec-free-${nonce}@example.test`, name: 'Free Driver' },
  })
  for (const u of [linkedUser, freeUser]) {
    await owner.membership.create({
      data: { userId: u.id, organizationId, role: 'DRIVER' },
    })
  }

  const truck = async (unit: string, companyId: string, data = {}) =>
    (
      await owner.truck.create({
        data: { organizationId, companyId, unitNumber: unit, ...data },
      })
    ).id
  const seatTruck = await truck(`T1-${nonce}`, alphaId)
  await truck(`T2-${nonce}`, alphaId)
  await truck(`T3-${nonce}`, alphaId, { status: 'SOLD' })
  await truck(`T4-${nonce}`, alphaId, { deletedAt: day(-1) })
  await truck(`T5-${nonce}`, betaId)
  for (const [unit, data] of [
    [`R1-${nonce}`, {}],
    [`R2-${nonce}`, { status: 'SOLD' }],
    [`R3-${nonce}`, { deletedAt: day(-1) }],
  ] as const) {
    await owner.trailer.create({
      data: { organizationId, companyId: alphaId, unitNumber: unit, ...data },
    })
  }

  const driver = async (name: string, data: Record<string, unknown> = {}) => {
    drivers[name] = (
      await owner.driver.create({
        data: {
          organizationId,
          companyId: alphaId,
          firstName: name,
          lastName: `Record ${nonce}`,
          hireDate: new Date(Date.UTC(2026, 0, 5)),
          ...data,
        },
      })
    ).id
  }
  await driver('Full', {
    status: 'AVAILABLE',
    assignedTruckId: seatTruck,
    userId: linkedUser.id,
    tags: ['night', 'hazmat'],
    phone: '555-0101',
  })
  // THE INACTIVE ONE PAIRED FIRST, so a crew read that let them hold a seat
  // would name them as the mate.
  await driver('Former', { status: 'INACTIVE', assignedTruckId: seatTruck })
  await driver('Pair', { status: 'AVAILABLE', assignedTruckId: seatTruck })
  await driver('Sparse', { companyId: betaId })

  const full = drivers.Full!
  for (const [from, to, pct] of [
    [new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2025, 11, 31)), 2500],
    [new Date(Date.UTC(2026, 0, 1)), null, 3000],
  ] as const) {
    await owner.driverPayRule.create({
      data: {
        organizationId,
        driverId: full,
        type: 'PERCENT_GROSS',
        percentBps: pct,
        effectiveFrom: from,
        effectiveTo: to,
      },
    })
  }
  for (const [type, amount] of [
    ['ESCROW', 5_000],
    ['INSURANCE', 12_000],
  ] as const) {
    await owner.recurringDeduction.create({
      data: {
        organizationId,
        driverId: full,
        type,
        cadence: 'WEEKLY',
        amountCents: amount,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    })
  }
  for (const [category, amount] of [
    ['NET_PAY', 12_345],
    ['EARNINGS', 99_999],
  ] as const) {
    await owner.driverOpeningBalance.create({
      data: {
        organizationId,
        driverId: full,
        year: 2026,
        category,
        amountCents: amount,
        asOf: new Date(Date.UTC(2026, 0, 1)),
        source: 'driver-record-head.test',
      },
    })
  }
  // AN AUTHORITY PERIOD CLOSED AND ONE OPEN.
  await owner.assetAssignment.create({
    data: {
      organizationId,
      companyId: betaId,
      driverId: full,
      effectiveFrom: day(-200),
      effectiveTo: day(-100),
    },
  })
  await owner.assetAssignment.create({
    data: {
      organizationId,
      companyId: alphaId,
      driverId: full,
      effectiveFrom: day(-100),
    },
  })
  // COMPLIANCE: two live, one deleted; a file on one, a deleted file too.
  const cdl = await owner.complianceItem.create({
    data: {
      organizationId,
      companyId: alphaId,
      driverId: full,
      type: 'CDL',
      identifier: 'D123',
      issuer: 'IN',
      issuedAt: day(-300),
      // 60 DAYS: current under Alpha's 45-day lead, expiring under Beta's 90,
      // so a lead read from the wrong authority changes the row.
      expiresAt: day(60),
    },
  })
  await owner.complianceItem.create({
    data: {
      organizationId,
      companyId: alphaId,
      driverId: full,
      type: 'MEDICAL_CARD',
      expiresAt: day(-5),
    },
  })
  await owner.complianceItem.create({
    data: {
      organizationId,
      companyId: alphaId,
      driverId: full,
      type: 'MEDICAL_CARD',
      expiresAt: day(400),
      deletedAt: day(-1),
    },
  })
  const document = (data: Record<string, unknown>) =>
    owner.document.create({
      data: {
        organizationId,
        companyId: alphaId,
        r2Key: `drec/${nonce}/${Math.random().toString(36).slice(2)}.pdf`,
        filename: 'file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        type: 'OTHER',
        ...data,
      },
    })
  await document({
    complianceItemId: cdl.id,
    filename: 'cdl.pdf',
    type: 'CDL_COPY',
    uploadedAt: day(-10),
  })
  await document({
    complianceItemId: cdl.id,
    filename: 'old-cdl.pdf',
    deletedAt: day(-2),
    uploadedAt: day(-20),
  })
  await document({
    driverId: full,
    filename: 'road-test.pdf',
    type: 'ROAD_TEST_CERTIFICATE',
    uploadedAt: day(-3),
  })
  await document({
    driverId: full,
    filename: 'gone.pdf',
    deletedAt: day(-1),
    uploadedAt: day(-4),
  })
  // AN INSPECTION WITH TWO VIOLATIONS, one deleted, and a clean one.
  const inspection = await owner.roadsideInspection.create({
    data: {
      organizationId,
      companyId: alphaId,
      driverId: full,
      truckId: seatTruck,
      inspectedAt: day(-30),
      level: 'LEVEL_1',
      state: 'IN',
      reportNumber: `IN-${nonce}`,
    },
  })
  for (const [code, oos, deletedAt] of [
    ['395.8E', true, null],
    ['392.2', false, null],
    ['393.9', false, day(-1)],
  ] as const) {
    await owner.inspectionViolation.create({
      data: {
        organizationId: '',
        inspectionId: inspection.id,
        code,
        unit: 'DRIVER',
        outOfService: oos,
        deletedAt,
      },
    })
  }
  await owner.roadsideInspection.create({
    data: {
      organizationId,
      companyId: alphaId,
      driverId: full,
      inspectedAt: day(-60),
      level: 'LEVEL_3',
      state: 'OH',
    },
  })
  // FREIGHT FOR THE ON-TIME RATE: one on time, one late, one cancelled.
  const broker = await inOrg((tx) =>
    createBroker(tx, organizationId, { name: `BROKER ${nonce}` }),
  )
  for (const [ref, arrived, cancelled] of [
    ['A', day(-9), false],
    ['B', day(-6), false],
    ['C', day(-6), true],
  ] as const) {
    const load = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId: alphaId,
          customerId: broker.id,
          referenceNumber: `DR-${ref}-${nonce}`,
          stops: [
            {
              type: 'PICKUP',
              city: 'Whiteland',
              state: 'IN',
              scheduledAt: day(-12),
            },
            {
              type: 'DELIVERY',
              city: 'Gastonia',
              state: 'NC',
              scheduledAt: day(-8),
            },
          ],
          linehaulCents: 100_000,
        },
        { byUserId: userId },
      ),
    )
    await owner.load.update({
      where: { id: load.id },
      data: {
        driverId: full,
        operationalStatus: 'DELIVERED',
        isCancelled: cancelled,
      },
    })
    await owner.loadStop.updateMany({
      where: { loadId: load.id, type: 'DELIVERY' },
      data: { arrivedAt: arrived },
    })
  }

  // ANOTHER ORGANIZATION'S DRIVER.
  const other = await owner.organization.create({
    data: {
      name: `Driver record other ${nonce}`,
      slug: `driver-record-other-${nonce}`,
      companies: { create: [{ name: `Other ${nonce}` }] },
    },
    include: { companies: true },
  })
  otherOrgId = other.id
  otherDriverId = (
    await owner.driver.create({
      data: {
        organizationId: other.id,
        companyId: other.companies[0]!.id,
        firstName: 'Elsewhere',
        lastName: `Record ${nonce}`,
      },
    })
  ).id
}, 600_000)

afterAll(async () => {
  await owner?.$disconnect()
})

describe('/drivers/[id] in one statement', () => {
  it('reads what the page’s reads read — full and sparse, scoped, with and without the link', async () => {
    let compared = 0
    for (const name of ['Full', 'Sparse', 'Pair']) {
      for (const scopes of [[], [betaId]]) {
        for (const withSignIn of [true, false]) {
          const id = drivers[name]!
          const [head, expected] = await inOrg(
            async (tx) =>
              [
                await readDriverRecordHead(txReader(tx), {
                  driverId: id,
                  organizationId,
                  companyScopes: scopes,
                  withSignIn,
                  now: NOW,
                }),
                await readByHelpers(tx, id, scopes, withSignIn),
              ] as const,
          )
          expect(head, `${name} ${scopes.join()} ${withSignIn}`).toEqual(
            expected,
          )
          compared += 1
        }
      }
    }
    expect(compared).toBe(12)

    // NOT VACUOUS: the full driver has something in every read.
    const head = (await inOrg((tx) =>
      readDriverRecordHead(txReader(tx), {
        driverId: drivers.Full!,
        organizationId,
        companyScopes: [],
        withSignIn: true,
        now: NOW,
      }),
    ))!
    expect(head.companies).toHaveLength(2)
    expect(head.trucks).toHaveLength(2)
    expect(head.trailers).toHaveLength(1)
    expect(head.payRules.map((r) => r.isCurrent)).toEqual([true, false])
    expect(head.deductions).toHaveLength(2)
    expect(head.openingBalances).toHaveLength(2)
    expect(head.onTimeRate).not.toEqual(
      await inOrg((tx) => onTimeRateForDriver(tx, drivers.Sparse!)),
    )
    expect(head.authority?.companyId).toBe(alphaId)
    expect(head.compliance).toHaveLength(2)
    expect(
      head.complianceDocuments.get(
        head.compliance.find((c) => c.type === 'CDL')!.id,
      ),
    ).toHaveLength(1)
    expect(head.inspections).toHaveLength(2)
    expect(head.inspections[0]!.violations).toHaveLength(2)
    expect(head.documents.map((d) => d.filename)).toEqual(['road-test.pdf'])
    expect(head.timezone).toBe('America/New_York')
    expect(head.teamMate?.id).toBe(drivers.Pair)
    expect(head.signIn?.linked?.email).toBe(`drec-linked-${nonce}@example.test`)
    const sparse = (await inOrg((tx) =>
      readDriverRecordHead(txReader(tx), {
        driverId: drivers.Sparse!,
        organizationId,
        companyScopes: [],
        withSignIn: true,
        now: NOW,
      }),
    ))!
    expect(sparse.signIn?.candidates.map((c) => c.email)).toEqual([
      `drec-free-${nonce}@example.test`,
    ])
  }, 600_000)

  it('is ONE statement through the tenant reader, and another organization’s driver is absent', async () => {
    const client = createPrismaClient(process.env.DATABASE_URL!)
    try {
      const at = statementsOf(client)!
      const head = await readDriverRecordHead(
        tenantReader(client, organizationId),
        {
          driverId: drivers.Full!,
          organizationId,
          companyScopes: [],
          withSignIn: true,
          now: NOW,
        },
      )
      expect(statementsOf(client)! - at).toBe(1)
      expect(head?.driver.id).toBe(drivers.Full)
    } finally {
      await client.$disconnect()
    }
    const theirs = await readDriverRecordHead(
      tenantReader(prisma, organizationId),
      {
        driverId: otherDriverId,
        organizationId,
        companyScopes: [],
        withSignIn: true,
        now: NOW,
      },
    )
    expect(theirs).toBeNull()
    // NOT VACUOUS: as its own organization the driver is there.
    const own = await readDriverRecordHead(tenantReader(prisma, otherOrgId), {
      driverId: otherDriverId,
      organizationId: otherOrgId,
      companyScopes: [],
      withSignIn: false,
      now: NOW,
    })
    expect(own?.driver.id).toBe(otherDriverId)
  }, 300_000)
})
