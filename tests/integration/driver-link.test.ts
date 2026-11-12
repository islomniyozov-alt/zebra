import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { createUser } from '@/lib/users'
import { setRosterStatus } from '@/lib/fleet'
import {
  deactivateLinkedSignIn,
  linkableUsers,
  linkDriverSignIn,
  signInLinkFor,
  unlinkDriverSignIn,
} from '@/lib/driver-link'
import { dropOrganization, seedOrganization, type OrgFixture } from './fixtures'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE LINK BETWEEN A ROSTER ROW AND A SIGN-IN (Phase 7 step 1), AGAINST REAL
// POSTGRES.
//
// Two organizations, two drivers in the first, and four sign-ins: X and Y
// hold the DRIVER role in org A, Z is A's dispatcher, W drives for org B.
// The questions, in the order the owner asked them (2026-11-12):
//
//   - ONE PREDICATE for "user may be linked" — role DRIVER, not already
//     linked, same organization — and the SQL spelling of it agrees with the
//     Prisma one, both sides above zero, before and after a link.
//   - OWNER/ADMIN link on the driver record; the audit row names who.
//   - Termination deactivates the sign-in in the same write; re-linking is a
//     new act that reactivates it.
//   - The second driver never carries the first's link.
//
// STANDING RULE 11 throughout: every refusal is paired with the same call
// succeeding once the single reason for it is removed.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let orgA: OrgFixture
let orgB: OrgFixture
let driverA1 = ''
let driverA2 = ''
let userX = ''
let userY = ''
let userZ = ''
let userW = ''

const nonce = Math.random().toString(36).slice(2, 8)
const address = (label: string) => `${label}+l${nonce}@example.test`

