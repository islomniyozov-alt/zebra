import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import {
  historyForSubject,
  maintenanceList,
  receiptsFor,
  recordWorkOrder,
} from '@/lib/maintenance'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Maintenance against real Postgres.
//
// The arithmetic is covered in tests/maintenance.test.ts. What can only be
// asserted here:
//
//   * a work order takes its tenant and its authority FROM THE ASSET, so a
//     forged subject id lands on nothing rather than on the caller's own org;
//   * the running total on an asset and the fleet-wide total are built from
//     the same rows, so the two agree when the scope is the same;
//   * the cost really is absent from the payload against a live query, not
//     just against a hand-built row;
//   * a receipt filed through the document pipeline comes back attached to the
//     work order it belongs to — the path that would have crashed on
//     `undefined.findUnique` before the TARGETS fix.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let otherCompanyId = ''
let userId = ''
let truckId = ''
let trailerId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'maintenance.test' },
    maxWaitMs: 20_000,
  })

const DAY = (iso: string) => new Date(`${iso}T00:00:00Z`)

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Maintenance ${nonce}`,
      slug: `maintenance-${nonce}`,
      maxCompanies: 5,
      companies: {
        create: [{ name: `Alpha ${nonce}` }, { name: `Beta ${nonce}` }],
      },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  otherCompanyId = organization.companies[1]!.id

  const user = await owner.user.create({
    data: { email: `maintenance-${nonce}@example.test`, name: 'Shop Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  truckId = (
    await owner.truck.create({
      data: { organizationId, companyId, unitNumber: `104-${nonce}` },
    })
  ).id
  trailerId = (
    await owner.trailer.create({
      data: { organizationId, companyId, unitNumber: `R22-${nonce}` },
    })
  ).id
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('recording a work order', () => {
  it('takes the tenant and the authority from the asset, not from the caller', async () => {
    const outcome = await inOrg((tx) =>
      recordWorkOrder(tx, {
        subject: 'truck',
        subjectId: truckId,
        servicedAt: DAY('2026-06-02'),
        category: 'OIL_CHANGE',
        costCents: 42_950,
        odometer: 400_000,
        vendorName: 'Gary Truck Service',
        description: 'PM A',
      }),
    )
    expect(outcome.ok).toBe(true)

    const stored = await owner.maintenanceRecord.findUniqueOrThrow({
      where: { id: outcome.ok ? outcome.recordId : '' },
      select: {
        organizationId: true,
        companyId: true,
        truckId: true,
        trailerId: true,
        costCents: true,
      },
    })
    expect(stored).toMatchObject({
      organizationId,
      companyId,
      truckId,
      trailerId: null,
      costCents: 42_950,
    })
  }, 300_000)

  it('refuses an asset that is not there', async () => {
    // A forged id is a refusal, not a row hanging off nothing. RLS has already
    // removed another tenant's trucks from the transaction, so this is the
    // same answer a cross-tenant id gets.
    const outcome = await inOrg((tx) =>
      recordWorkOrder(tx, {
        subject: 'truck',
        subjectId: 'ckdoesnotexist000000000',
        servicedAt: DAY('2026-06-02'),
        category: 'TIRES',
        costCents: 1_000,
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'subject_not_found' })
  }, 300_000)

  it('refuses a negative cost and accepts a zero one', async () => {
    const negative = await inOrg((tx) =>
      recordWorkOrder(tx, {
        subject: 'truck',
        subjectId: truckId,
        servicedAt: DAY('2026-06-03'),
        category: 'OTHER',
        costCents: -500,
      }),
    )
    expect(negative).toEqual({ ok: false, reason: 'bad_cost' })

    // Warranty work is free and belongs in the history all the same.
    const warranty = await inOrg((tx) =>
      recordWorkOrder(tx, {
        subject: 'truck',
        subjectId: truckId,
        servicedAt: DAY('2026-06-03'),
        category: 'AFTERTREATMENT',
        costCents: 0,
        description: 'DPF under warranty',
      }),
    )
    expect(warranty.ok).toBe(true)
  }, 300_000)
})

describe('the history on an asset', () => {
  it('runs a total the reader can add up, and a cost per mile over the span', async () => {
    await inOrg((tx) =>
      recordWorkOrder(tx, {
        subject: 'truck',
        subjectId: truckId,
        servicedAt: DAY('2026-08-03'),
        category: 'BRAKES',
        costCents: 184_000,
        odometer: 412_000,
        vendorName: 'Gary Truck Service',
      }),
    )

    const history = await inOrg((tx) =>
      historyForSubject(tx, 'truck', truckId, true),
    )

    // $429.50 + $0 + $1,840 — the three that saved above.
    expect(history.rows).toHaveLength(3)
    expect(history.totals?.costCents).toBe(226_950)

    // And the total IS the column, added up. This is the whole promise of the
    // figure: a reader who does not trust it can check it.
    const added = history.rows.reduce(
      (sum, row) => sum + (row.costCents ?? 0),
      0,
    )
    expect(added).toBe(history.totals?.costCents)

    // 226,950 cents over 400,000 -> 412,000 miles = 18.9 -> 19.
    expect(history.totals?.fromOdometer).toBe(400_000)
    expect(history.totals?.toOdometer).toBe(412_000)
    expect(history.totals?.perMileCents).toBe(19)

    // Newest service first — the order the panel renders in.
    expect(history.rows[0]?.servicedAt.toISOString().slice(0, 10)).toBe(
      '2026-08-03',
    )
  }, 300_000)

  it('sends no cost and no totals at all to a role that cannot see money', async () => {
    // Against a LIVE query rather than a hand-built row: the unit test proves
    // the shaping, this proves nothing downstream puts it back.
    const history = await inOrg((tx) =>
      historyForSubject(tx, 'truck', truckId, false),
    )
    expect(history.rows).toHaveLength(3)
    expect(history.totals).toBeUndefined()
    for (const row of history.rows) {
      expect('costCents' in row).toBe(false)
    }
    expect(JSON.stringify(history)).not.toContain('cost')

    // The pair: the work orders themselves are all still there.
    expect(history.rows.map((row) => row.category)).toContain('BRAKES')
  }, 300_000)

  it('keeps trailer orders out of a truck history', async () => {
    await inOrg((tx) =>
      recordWorkOrder(tx, {
        subject: 'trailer',
        subjectId: trailerId,
        servicedAt: DAY('2026-07-14'),
        category: 'TRAILER_SERVICE',
        costCents: 61_500,
      }),
    )

    const truck = await inOrg((tx) =>
      historyForSubject(tx, 'truck', truckId, true),
    )
    const trailer = await inOrg((tx) =>
      historyForSubject(tx, 'trailer', trailerId, true),
    )

    expect(truck.rows).toHaveLength(3)
    expect(trailer.rows).toHaveLength(1)
    expect(trailer.rows[0]?.subject).toBe('trailer')
    expect(trailer.totals?.costCents).toBe(61_500)
    // One reading only, so no span and no rate — not a division by zero.
    expect(trailer.totals?.perMileCents).toBeNull()
  }, 300_000)
})

describe('the fleet-wide list', () => {
  it('totals the same rows the asset panels do', async () => {
    const fleet = await inOrg((tx) => maintenanceList(tx, {}, {}, true))
    expect(fleet.rows).toHaveLength(4)
    // $2,269.50 on the truck plus $615.00 on the trailer.
    expect(fleet.totals?.costCents).toBe(288_450)
    // Fleet-wide there is no honest span to divide by — one asset's spend over
    // another asset's miles is not a cost per mile.
    expect(fleet.totals?.perMileCents).toBeNull()
  }, 300_000)

  it('honours the authority scope', async () => {
    // Everything above belongs to Alpha. Scoped to Beta, the list is empty and
    // the total is zero rather than the group's.
    const beta = await inOrg((tx) =>
      maintenanceList(tx, { companyId: { in: [otherCompanyId] } }, {}, true),
    )
    expect(beta.rows).toEqual([])
    expect(beta.totals?.costCents).toBe(0)
  }, 300_000)

  it('filters by subject and by category', async () => {
    const trailersOnly = await inOrg((tx) =>
      maintenanceList(tx, {}, { subject: 'trailer' }, true),
    )
    expect(trailersOnly.rows.map((row) => row.subject)).toEqual(['trailer'])

    const brakes = await inOrg((tx) =>
      maintenanceList(tx, {}, { category: 'BRAKES' }, true),
    )
    expect(brakes.rows).toHaveLength(1)
    expect(brakes.totals?.costCents).toBe(184_000)
  }, 300_000)

  it('drops a soft-deleted work order from both views', async () => {
    const brakes = await owner.maintenanceRecord.findFirstOrThrow({
      where: { companyId, category: 'BRAKES' },
      select: { id: true },
    })
    await owner.maintenanceRecord.update({
      where: { id: brakes.id },
      data: { deletedAt: new Date() },
    })

    const fleet = await inOrg((tx) => maintenanceList(tx, {}, {}, true))
    expect(fleet.rows.map((row) => row.id)).not.toContain(brakes.id)
    expect(fleet.totals?.costCents).toBe(288_450 - 184_000)

    const history = await inOrg((tx) =>
      historyForSubject(tx, 'truck', truckId, true),
    )
    expect(history.rows).toHaveLength(2)

    await owner.maintenanceRecord.update({
      where: { id: brakes.id },
      data: { deletedAt: null },
    })
  }, 300_000)
})

describe('receipts', () => {
  it('come back attached to the work order they were filed against', async () => {
    // The path that would have crashed before the TARGETS fix — `maintenance`
    // mapped to a delegate named `maintenance`, and the model is
    // `MaintenanceRecord`. See tests/document-targets.test.ts.
    const [first, second] = await owner.maintenanceRecord.findMany({
      where: { companyId, truckId },
      orderBy: { servicedAt: 'asc' },
      take: 2,
      select: { id: true },
    })

    await owner.document.create({
      data: {
        organizationId,
        companyId,
        type: 'MAINTENANCE_RECEIPT',
        filename: `invoice-${nonce}.pdf`,
        r2Key: `${organizationId}/maintenance/${first!.id}/${nonce}-receipt.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        maintenanceId: first!.id,
      },
    })

    const receipts = await inOrg((tx) =>
      receiptsFor(tx, [first!.id, second!.id]),
    )
    expect(receipts.get(first!.id)?.[0]?.filename).toBe(`invoice-${nonce}.pdf`)
    expect(receipts.get(second!.id)).toBeUndefined()

    // And the row's own count moves with it, so the fleet screen agrees with
    // the panel about how many receipts a work order has.
    const history = await inOrg((tx) =>
      historyForSubject(tx, 'truck', truckId, true),
    )
    expect(
      history.rows.find((row) => row.id === first!.id)?.documentCount,
    ).toBe(1)
  }, 300_000)

  it('asks for nothing when there are no work orders to ask about', async () => {
    // The empty-list guard: `{ in: [] }` is a query that returns everything in
    // some drivers and nothing in others, so it is never sent.
    expect(await inOrg((tx) => receiptsFor(tx, []))).toEqual(new Map())
  }, 300_000)
})
