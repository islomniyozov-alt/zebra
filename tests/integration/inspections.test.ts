import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  addViolation,
  documentsForInspections,
  inspectionById,
  inspectionList,
  inspectionsForSubject,
  recordInspection,
  withdrawViolation,
} from '@/lib/inspections'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Roadside inspections against real Postgres.
//
// The derivations are covered in tests/inspections.test.ts. What can only be
// asserted here:
//
//   * the CHECK constraint really refuses an inspection of nothing, and the
//     service refuses it first in words;
//   * a truck from one authority and a driver from another is refused rather
//     than filed under whichever was read first — the group runs two carriers
//     and this is the mistake that would put an OOS order on the wrong DOT
//     number;
//   * the set_org trigger derives a violation's organizationId from its
//     inspection, so nothing can be written into another tenant through a
//     child row that looks valid on its own;
//   * withdrawing a violation makes the inspection clean again, because clean
//     is read off the children and not off a column.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let otherCompanyId = ''
let userId = ''
let truckId = ''
let trailerId = ''
let driverId = ''
let otherDriverId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'inspections.test' },
    maxWaitMs: 20_000,
    // Prisma's 5s default cannot be met from here — see the note in
    // tests/transaction-budget.test.ts. One dial for all nineteen suites.
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const DAY = (iso: string) => new Date(`${iso}T00:00:00Z`)

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Inspections ${nonce}`,
      slug: `inspections-${nonce}`,
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
    data: { email: `inspections-${nonce}@example.test`, name: 'Safety Tester' },
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
  driverId = (
    await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'Ahmad',
        lastName: `Karimov-${nonce}`,
      },
    })
  ).id
  // Same tenant, DIFFERENT authority — the other half of the carrier group.
  otherDriverId = (
    await owner.driver.create({
      data: {
        organizationId,
        companyId: otherCompanyId,
        firstName: 'Rustam',
        lastName: `Nazarov-${nonce}`,
      },
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

describe('recording an inspection', () => {
  it('takes its authority from the units it names', async () => {
    const outcome = await inOrg((tx) =>
      recordInspection(tx, {
        truckId,
        trailerId,
        driverId,
        inspectedAt: DAY('2026-08-03'),
        level: 'LEVEL_1',
        state: 'in',
        reportNumber: `IN26${nonce}`,
        location: 'Gary weigh station',
      }),
    )
    expect(outcome.ok).toBe(true)

    const stored = await owner.roadsideInspection.findUniqueOrThrow({
      where: { id: outcome.ok ? outcome.inspectionId : '' },
      select: {
        organizationId: true,
        companyId: true,
        state: true,
        truckId: true,
        trailerId: true,
        driverId: true,
      },
    })
    expect(stored).toMatchObject({
      organizationId,
      companyId,
      // Uppercased on the way in, so "in" and "IN" are one jurisdiction.
      state: 'IN',
      truckId,
      trailerId,
      driverId,
    })
  }, 300_000)

  it('refuses a truck from one authority and a driver from another', async () => {
    // The group runs two carriers. An inspection belongs to the one on the DOT
    // number the officer wrote down, and guessing would put an out-of-service
    // order against the wrong carrier's record.
    const outcome = await inOrg((tx) =>
      recordInspection(tx, {
        truckId,
        driverId: otherDriverId,
        inspectedAt: DAY('2026-08-04'),
        level: 'LEVEL_1',
        state: 'OH',
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'mixed_authority' })
  }, 300_000)

  it('refuses an inspection of nothing, in words', async () => {
    const outcome = await inOrg((tx) =>
      recordInspection(tx, {
        inspectedAt: DAY('2026-08-04'),
        level: 'LEVEL_3',
        state: 'OH',
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'no_subject' })
  }, 300_000)

  it('and the database refuses it too, if the service ever stops', async () => {
    // The CHECK constraint is the backstop under the sentence above. Asserted
    // by going around the service entirely — this is the write a future
    // migration or a hand-typed row would make.
    await expect(
      owner.roadsideInspection.create({
        data: {
          organizationId,
          companyId,
          inspectedAt: DAY('2026-08-04'),
          level: 'LEVEL_3',
          state: 'OH',
        },
      }),
    ).rejects.toThrow(/inspection_has_a_subject/)
  }, 300_000)

  it('records a driver-only inspection with no truck on it', async () => {
    // A Level III is the reason all three columns are nullable. If this were
    // refused, a real inspection would have nowhere to go.
    const outcome = await inOrg((tx) =>
      recordInspection(tx, {
        driverId,
        inspectedAt: DAY('2026-07-11'),
        level: 'LEVEL_3',
        state: 'OH',
      }),
    )
    expect(outcome.ok).toBe(true)
  }, 300_000)

  it('refuses a state that is not two letters', async () => {
    const outcome = await inOrg((tx) =>
      recordInspection(tx, {
        truckId,
        inspectedAt: DAY('2026-07-11'),
        level: 'LEVEL_5',
        state: 'Indiana',
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'bad_state' })
  }, 300_000)
})

describe('violations', () => {
  let inspectionId = ''

  beforeAll(async () => {
    const outcome = await inOrg((tx) =>
      recordInspection(tx, {
        truckId,
        driverId,
        inspectedAt: DAY('2026-06-20'),
        level: 'LEVEL_2',
        state: 'MI',
        reportNumber: `MI26${nonce}`,
      }),
    )
    inspectionId = outcome.ok ? outcome.inspectionId : ''
  }, 300_000)

  it('derive their organizationId from the inspection, not from the caller', async () => {
    const added = await inOrg((tx) =>
      addViolation(tx, {
        inspectionId,
        // Lower case in, upper case out — a code is compared against a DataQs
        // form and "393.75a3" must not sort apart from "393.75A3".
        code: '393.75a3',
        description: 'Tire — audible air leak',
        unit: 'VEHICLE',
        outOfService: true,
        severityWeight: 8,
      }),
    )
    expect(added.ok).toBe(true)

    const stored = await owner.inspectionViolation.findUniqueOrThrow({
      where: { id: added.ok ? added.violationId : '' },
      select: { organizationId: true, code: true, outOfService: true },
    })
    // The service passes an empty string; the trigger overwrites it. If the
    // trigger were ever dropped, this row would carry '' and the policy would
    // hide it from everyone — which is the safe direction, and still a bug.
    expect(stored).toMatchObject({
      organizationId,
      code: '393.75A3',
      outOfService: true,
    })
  }, 300_000)

  it('make the inspection read as out of service', async () => {
    const row = await inOrg((tx) => inspectionById(tx, inspectionId))
    expect(row?.outOfService).toBe(true)
    expect(row?.isClean).toBe(false)
  }, 300_000)

  it('sort the out-of-service one first, whatever order it was written in', async () => {
    await inOrg((tx) =>
      addViolation(tx, {
        inspectionId,
        code: '392.2C',
        description: 'Failure to obey traffic control device',
        unit: 'DRIVER',
        outOfService: false,
      }),
    )

    const row = await inOrg((tx) => inspectionById(tx, inspectionId))
    expect(row?.violations.map((v) => v.code)).toEqual(['393.75A3', '392.2C'])
  }, 300_000)

  it('refuse a CSA weight outside the 1–10 scale', async () => {
    // A typo here would eventually be summed into a BASIC percentile.
    const outcome = await inOrg((tx) =>
      addViolation(tx, {
        inspectionId,
        code: '396.3A1',
        unit: 'VEHICLE',
        outOfService: false,
        severityWeight: 80,
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'bad_weight' })
  }, 300_000)

  it('refuse to attach to an inspection that is not there', async () => {
    const outcome = await inOrg((tx) =>
      addViolation(tx, {
        inspectionId: 'ckdoesnotexist000000000',
        code: '393.75A3',
        unit: 'VEHICLE',
        outOfService: false,
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'inspection_not_found' })
  }, 300_000)

  it('and a withdrawn one makes the inspection clean again', async () => {
    // Because clean is read off the children. A stored flag would still say
    // "out of service" here, which is the whole argument for deriving it.
    const row = await inOrg((tx) => inspectionById(tx, inspectionId))
    for (const violation of row!.violations) {
      expect(await inOrg((tx) => withdrawViolation(tx, violation.id))).toBe(
        true,
      )
    }

    const after = await inOrg((tx) => inspectionById(tx, inspectionId))
    expect(after?.violations).toEqual([])
    expect(after?.isClean).toBe(true)
    expect(after?.outOfService).toBe(false)
  }, 300_000)

  it('and withdrawing the same one twice is not a second withdrawal', async () => {
    const row = await owner.inspectionViolation.findFirstOrThrow({
      where: { inspectionId, deletedAt: { not: null } },
      select: { id: true, deletedAt: true },
    })
    expect(await inOrg((tx) => withdrawViolation(tx, row.id))).toBe(false)

    const unchanged = await owner.inspectionViolation.findUniqueOrThrow({
      where: { id: row.id },
      select: { deletedAt: true },
    })
    expect(unchanged.deletedAt?.getTime()).toBe(row.deletedAt?.getTime())
  }, 300_000)
})

describe('the lists', () => {
  it('put an asset history and the fleet list in the same order', async () => {
    const fleet = await inOrg((tx) => inspectionList(tx, {}))
    const onTruck = await inOrg((tx) =>
      inspectionsForSubject(tx, 'truck', truckId),
    )

    // Newest first in both, and the truck's own history is a subset.
    expect(fleet.length).toBeGreaterThan(onTruck.length)
    const dates = onTruck.map((row) => row.inspectedAt.getTime())
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
    for (const row of onTruck) {
      expect(row.truck?.id).toBe(truckId)
    }
  }, 300_000)

  it('keep a driver-only inspection off the truck history and on the driver one', async () => {
    const onTruck = await inOrg((tx) =>
      inspectionsForSubject(tx, 'truck', truckId),
    )
    const onDriver = await inOrg((tx) =>
      inspectionsForSubject(tx, 'driver', driverId),
    )

    const levelThree = onDriver.find((row) => row.level === 'LEVEL_3')
    expect(levelThree, 'the Level III is missing from the driver').toBeDefined()
    expect(onTruck.map((row) => row.id)).not.toContain(levelThree!.id)
  }, 300_000)

  it('honour the authority scope', async () => {
    const beta = await inOrg((tx) =>
      inspectionList(tx, { companyId: { in: [otherCompanyId] } }),
    )
    expect(beta).toEqual([])
  }, 300_000)

  it('filter to the ones that grounded something, in SQL', async () => {
    const grounded = await inOrg((tx) =>
      recordInspection(tx, {
        truckId,
        inspectedAt: DAY('2026-05-02'),
        level: 'LEVEL_1',
        state: 'IL',
      }),
    )
    await inOrg((tx) =>
      addViolation(tx, {
        inspectionId: grounded.ok ? grounded.inspectionId : '',
        code: '396.3A1BT',
        unit: 'VEHICLE',
        outOfService: true,
      }),
    )

    const oos = await inOrg((tx) =>
      inspectionList(tx, {}, { outOfService: true }),
    )
    expect(oos.map((row) => row.id)).toEqual([
      grounded.ok ? grounded.inspectionId : '',
    ])
    // And it really is the predicate, not a coincidence of the fixture.
    for (const row of oos) expect(row.outOfService).toBe(true)
  }, 300_000)

  it('filter by level and by subject', async () => {
    const driverOnly = await inOrg((tx) =>
      inspectionList(tx, {}, { level: 'LEVEL_3' }),
    )
    expect(driverOnly.every((row) => row.level === 'LEVEL_3')).toBe(true)

    const withTrailer = await inOrg((tx) =>
      inspectionList(tx, {}, { subject: 'trailer' }),
    )
    expect(withTrailer.every((row) => row.trailer !== null)).toBe(true)
  }, 300_000)
})

describe('the report', () => {
  it('comes back attached to the inspection it was filed against', async () => {
    const inspection = await owner.roadsideInspection.findFirstOrThrow({
      where: { companyId, level: 'LEVEL_1', state: 'IN' },
      select: { id: true },
    })

    await owner.document.create({
      data: {
        organizationId,
        companyId,
        type: 'INSPECTION_REPORT',
        filename: `inspection-${nonce}.pdf`,
        r2Key: `${organizationId}/inspection/${inspection.id}/${nonce}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        inspectionId: inspection.id,
      },
    })

    const documents = await inOrg((tx) =>
      documentsForInspections(tx, [inspection.id]),
    )
    expect(documents.get(inspection.id)?.[0]?.filename).toBe(
      `inspection-${nonce}.pdf`,
    )

    const row = await inOrg((tx) => inspectionById(tx, inspection.id))
    expect(row?.documentCount).toBe(1)
  }, 300_000)

  it('asks for nothing when there are no inspections to ask about', async () => {
    expect(await inOrg((tx) => documentsForInspections(tx, []))).toEqual(
      new Map(),
    )
  }, 300_000)
})
