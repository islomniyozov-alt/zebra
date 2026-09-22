import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createLoad } from '@/lib/loads'
import {
  driverWarningFacts,
  driverWarnings,
  loadWarningFacts,
  loadWarnings,
  truckWarningFacts,
  truckWarnings,
  REQUIRED_DRIVER_DOCUMENTS,
} from '@/lib/warnings'
import { DQF_DOCUMENT_TYPES } from '@/lib/dqf'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE FACTS BEHIND THE WARNINGS, AND WHAT THEY COST.
//
// `tests/warnings.test.ts` grades the rules against hand-built facts. This
// grades the LOADERS: that they find the right rows, and — the part that only
// a database can answer — that a list of twenty costs the same number of
// statements as a list of one.
//
// A fan-out is how this feature quietly becomes the slowest page in the
// system, and it is invisible in a unit test because the answers are correct
// either way.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let goodDriverId = ''
let badDriverId = ''
let truckId = ''

const nonce = Math.random().toString(36).slice(2, 8)
const NOW = new Date()
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'warnings.test' },
    timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS,
  })

async function seedLoad(input: {
  pickupAt: Date
  driverId?: string | null
  truckId?: string | null
  cancelled?: boolean
  closedHistory?: boolean
}) {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        referenceNumber: `W-${nonce}-${Math.random().toString(36).slice(2, 7)}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: input.pickupAt,
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: input.pickupAt,
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
      driverId: input.driverId ?? null,
      truckId: input.truckId ?? null,
      ...(input.cancelled ? { isCancelled: true } : {}),
      ...(input.closedHistory
        ? { billingStatus: 'CLOSED_IN_DATATRUCK' as const }
        : {}),
    },
  })
  return load.id
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  organizationId = (
    await owner.organization.create({
      data: { name: `Warn ${nonce}`, slug: `warn-${nonce}` },
    })
  ).id

  companyId = (
    await owner.company.create({
      data: {
        organizationId,
        name: `RAM ${nonce}`,
        addressLine1: '5062 Free Pike',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
      },
    })
  ).id

  userId = (
    await owner.user.create({
      data: { email: `warn-${nonce}@example.test`, name: 'Warn' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  const makeDriver = async (last: string) =>
    (
      await owner.driver.create({
        data: { organizationId, companyId, firstName: 'A', lastName: last },
      })
    ).id

  goodDriverId = await makeDriver('CLEAN')
  badDriverId = await makeDriver('TROUBLE')

  // ── THE CLEAN DRIVER HAS EVERYTHING, AND "EVERYTHING" IS A LIST ──────
  //
  // Built from `REQUIRED_DRIVER_DOCUMENTS` rather than typed out, which is
  // item 13 applied to its own fixtures: this used to be ['CDL',
  // 'MEDICAL_CARD'] and stopped being complete the moment the definition
  // grew. A fixture that goes stale is a test that quietly stops testing —
  // and this one is the test that says a clean driver produces NO warnings,
  // so a stale fixture here fails loudly rather than passing wrongly. It
  // did: the gate caught it.
  for (const type of REQUIRED_DRIVER_DOCUMENTS) {
    await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        driverId: goodDriverId,
        type,
        expiresAt: days(400),
      },
    })
  }
  // And the three DQF items evidenced by a DOCUMENT rather than a date.
  // `complianceWarnings` cannot see these at all; `dqf_incomplete` can, and
  // without them the clean driver is not clean.
  let filed = 0
  for (const type of DQF_DOCUMENT_TYPES) {
    filed += 1
    await owner.document.create({
      data: {
        organizationId,
        companyId,
        driverId: goodDriverId,
        type,
        r2Key: `${organizationId}/driver/${goodDriverId}/${nonce}-${filed}`,
        filename: `${type}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    })
  }

  // The troubled one: an expired CDL, no medical card at all.
  await owner.complianceItem.create({
    data: {
      organizationId,
      companyId,
      driverId: badDriverId,
      type: 'CDL',
      expiresAt: days(-2),
    },
  })

  truckId = (
    await owner.truck.create({
      data: {
        organizationId,
        companyId,
        unitNumber: `T-${nonce}`,
        vin: `VIN${nonce}000000000`,
      },
    })
  ).id

  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BROKER ${nonce}` }),
    )
  ).id
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

describe('driver facts', () => {
  it('find an expired document and a missing one', async () => {
    const facts = await inOrg((tx) =>
      driverWarningFacts(tx, [goodDriverId, badDriverId]),
    )
    const bad = driverWarnings(facts.get(badDriverId)!, NOW).map((w) => w.name)
    expect(bad).toContain('compliance_expired')
    expect(bad).toContain('document_missing')
  })

  it('leave a driver with everything in date alone', async () => {
    const facts = await inOrg((tx) =>
      driverWarningFacts(tx, [goodDriverId, badDriverId]),
    )
    expect(driverWarnings(facts.get(goodDriverId)!, NOW)).toEqual([])
  })

  it('return an entry for every id asked about, even a spotless one', async () => {
    // A MISSING MAP ENTRY IS NOT "NO WARNINGS" — it is a row the list would
    // have to guess about, and the caller would have to decide what a missing
    // key means. Every id asked for comes back.
    const facts = await inOrg((tx) =>
      driverWarningFacts(tx, [goodDriverId, badDriverId]),
    )
    expect([...facts.keys()].sort()).toEqual([goodDriverId, badDriverId].sort())
  })
})

describe('truck facts', () => {
  it('report all three required documents as missing when none are filed', async () => {
    const facts = await inOrg((tx) => truckWarningFacts(tx, [truckId]))
    const names = truckWarnings(facts.get(truckId)!, NOW)
    expect(names.map((w) => w.detail).sort()).toEqual([
      'ANNUAL_INSPECTION',
      'INSURANCE_LIABILITY',
      'REGISTRATION',
    ])
  })
})

describe('load facts', () => {
  it('warn about a load hours from pickup with nobody on it', async () => {
    const id = await seedLoad({ pickupAt: hours(3) })
    const facts = await inOrg((tx) => loadWarningFacts(tx, [id]))
    expect(loadWarnings(facts.get(id)!, NOW).map((w) => w.name)).toEqual([
      'pickup_soon_unassigned',
    ])
  })

  it('warn about a cancelled load still holding a driver', async () => {
    const id = await seedLoad({
      pickupAt: days(10),
      driverId: goodDriverId,
      cancelled: true,
    })
    const facts = await inOrg((tx) => loadWarningFacts(tx, [id]))
    expect(loadWarnings(facts.get(id)!, NOW).map((w) => w.name)).toEqual([
      'cancelled_but_assigned',
    ])
  })

  it('say NOTHING about closed history, however wrong it looks', async () => {
    // THE GUARD NAMED "closed history producing warnings", end to end: this
    // load is cancelled, crewed and hours from a pickup it never made.
    const id = await seedLoad({
      pickupAt: hours(2),
      driverId: goodDriverId,
      cancelled: true,
      closedHistory: true,
    })
    const facts = await inOrg((tx) => loadWarningFacts(tx, [id]))
    expect(loadWarnings(facts.get(id)!, NOW)).toEqual([])
  })
})

// ── THE COST ───────────────────────────────────────────────────────────
describe('what a list costs', () => {
  it('asks the same number of questions for twenty drivers as for one', async () => {
    // THE GUARD NAMED "per-row query fan-out". The answers are correct either
    // way, which is exactly why this has to be counted rather than eyeballed.
    const { PrismaClient } = await import('@/generated/prisma/client')
    const { PrismaNeon } = await import('@prisma/adapter-neon')

    const countFor = async (ids: string[]) => {
      const client = new PrismaClient({
        adapter: new PrismaNeon({
          connectionString: process.env.DIRECT_DATABASE_URL!,
        }),
        log: [{ emit: 'event', level: 'query' }],
      })
      let count = 0
      client.$on('query', () => {
        count += 1
      })
      // Warm the connection outside the measurement — see this-week-timing.
      await client.$queryRaw`select 1`
      const before = count
      await driverWarningFacts(client as never, ids)
      const used = count - before
      await client.$disconnect()
      return used
    }

    const many = Array.from({ length: 20 }, () => badDriverId)
    const one = await countFor([badDriverId])
    const twenty = await countFor(many)

    expect(one).toBeGreaterThan(0)
    expect(
      twenty,
      `one driver cost ${one} statements, twenty cost ${twenty}`,
    ).toBe(one)
  })
})
