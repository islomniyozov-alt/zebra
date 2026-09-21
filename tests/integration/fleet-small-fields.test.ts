import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  createDriver,
  createTruck,
  updateDriver,
  updateTruck,
} from '@/lib/fleet'
import { agingDaysFrom, fleetStatusChangedForTrucks } from '@/lib/fleet-codes'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// ITEM 12 AGAINST REAL ROWS.
//
// The code lists are graded in `tests/fleet-codes.test.ts` against hand-built
// values. This grades what only a database can answer: that the aging number
// comes off the audit log the writes actually produce, that one trailer
// reaches one driver, and that the refusal arrives as a sentence before
// Postgres has to say anything.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''

const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'fleet-small-fields.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  organizationId = (
    await owner.organization.create({
      data: { name: `Fleet ${nonce}`, slug: `fleet-${nonce}` },
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
      data: { email: `fleet-${nonce}@example.test`, name: 'Fleet' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

describe('the small fields round-trip', () => {
  it('writes all five, and refuses a code-list value it does not know', async () => {
    const truck = await inOrg((tx) =>
      createTruck(
        tx,
        organizationId,
        {
          companyId,
          unitNumber: `S1-${nonce}`,
          vin: `VIN${nonce}AAAAAAAA`,
          fleetStatus: 'In shop',
          fuelType: 'Diesel',
          ownerName: 'Karimov Leasing',
          axles: '3',
          // COMMA-FORMATTED ON PURPOSE. The fleet board this data arrives from
          // writes `17,000`, and so does a person typing a weight.
          grossWeightLbs: '52,000',
        },
        { byUserId: userId },
      ),
    )

    const stored = await owner.truck.findUniqueOrThrow({
      where: { id: truck.id },
      select: {
        fleetStatus: true,
        fuelType: true,
        ownerName: true,
        axles: true,
        grossWeightLbs: true,
      },
    })
    expect(stored).toEqual({
      fleetStatus: 'In shop',
      fuelType: 'Diesel',
      ownerName: 'Karimov Leasing',
      axles: 3,
      grossWeightLbs: 52_000,
    })

    // THE GUARD NAMED "fleetStatus outside the list", at the writer rather
    // than at the reader. The column is TEXT, so nothing below this refuses.
    await expect(
      inOrg((tx) =>
        updateTruck(tx, truck.id, {
          unitNumber: `S1-${nonce}`,
          fleetStatus: 'Broken',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'not_in_code_list',
      field: 'fleetStatus',
    })

    // And the refused write changed nothing.
    const after = await owner.truck.findUniqueOrThrow({
      where: { id: truck.id },
      select: { fleetStatus: true },
    })
    expect(after.fleetStatus).toBe('In shop')
  })

  it('leaves every field null when nobody said anything', async () => {
    const truck = await inOrg((tx) =>
      createTruck(
        tx,
        organizationId,
        { companyId, unitNumber: `S2-${nonce}`, vin: `VIN${nonce}BBBBBBBB` },
        { byUserId: userId },
      ),
    )
    const stored = await owner.truck.findUniqueOrThrow({
      where: { id: truck.id },
      select: {
        fleetStatus: true,
        fuelType: true,
        ownerName: true,
        axles: true,
        grossWeightLbs: true,
      },
    })
    expect(Object.values(stored).every((value) => value === null)).toBe(true)
  })
})

describe('aging, off the audit log', () => {
  it('is null before any change and dated after one', async () => {
    const truck = await inOrg((tx) =>
      createTruck(
        tx,
        organizationId,
        {
          companyId,
          unitNumber: `A1-${nonce}`,
          vin: `VIN${nonce}CCCCCCCC`,
          fleetStatus: 'In service',
        },
        { byUserId: userId },
      ),
    )

    // A CREATE IS NOT A CHANGE OF STATUS. The unit has always been in this
    // state as far as anything can tell, and `createdAt` would answer with the
    // day of the import for 49 trucks that were on the road years before it.
    const before = await inOrg((tx) =>
      fleetStatusChangedForTrucks(tx, [truck.id]),
    )
    expect(before.get(truck.id)).toBeNull()
    expect(agingDaysFrom(before.get(truck.id) ?? null, new Date())).toBeNull()

    await inOrg((tx) =>
      updateTruck(tx, truck.id, {
        unitNumber: `A1-${nonce}`,
        fleetStatus: 'In shop',
      }),
    )

    const after = await inOrg((tx) =>
      fleetStatusChangedForTrucks(tx, [truck.id]),
    )
    const at = after.get(truck.id)
    expect(at).toBeInstanceOf(Date)
    expect(agingDaysFrom(at ?? null, new Date())).toBe(0)
  })

  it('ignores a write that changed something else', async () => {
    // The audit row exists either way; only the ones whose `changes` name
    // `fleetStatus` may move the number.
    const truck = await inOrg((tx) =>
      createTruck(
        tx,
        organizationId,
        {
          companyId,
          unitNumber: `A2-${nonce}`,
          vin: `VIN${nonce}DDDDDDDD`,
          fleetStatus: 'In service',
        },
        { byUserId: userId },
      ),
    )
    await inOrg((tx) =>
      updateTruck(tx, truck.id, {
        unitNumber: `A2-${nonce}`,
        fleetStatus: 'In service',
        notes: 'washed',
      }),
    )

    const out = await inOrg((tx) => fleetStatusChangedForTrucks(tx, [truck.id]))
    expect(out.get(truck.id)).toBeNull()
  })

  it('asks one question for twenty trucks', async () => {
    // A fan-out returns correct answers, which is why it is counted rather
    // than reviewed. Same instrument as item 11's.
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
      await client.$queryRaw`select 1`
      const before = count
      await fleetStatusChangedForTrucks(client as never, ids)
      const used = count - before
      await client.$disconnect()
      return used
    }

    const truck = await owner.truck.findFirstOrThrow({
      where: { organizationId },
      select: { id: true },
    })
    const one = await countFor([truck.id])
    const twenty = await countFor(Array.from({ length: 20 }, () => truck.id))
    expect(twenty).toBe(one)
  })
})

describe('one trailer, one driver', () => {
  let trailerId = ''
  let firstId = ''

  beforeAll(async () => {
    trailerId = (
      await owner.trailer.create({
        data: { organizationId, companyId, unitNumber: `TR-${nonce}` },
      })
    ).id
    firstId = (
      await inOrg((tx) =>
        createDriver(
          tx,
          organizationId,
          {
            companyId,
            firstName: 'FIRST',
            lastName: 'HOLDER',
            assignedTrailerId: trailerId,
          },
          { byUserId: userId },
        ),
      )
    ).id
  })

  it('gives the trailer to the first driver', async () => {
    const stored = await owner.driver.findUniqueOrThrow({
      where: { id: firstId },
      select: { assignedTrailerId: true },
    })
    expect(stored.assignedTrailerId).toBe(trailerId)
  })

  it('REFUSES the second, and names who has it', async () => {
    // THE GUARD NAMED "trailer on two drivers". A sentence, before Postgres
    // has to say anything — "that trailer is taken" without saying by whom is
    // a message that sends somebody to ask around.
    let caught: unknown
    try {
      await inOrg((tx) =>
        createDriver(
          tx,
          organizationId,
          {
            companyId,
            firstName: 'SECOND',
            lastName: 'CLAIMANT',
            assignedTrailerId: trailerId,
          },
          { byUserId: userId },
        ),
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      code: 'trailer_already_paired',
      field: 'assignedTrailerId',
    })
    expect((caught as Error).message).toContain('HOLDER')
  })

  it('lets the holder keep it on their own edit', async () => {
    // Colliding with yourself is not a collision, and a form that refused it
    // would make every other edit of this driver impossible.
    await expect(
      inOrg((tx) =>
        updateDriver(tx, firstId, {
          firstName: 'FIRST',
          lastName: 'HOLDER',
          assignedTrailerId: trailerId,
        }),
      ),
    ).resolves.toMatchObject({ assignedTrailerId: trailerId })
  })

  it('and the INDEX refuses it even with the sentence bypassed', async () => {
    // The check is the message; the index is the guarantee. A direct write
    // that never passes through `pairedTrailer` must still be refused.
    const other = await owner.driver.create({
      data: { organizationId, companyId, firstName: 'RAW', lastName: 'WRITE' },
    })
    await expect(
      owner.driver.update({
        where: { id: other.id },
        data: { assignedTrailerId: trailerId },
      }),
    ).rejects.toThrow(/driver_trailer_once|[Uu]nique constraint/)
  })

  it('frees the trailer when the holder is removed', async () => {
    // The index is partial on `deletedAt`, so a removed driver does not keep
    // holding a trailer against a live one.
    await owner.driver.update({
      where: { id: firstId },
      data: { deletedAt: new Date() },
    })
    const taker = await inOrg((tx) =>
      createDriver(
        tx,
        organizationId,
        {
          companyId,
          firstName: 'THIRD',
          lastName: 'TAKER',
          assignedTrailerId: trailerId,
        },
        { byUserId: userId },
      ),
    )
    expect(taker.assignedTrailerId).toBe(trailerId)
  })
})
