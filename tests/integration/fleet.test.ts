import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import {
  TransferError,
  createDriver,
  createTrailer,
  createTruck,
  currentAuthority,
  findAuthorityDrift,
  restoreAsset,
  retireAsset,
  transferAsset,
  updateDriver,
  updateTruck,
} from '@/lib/fleet'
import { createBroker, retireBroker, updateBroker } from '@/lib/brokers'
import { ReferenceError } from '@/lib/reference'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Phase 2 §13: a broker, truck, trailer and driver each created, edited and
// soft-deleted; a transfer that writes a closed period and a new open one;
// a double-open refused.
//
// STANDING RULE 11 governs the shape of every refusal test below. A negative
// check proves nothing on its own — `expect(...).rejects` passes just as
// happily when the request was malformed for some unrelated reason, or when
// the code under test was never reached. So each refusal is paired with the
// SAME call succeeding once the single reason for the refusal is removed.
// Without the pair, "it refused" and "it never ran" are indistinguishable.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let app: PrismaClient

let organizationId = ''
let alphaId = ''
let bravoId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)

/** Every write goes through the app role and the tenant scope, as a route would. */
const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'fleet.test' },
    // See the note in loads.test.ts: 2s of pool wait is enough when this file
    // runs alone and not when it runs eighth.
    maxWaitMs: 15_000,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  app = retryingClient(process.env.DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Fleet ${nonce}`,
      slug: `fleet-${nonce}`,
      maxCompanies: 5,
      companies: {
        create: [{ name: `Alpha ${nonce}` }, { name: `Bravo ${nonce}` }],
      },
    },
    include: { companies: { orderBy: { name: 'asc' } } },
  })
  organizationId = organization.id
  alphaId = organization.companies[0]!.id
  bravoId = organization.companies[1]!.id

  const user = await owner.user.create({
    data: { email: `fleet-${nonce}@example.test`, name: 'Fleet Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
})

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await app.$disconnect()
  await owner.$disconnect()
})

describe('trucks', () => {
  it('is created, edited and soft-deleted', async () => {
    const truck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `101-${nonce}`,
        make: 'Freightliner',
        year: '2021',
        plateState: 'il',
        currentOdometer: '412,000',
      }),
    )
    expect(truck.year).toBe(2021)
    // Normalised on the way in, so "il" and "IL" are one state.
    expect(truck.plateState).toBe('IL')
    // Commas stripped: a dispatcher types an odometer the way they read it.
    expect(truck.currentOdometer).toBe(412_000)

    const edited = await inOrg((tx) =>
      updateTruck(tx, truck.id, {
        unitNumber: `101-${nonce}`,
        make: 'Peterbilt',
        model: '579',
      }),
    )
    expect(edited.make).toBe('Peterbilt')

    await inOrg((tx) => retireAsset(tx, 'truck', truck.id))
    const after = await inOrg((tx) =>
      tx.truck.findUnique({ where: { id: truck.id } }),
    )
    // Soft: the row survives, because forty loads of history point at it.
    expect(after?.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses a duplicate unit number, and accepts the same call once it is unique', async () => {
    // Rule 11. The negative alone would pass if createTruck threw for any
    // reason at all — a missing company, a bad year, a typo in the test.
    const unit = `dup-${nonce}`
    await inOrg((tx) =>
      createTruck(tx, organizationId, { companyId: alphaId, unitNumber: unit }),
    )

    await expect(
      inOrg((tx) =>
        createTruck(tx, organizationId, {
          companyId: alphaId,
          unitNumber: unit,
        }),
      ),
    ).rejects.toMatchObject({ code: 'duplicate', field: 'unitNumber' })

    // Same call, one character different. If this fails, the refusal above was
    // measuring something else.
    const ok = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `${unit}-b`,
      }),
    )
    expect(ok.unitNumber).toBe(`${unit}-b`)

    // ...and the SAME unit number under a different authority is fine, because
    // the index is per company. Second half of the same pairing.
    const elsewhere = await inOrg((tx) =>
      createTruck(tx, organizationId, { companyId: bravoId, unitNumber: unit }),
    )
    expect(elsewhere.companyId).toBe(bravoId)
  })

  it('frees the unit number when a truck is removed', async () => {
    // Step 2 shipped this the other way round: the unique index had no
    // `WHERE deletedAt IS NULL` predicate, so a removed truck kept holding its
    // number and the service explained the collision. The partial index in
    // 20260731003653 makes the number genuinely free, which is what a person
    // expects after removing something.
    const unit = `ghost-${nonce}`
    const first = await inOrg((tx) =>
      createTruck(tx, organizationId, { companyId: alphaId, unitNumber: unit }),
    )
    await inOrg((tx) => retireAsset(tx, 'truck', first.id))

    const second = await inOrg((tx) =>
      createTruck(tx, organizationId, { companyId: alphaId, unitNumber: unit }),
    )
    expect(second.id).not.toBe(first.id)
    expect(second.unitNumber).toBe(unit)
  })

  it('refuses to restore a truck whose number has since been taken, and allows it once freed', async () => {
    // The case the partial index creates. Both trucks cannot be live under one
    // number, and the one being restored is the one that has to give way.
    const unit = `taken-${nonce}`
    const original = await inOrg((tx) =>
      createTruck(tx, organizationId, { companyId: alphaId, unitNumber: unit }),
    )
    await inOrg((tx) => retireAsset(tx, 'truck', original.id))

    const replacement = await inOrg((tx) =>
      createTruck(tx, organizationId, { companyId: alphaId, unitNumber: unit }),
    )

    const failure = await inOrg((tx) =>
      restoreAsset(tx, 'truck', original.id, organizationId).catch(
        (error: unknown) => error,
      ),
    )
    expect(failure).toBeInstanceOf(ReferenceError)
    expect(failure).toMatchObject({
      code: 'number_taken_since',
      conflictId: replacement.id,
    })

    // Rule 11's pairing: renumber the replacement and the identical restore
    // succeeds — so the refusal was about the number, not about restore.
    await inOrg((tx) =>
      updateTruck(tx, replacement.id, { unitNumber: `${unit}-b` }),
    )
    await inOrg((tx) => restoreAsset(tx, 'truck', original.id, organizationId))
    const restored = await inOrg((tx) =>
      tx.truck.findUnique({ where: { id: original.id } }),
    )
    expect(restored?.deletedAt).toBeNull()
  })

  it('lets Postgres, not the check, be the last word on uniqueness', async () => {
    // The partial index is the guarantee; assertUnitAvailable is only the
    // message. If the index were dropped, this would silently start passing.
    const unit = `idx-${nonce}`
    await inOrg((tx) =>
      createTruck(tx, organizationId, { companyId: alphaId, unitNumber: unit }),
    )

    await expect(
      inOrg((tx) =>
        tx.truck.create({
          data: { organizationId, companyId: alphaId, unitNumber: unit },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' })

    // The pairing: the same insert with deletedAt set is accepted, which is
    // exactly what the `WHERE deletedAt IS NULL` predicate is for.
    const removed = await inOrg((tx) =>
      tx.truck.create({
        data: {
          organizationId,
          companyId: alphaId,
          unitNumber: unit,
          deletedAt: new Date(),
        },
      }),
    )
    expect(removed.unitNumber).toBe(unit)
  })

  it('refuses an implausible year, and accepts a plausible one', async () => {
    await expect(
      inOrg((tx) =>
        createTruck(tx, organizationId, {
          companyId: alphaId,
          unitNumber: `yr-${nonce}`,
          year: '202',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_year' })

    const ok = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `yr-${nonce}`,
        year: '2020',
      }),
    )
    expect(ok.year).toBe(2020)
  })

  it('refuses an authority outside the organization, and accepts one inside', async () => {
    const outsider = await owner.organization.create({
      data: {
        name: `Outsider ${nonce}`,
        slug: `outsider-${nonce}`,
        companies: { create: [{ name: 'Theirs' }] },
      },
      include: { companies: true },
    })

    try {
      await expect(
        inOrg((tx) =>
          createTruck(tx, organizationId, {
            companyId: outsider.companies[0]!.id,
            unitNumber: `x-${nonce}`,
          }),
        ),
      ).rejects.toMatchObject({ code: 'invalid_authority' })

      // The pairing proves the refusal was about the ORGANIZATION, not about
      // the id being unknown or the call being wrong.
      const ok = await inOrg((tx) =>
        createTruck(tx, organizationId, {
          companyId: alphaId,
          unitNumber: `x-${nonce}`,
        }),
      )
      expect(ok.companyId).toBe(alphaId)
    } finally {
      await owner.organization.delete({ where: { id: outsider.id } })
    }
  })
})

describe('trailers and drivers', () => {
  it('creates a trailer and soft-deletes it', async () => {
    const trailer = await inOrg((tx) =>
      createTrailer(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `R-${nonce}`,
        type: 'Reefer',
      }),
    )
    expect(trailer.type).toBe('Reefer')

    await inOrg((tx) => retireAsset(tx, 'trailer', trailer.id))
    const after = await inOrg((tx) =>
      tx.trailer.findUnique({ where: { id: trailer.id } }),
    )
    expect(after?.deletedAt).toBeInstanceOf(Date)
  })

  it('creates, edits and soft-deletes a driver', async () => {
    const driver = await inOrg((tx) =>
      createDriver(tx, organizationId, {
        companyId: alphaId,
        firstName: 'Aziz',
        lastName: 'Karimov',
        cdlState: 'wa',
        hireDate: '2026-03-02',
      }),
    )
    expect(driver.cdlState).toBe('WA')
    // Date-only, parsed as UTC midnight. Anything else turns the 2nd into the
    // 1st for everyone west of Greenwich.
    expect(driver.hireDate?.toISOString()).toBe('2026-03-02T00:00:00.000Z')

    const edited = await inOrg((tx) =>
      updateDriver(tx, driver.id, {
        firstName: 'Aziz',
        lastName: 'Karimova',
        status: 'OFF_DUTY',
      }),
    )
    expect(edited.lastName).toBe('Karimova')
    expect(edited.status).toBe('OFF_DUTY')

    await inOrg((tx) => retireAsset(tx, 'driver', driver.id))
    const after = await inOrg((tx) =>
      tx.driver.findUnique({ where: { id: driver.id } }),
    )
    expect(after?.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses a driver with no last name, and accepts one with it', async () => {
    await expect(
      inOrg((tx) =>
        createDriver(tx, organizationId, {
          companyId: alphaId,
          firstName: 'Nameless',
          lastName: '   ',
        }),
      ),
    ).rejects.toMatchObject({ code: 'required', field: 'lastName' })

    const ok = await inOrg((tx) =>
      createDriver(tx, organizationId, {
        companyId: alphaId,
        firstName: 'Nameless',
        lastName: 'Now',
      }),
    )
    expect(ok.lastName).toBe('Now')
  })
})

describe('brokers', () => {
  it('is created, edited and soft-deleted', async () => {
    const broker = await inOrg((tx) =>
      createBroker(tx, organizationId, {
        name: `Cargo Partners ${nonce}`,
        mcNumber: 'MC-778812',
        state: 'tx',
      }),
    )
    expect(broker.state).toBe('TX')
    expect(broker.paymentTermsDays).toBe(30)
    // Org-level, not company-level: one broker for every authority.
    expect(broker).not.toHaveProperty('companyId')

    const edited = await inOrg((tx) =>
      updateBroker(tx, broker.id, {
        name: `Cargo Partners ${nonce}`,
        paymentTermsDays: '45',
      }),
    )
    expect(edited.paymentTermsDays).toBe(45)

    await inOrg((tx) => retireBroker(tx, broker.id))
    const after = await inOrg((tx) =>
      tx.customer.findUnique({ where: { id: broker.id } }),
    )
    expect(after?.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses a block with no reason, and accepts one with a reason', async () => {
    // BIG M II: a broker that stopped paying was a note nobody read, and the
    // operation kept hauling for them.
    await expect(
      inOrg((tx) =>
        createBroker(tx, organizationId, {
          name: `Silent ${nonce}`,
          status: 'BLOCKED',
        }),
      ),
    ).rejects.toMatchObject({ code: 'required', field: 'blockedReason' })

    const ok = await inOrg((tx) =>
      createBroker(tx, organizationId, {
        name: `Silent ${nonce}`,
        status: 'BLOCKED',
        blockedReason: 'Ninety days past due on four invoices.',
      }),
    )
    expect(ok.blockedReason).toContain('Ninety days')

    // And the reason is dropped when the block is lifted, rather than left
    // behind to reappear the next time somebody blocks them.
    const lifted = await inOrg((tx) =>
      updateBroker(tx, ok.id, { name: ok.name, status: 'ACTIVE' }),
    )
    expect(lifted.blockedReason).toBeNull()
  })
})

describe('transferring an asset between authorities', () => {
  it('closes the old period, opens a new one, and moves the asset', async () => {
    const truck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `mv-${nonce}`,
      }),
    )
    const result = await inOrg((tx) =>
      transferAsset(tx, organizationId, 'truck', truck.id, bravoId, {
        reason: 'Bravo took the lane',
        byUserId: userId,
      }),
    )

    expect(result.fromCompanyId).toBe(alphaId)
    expect(result.toCompanyId).toBe(bravoId)
    expect(result.closedAssignmentId).not.toBeNull()

    const periods = await inOrg((tx) =>
      tx.assetAssignment.findMany({
        where: { truckId: truck.id },
        orderBy: { effectiveFrom: 'asc' },
      }),
    )
    expect(periods).toHaveLength(2)
    expect(periods[0]!.companyId).toBe(alphaId)
    expect(periods[0]!.effectiveTo).toBeInstanceOf(Date)
    expect(periods[1]!.companyId).toBe(bravoId)
    expect(periods[1]!.effectiveTo).toBeNull()
    expect(periods[1]!.reason).toBe('Bravo took the lane')
    // Who moved it. Six months from now this is the only answer available.
    expect(periods[1]!.createdByUserId).toBe(userId)

    // The asset's own column agrees with the open period. They are two
    // representations of one fact and nothing in the schema makes them match.
    const moved = await inOrg((tx) =>
      tx.truck.findUnique({ where: { id: truck.id } }),
    )
    expect(moved?.companyId).toBe(bravoId)
    expect(
      (await inOrg((tx) => currentAuthority(tx, 'truck', truck.id)))?.companyId,
    ).toBe(bravoId)
  })

  it('refuses a move to the authority it already works under, and allows the real move', async () => {
    const driver = await inOrg((tx) =>
      createDriver(tx, organizationId, {
        companyId: alphaId,
        firstName: 'Stay',
        lastName: 'Put',
      }),
    )

    await expect(
      inOrg((tx) =>
        transferAsset(tx, organizationId, 'driver', driver.id, alphaId),
      ),
    ).rejects.toBeInstanceOf(TransferError)

    // Rule 11's pairing: the same call to the OTHER authority succeeds, so the
    // refusal was about the destination and not about transfers being broken.
    const result = await inOrg((tx) =>
      transferAsset(tx, organizationId, 'driver', driver.id, bravoId),
    )
    expect(result.toCompanyId).toBe(bravoId)
  })

  it('refuses a second open period — enforced by Postgres, not by the check', async () => {
    const trailer = await inOrg((tx) =>
      createTrailer(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `dbl-${nonce}`,
      }),
    )

    // Going around the service to prove the partial unique index is what
    // actually holds the line. If this ever stops throwing, every check above
    // it is decoration.
    await expect(
      inOrg((tx) =>
        tx.assetAssignment.create({
          data: { organizationId, companyId: bravoId, trailerId: trailer.id },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' })

    // The pairing: an identical row with the first period CLOSED is accepted.
    // Same table, same columns, one difference — which is what makes the
    // refusal above evidence about the index rather than about the insert.
    await inOrg((tx) =>
      tx.assetAssignment.updateMany({
        where: { trailerId: trailer.id, effectiveTo: null },
        data: { effectiveTo: new Date() },
      }),
    )
    const second = await inOrg((tx) =>
      tx.assetAssignment.create({
        data: { organizationId, companyId: bravoId, trailerId: trailer.id },
      }),
    )
    expect(second.effectiveTo).toBeNull()
  })

  it('refuses to transfer a removed asset, and allows it once restored', async () => {
    const truck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `gone-${nonce}`,
      }),
    )
    await inOrg((tx) => retireAsset(tx, 'truck', truck.id))

    await expect(
      inOrg((tx) =>
        transferAsset(tx, organizationId, 'truck', truck.id, bravoId),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })

    await inOrg((tx) => restoreAsset(tx, 'truck', truck.id, organizationId))
    const result = await inOrg((tx) =>
      transferAsset(tx, organizationId, 'truck', truck.id, bravoId),
    )
    expect(result.toCompanyId).toBe(bravoId)
  })

  it('retiring an asset closes its open period', async () => {
    // Otherwise a removed truck stays "assigned" to an authority forever, and
    // the open-period index blocks a genuinely new truck from taking its place.
    const truck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `close-${nonce}`,
      }),
    )
    await inOrg((tx) => retireAsset(tx, 'truck', truck.id))

    expect(
      await inOrg((tx) => currentAuthority(tx, 'truck', truck.id)),
    ).toBeNull()
  })

  it('opens the first period at creation, not at the first transfer', async () => {
    // Found by the Step 2 walkthrough against the deployed worker: a truck
    // added through the interface had a companyId and no period at all, so
    // `currentAuthority` said null and the detail screen said "no open period
    // recorded" for a truck that plainly worked for somebody. §8 treats the
    // open assignment as the authority of record for dispatch conflicts, so
    // the history has to start where the asset does.
    for (const kind of ['truck', 'trailer', 'driver'] as const) {
      const id =
        kind === 'truck'
          ? (
              await inOrg((tx) =>
                createTruck(tx, organizationId, {
                  companyId: alphaId,
                  unitNumber: `first-${nonce}`,
                }),
              )
            ).id
          : kind === 'trailer'
            ? (
                await inOrg((tx) =>
                  createTrailer(tx, organizationId, {
                    companyId: alphaId,
                    unitNumber: `first-${nonce}`,
                  }),
                )
              ).id
            : (
                await inOrg((tx) =>
                  createDriver(tx, organizationId, {
                    companyId: alphaId,
                    firstName: 'First',
                    lastName: `Period-${nonce}`,
                  }),
                )
              ).id

      const open = await inOrg((tx) => currentAuthority(tx, kind, id))
      expect(open, `${kind} should have an open period`).not.toBeNull()
      expect(open?.companyId).toBe(alphaId)
    }
  })
})

describe('the authority-drift assertion', () => {
  /**
   * Scoped to one asset on purpose.
   *
   * This suite shares an organization with every test above it, and two of
   * those deliberately write rows around the service layer — the raw
   * `tx.truck.create` that proves the partial index holds the line, for one.
   * Those rows have no period and are drift by construction, which is the
   * check working. A global count here would be asserting on other tests'
   * leftovers; `tests/integrity.test.ts` is where the whole-database claim
   * lives, and it runs against a database these fixtures have been deleted
   * from.
   */
  const driftFor = async (assetId: string) =>
    (await inOrg((tx) => findAuthorityDrift(tx))).filter(
      (row) => row.assetId === assetId,
    )

  it('finds nothing when an asset agrees with its open period', async () => {
    const truck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `drift-ok-${nonce}`,
      }),
    )
    expect(await driftFor(truck.id)).toEqual([])
  })

  it('finds the asset when a companyId is moved without a period', async () => {
    // The pairing that makes tests/integrity.test.ts mean something. That test
    // asserts zero rows against a database where nothing has gone wrong, which
    // is exactly the shape of an assertion that passes because it never ran.
    // Here the damage is done deliberately — the raw update the lint rule
    // exists to forbid — and the check has to notice.
    const truck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `drift-bad-${nonce}`,
      }),
    )

    await inOrg(
      (tx) =>
        tx.$executeRaw`UPDATE "Truck" SET "companyId" = ${bravoId} WHERE id = ${truck.id}`,
    )

    expect(await driftFor(truck.id)).toEqual([
      {
        kind: 'truck',
        assetId: truck.id,
        assetCompanyId: bravoId,
        openPeriodCompanyId: alphaId,
      },
    ])

    // Put it back. Cleanup and pairing in one: if the check does not go quiet
    // again once the row is repaired, it was not measuring the row.
    await inOrg(
      (tx) =>
        tx.$executeRaw`UPDATE "Truck" SET "companyId" = ${alphaId} WHERE id = ${truck.id}`,
    )
    expect(await driftFor(truck.id)).toEqual([])
  })
})

describe('the audit trail these writes leave', () => {
  it('records the transfer with the user who made it', async () => {
    const truck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `audit-${nonce}`,
      }),
    )

    const rows = await inOrg((tx) =>
      tx.auditLog.findMany({
        where: { entityType: 'Truck', entityId: truck.id },
      }),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.action).toBe('CREATE')
    expect(rows[0]!.userId).toBe(userId)
  })
})

describe('a driver and their truck run under one authority', () => {
  // §7 dispatches on truck AND driver, and both carry an authority of record —
  // the MC number the asset runs under, the insurance covering it, the
  // settlement it is paid from. A driver from Alpha sitting in a Bravo truck
  // is a load running under paperwork that does not describe it, so the
  // pairing is refused rather than quietly moving either row.
  //
  // STANDING RULE 11: the refusal below is paired with the identical call
  // succeeding once the single reason for it — the authority — is removed.

  it('pairs a driver with a truck under the same authority', async () => {
    const truck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `pair-ok-${nonce}`,
      }),
    )
    const driver = await inOrg((tx) =>
      createDriver(tx, organizationId, {
        companyId: alphaId,
        firstName: 'Pair',
        lastName: `Ok ${nonce}`,
        assignedTruckId: truck.id,
      }),
    )

    expect(driver.assignedTruckId).toBe(truck.id)
  })

  it('refuses a truck from another authority, in words', async () => {
    const bravoTruck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: bravoId,
        unitNumber: `pair-bad-${nonce}`,
      }),
    )

    await expect(
      inOrg((tx) =>
        createDriver(tx, organizationId, {
          companyId: alphaId,
          firstName: 'Pair',
          lastName: `Bad ${nonce}`,
          assignedTruckId: bravoTruck.id,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'truck_other_authority',
      field: 'assignedTruckId',
    })

    // The pair. Same call, same driver, same truck — with the truck moved to
    // Alpha through the one mechanism that may move it. If this does not now
    // succeed, the refusal above proved nothing about authorities.
    await inOrg((tx) =>
      transferAsset(tx, organizationId, 'truck', bravoTruck.id, alphaId, {
        reason: 'pairing test',
        byUserId: userId,
      }),
    )
    const driver = await inOrg((tx) =>
      createDriver(tx, organizationId, {
        companyId: alphaId,
        firstName: 'Pair',
        lastName: `Bad ${nonce}`,
        assignedTruckId: bravoTruck.id,
      }),
    )
    expect(driver.assignedTruckId).toBe(bravoTruck.id)
  })

  it('lets an edit clear the pairing', async () => {
    const truck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId: alphaId,
        unitNumber: `pair-clear-${nonce}`,
      }),
    )
    const driver = await inOrg((tx) =>
      createDriver(tx, organizationId, {
        companyId: alphaId,
        firstName: 'Pair',
        lastName: `Clear ${nonce}`,
        assignedTruckId: truck.id,
      }),
    )

    const cleared = await inOrg((tx) =>
      updateDriver(tx, driver.id, {
        firstName: 'Pair',
        lastName: `Clear ${nonce}`,
        assignedTruckId: '',
      }),
    )
    expect(cleared.assignedTruckId).toBeNull()
  })

  it('refuses a truck that does not exist', async () => {
    await expect(
      inOrg((tx) =>
        createDriver(tx, organizationId, {
          companyId: alphaId,
          firstName: 'Pair',
          lastName: `Ghost ${nonce}`,
          assignedTruckId: 'ckzzzzzzzzzzzzzzzzzzzzzzz',
        }),
      ),
    ).rejects.toBeInstanceOf(ReferenceError)
  })
})