const inOrg = <T>(
  fixture: OrgFixture,
  fn: Parameters<typeof withOrg<T>>[1],
): Promise<T> =>
  withOrg(fixture.organizationId, fn, {
    attribution: {
      userId: fixture.userId,
      ip: null,
      userAgent: 'driver-link.test',
    },
    maxWaitMs: 15_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

async function mint(
  fixture: OrgFixture,
  label: string,
  role: 'DRIVER' | 'DISPATCHER',
): Promise<string> {
  const outcome = await inOrg(fixture, (tx) =>
    createUser(tx, fixture.organizationId, 'OWNER', {
      name: `${label} ${nonce}`,
      email: address(label.toLowerCase()),
      role,
      companyIds: [],
    }),
  )
  if (!outcome.ok) throw new Error(`mint ${label}: ${outcome.reason}`)
  return outcome.userId
}

/**
 * THE PREDICATE IN SQL — written from the words, not from the Prisma object,
 * so the two can disagree. Run inside the tenant transaction like the listing.
 */
const linkableIdsBySql = (organizationId: string) =>
  inOrg(orgA, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT u.id
      FROM "Membership" m
      JOIN "User" u ON u.id = m."userId"
      WHERE m."organizationId" = ${organizationId}
        AND m."role" = 'DRIVER'::"Role"
        AND NOT EXISTS (
          SELECT 1 FROM "Driver" d
          WHERE d."userId" = u.id
            AND d."organizationId" = m."organizationId"
            AND d."deletedAt" IS NULL
        )
      ORDER BY u.id
    `
    return rows.map((row) => row.id)
  })

const linkableIdsByPrisma = () =>
  inOrg(orgA, async (tx) =>
    (await linkableUsers(tx, orgA.organizationId))
      .map((row) => row.userId)
      .sort(),
  )

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  orgA = await seedOrganization(owner, 'linkA', nonce)
  orgB = await seedOrganization(owner, 'linkB', nonce)
  driverA1 = orgA.ids['driver']![0]!
  const second = await owner.driver.create({
    data: {
      organizationId: orgA.organizationId,
      companyId: orgA.companyId,
      firstName: 'Second',
      lastName: `Driver ${nonce}`,
    },
    select: { id: true },
  })
  driverA2 = second.id
  orgA.ids['driver']!.push(driverA2)

  userX = await mint(orgA, 'Xavier', 'DRIVER')
  userY = await mint(orgA, 'Yusuf', 'DRIVER')
  userZ = await mint(orgA, 'Zarina', 'DISPATCHER')
  userW = await mint(orgB, 'Walid', 'DRIVER')
}, 180_000)

afterAll(async () => {
  await owner.user.deleteMany({ where: { email: { contains: `+l${nonce}@` } } })
  await dropOrganization(owner, orgA)
  await dropOrganization(owner, orgB)
  await owner.$disconnect()
})

describe('one predicate for "user may be linked"', () => {
  it('SQL and Prisma agree, both above zero, before any link', async () => {
    const sql = await linkableIdsBySql(orgA.organizationId)
    const prisma = await linkableIdsByPrisma()
    expect(sql.length).toBeGreaterThan(0)
    expect(prisma).toEqual(sql)
    // X and Y, and nobody else: not the dispatcher, not org B's driver.
    expect(prisma).toEqual([userX, userY].sort())
    expect(prisma).not.toContain(userZ)
    expect(prisma).not.toContain(userW)
  })

  it('the card offers the same list, and nothing while a sign-in is linked', async () => {
    const before = await inOrg(orgA, (tx) =>
      signInLinkFor(tx, orgA.organizationId, driverA1),
    )
    expect(before?.linked).toBeNull()
    expect(before?.candidates.map((c) => c.userId).sort()).toEqual(
      [userX, userY].sort(),
    )
  })
})

describe('the link, by the office, audited', () => {
  it('links X to the first driver and the audit row names who', async () => {
    const outcome = await inOrg(orgA, (tx) =>
      linkDriverSignIn(tx, orgA.organizationId, driverA1, userX),
    )
    expect(outcome).toEqual({ ok: true })

    const row = await owner.driver.findUniqueOrThrow({
      where: { id: driverA1 },
      select: { userId: true },
    })
    expect(row.userId).toBe(userX)

    // WHO: the transaction's attribution, on the Driver row's audit entry,
    // with the column that moved.
    const audit = await owner.auditLog.findFirst({
      where: { entityId: driverA1, userId: orgA.userId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    const changes = audit!.changes as Record<
      string,
      { from: unknown; to: unknown }
    >
    expect(changes['userId']).toEqual({ from: null, to: userX })
  })

  it('after the link the predicate drops X on both sides, still above zero', async () => {
    const sql = await linkableIdsBySql(orgA.organizationId)
    const prisma = await linkableIdsByPrisma()
    expect(sql.length).toBeGreaterThan(0)
    expect(prisma).toEqual(sql)
    expect(prisma).toEqual([userY])

    const view = await inOrg(orgA, (tx) =>
      signInLinkFor(tx, orgA.organizationId, driverA1),
    )
    expect(view?.linked?.userId).toBe(userX)
    expect(view?.candidates).toEqual([])
  })

  it('the second driver never carries the first’s link', async () => {
    const second = await owner.driver.findUniqueOrThrow({
      where: { id: driverA2 },
      select: { userId: true },
    })
    expect(second.userId).toBeNull()
  })

  it('refuses, by name: a sign-in already linked, a driver already linked', async () => {
    expect(
      await inOrg(orgA, (tx) =>
        linkDriverSignIn(tx, orgA.organizationId, driverA2, userX),
      ),
    ).toEqual({ ok: false, reason: 'user_already_linked' })
    expect(
      await inOrg(orgA, (tx) =>
        linkDriverSignIn(tx, orgA.organizationId, driverA1, userY),
      ),
    ).toEqual({ ok: false, reason: 'driver_already_linked' })
  })

  it('refuses, by name: not the Driver role, not a member here', async () => {
    expect(
      await inOrg(orgA, (tx) =>
        linkDriverSignIn(tx, orgA.organizationId, driverA2, userZ),
      ),
    ).toEqual({ ok: false, reason: 'not_a_driver_role' })
    // W holds the DRIVER role — in org B. Same org is part of the predicate.
    expect(
      await inOrg(orgA, (tx) =>
        linkDriverSignIn(tx, orgA.organizationId, driverA2, userW),
      ),
    ).toEqual({ ok: false, reason: 'not_a_member' })
  })

  it('refuses a terminated driver, and links once the termination is cleared', async () => {
    await owner.driver.update({
      where: { id: driverA2 },
      data: { terminationDate: new Date('2026-11-01T00:00:00Z') },
    })
    expect(
      await inOrg(orgA, (tx) =>
        linkDriverSignIn(tx, orgA.organizationId, driverA2, userY),
      ),
    ).toEqual({ ok: false, reason: 'driver_terminated' })

    await owner.driver.update({
      where: { id: driverA2 },
      data: { terminationDate: null },
    })
    expect(
      await inOrg(orgA, (tx) =>
        linkDriverSignIn(tx, orgA.organizationId, driverA2, userY),
      ),
    ).toEqual({ ok: true })
    // Nobody left to offer, on both sides.
    expect(await linkableIdsBySql(orgA.organizationId)).toEqual([])
    expect(await linkableIdsByPrisma()).toEqual([])
  })
})

describe('termination deactivates the sign-in in the same write (§4.7)', () => {
  it('a termination through the roster revokes the sessions, deactivates, unlinks', async () => {
    const session = await owner.session.create({
      data: {
        userId: userX,
        tokenHash: `link-${nonce}`,
        activeOrganizationId: orgA.organizationId,
        role: 'DRIVER',
        companyScopes: [],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    })

    const outcome = await inOrg(orgA, (tx) =>
      setRosterStatus(tx, driverA1, 'INACTIVE'),
    )
    expect(outcome.ok).toBe(true)

    const driver = await owner.driver.findUniqueOrThrow({
      where: { id: driverA1 },
      select: { userId: true, terminationDate: true },
    })
    expect(driver.terminationDate).not.toBeNull()
    expect(driver.userId).toBeNull()
    const user = await owner.user.findUniqueOrThrow({
      where: { id: userX },
      select: { isActive: true },
    })
    expect(user.isActive).toBe(false)
    const revoked = await owner.session.findUniqueOrThrow({
      where: { id: session.id },
      select: { revokedAt: true },
    })
    expect(revoked.revokedAt).not.toBeNull()
  })

  it('X is linkable again, deactivated, and re-linking reactivates', async () => {
    // Back on the roster: the office clears the termination first.
    await owner.driver.update({
      where: { id: driverA1 },
      data: { terminationDate: null, status: 'AVAILABLE' },
    })
    const view = await inOrg(orgA, (tx) =>
      signInLinkFor(tx, orgA.organizationId, driverA1),
    )
    expect(view?.candidates.map((c) => [c.userId, c.isActive])).toEqual([
      [userX, false],
    ])

    expect(
      await inOrg(orgA, (tx) =>
        linkDriverSignIn(tx, orgA.organizationId, driverA1, userX),
      ),
    ).toEqual({ ok: true })
    const user = await owner.user.findUniqueOrThrow({
      where: { id: userX },
      select: { isActive: true },
    })
    expect(user.isActive).toBe(true)
  })

  it('deactivating a driver with no link is a no-op that says so', async () => {
    await inOrg(orgA, (tx) => unlinkDriverSignIn(tx, driverA1))
    expect(
      await inOrg(orgA, (tx) => deactivateLinkedSignIn(tx, driverA1)),
    ).toEqual({ userId: null })
    // The sign-in itself is untouched by an unlink.
    const user = await owner.user.findUniqueOrThrow({
      where: { id: userX },
      select: { isActive: true },
    })
    expect(user.isActive).toBe(true)
  })
})

describe('unlink', () => {
  it('refuses when nothing is linked, and the pair succeeds once it is', async () => {
    expect(await inOrg(orgA, (tx) => unlinkDriverSignIn(tx, driverA1))).toEqual(
      { ok: false, reason: 'not_linked' },
    )
    await inOrg(orgA, (tx) =>
      linkDriverSignIn(tx, orgA.organizationId, driverA1, userX),
    )
    expect(await inOrg(orgA, (tx) => unlinkDriverSignIn(tx, driverA1))).toEqual(
      { ok: true },
    )
  })
})
