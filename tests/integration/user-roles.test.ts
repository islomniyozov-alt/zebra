import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { changeUserRole } from '@/lib/users'
import { dropOrganization, seedOrganization, type OrgFixture } from './fixtures'
import type { PrismaClient, Role } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// CHANGING A MEMBER'S ROLE (§6.11; owner's instruction 2026-11-13).
//
// Through the zebra_app role, two organizations, people made here by the
// owner connection. Standing rule 11 throughout: each refusal is paired with
// the same call succeeding once its single reason is removed.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let orgA: OrgFixture
let orgB: OrgFixture
const nonce = Math.random().toString(36).slice(2, 8)
const address = (label: string) => `${label}+r${nonce}@example.test`

const inOrgAs = <T>(
  fixture: { organizationId: string },
  actorId: string,
  fn: Parameters<typeof withOrg<T>>[1],
): Promise<T> =>
  withOrg(fixture.organizationId, fn, {
    attribution: { userId: actorId, ip: null, userAgent: 'user-roles.test' },
    maxWaitMs: 15_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  orgA = await seedOrganization(owner, `rolesA`, nonce)
  orgB = await seedOrganization(owner, `rolesB`, nonce)
}, 180_000)

afterAll(async () => {
  await dropOrganization(owner, orgA)
  await dropOrganization(owner, orgB)
  await owner.user.deleteMany({ where: { email: { contains: `+r${nonce}@` } } })
  await owner.$disconnect()
})

async function person(
  organizationId: string,
  label: string,
  role: Role,
): Promise<string> {
  const user = await owner.user.create({
    data: {
      email: address(label),
      name: `${label} ${nonce}`,
      passwordHash: 'x',
      isActive: true,
    },
    select: { id: true },
  })
  await owner.membership.create({
    data: { userId: user.id, organizationId, role },
  })
  return user.id
}

const liveSession = (userId: string, organizationId: string, tag: string) =>
  owner.session.create({
    data: {
      userId,
      activeOrganizationId: organizationId,
      role: 'ADMIN',
      tokenHash: `role-test-${tag}-${nonce}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })

const roleIn = async (organizationId: string, userId: string) =>
  (
    await owner.membership.findFirst({
      where: { userId, organizationId },
      select: { role: true },
    })
  )?.role

const ownerA = () => ({ userId: orgA.userId, role: 'OWNER' as const })
const changeInA = (
  actor: { userId: string; role: Role },
  target: string,
  to: Role,
) =>
  inOrgAs(orgA, actor.userId, (tx) =>
    changeUserRole(tx, orgA.organizationId, actor, target, to),
  )

describe('changing a role', () => {
  it('changes it, ends the sessions in THIS organization only, and writes one audit row old → new', async () => {
    const target = await person(orgA.organizationId, 'promote', 'ADMIN')
    await owner.membership.create({
      data: {
        userId: target,
        organizationId: orgB.organizationId,
        role: 'MANAGER',
      },
    })
    await liveSession(target, orgA.organizationId, 'a1')
    await liveSession(target, orgA.organizationId, 'a2')
    await liveSession(target, orgB.organizationId, 'b1')

    expect(await changeInA(ownerA(), target, 'MANAGER')).toEqual({
      ok: true,
      from: 'ADMIN',
      to: 'MANAGER',
      sessionsEnded: 2,
    })
    expect(await roleIn(orgA.organizationId, target)).toBe('MANAGER')
    // Org B's membership and session are untouched.
    expect(await roleIn(orgB.organizationId, target)).toBe('MANAGER')
    const live = (organizationId: string) =>
      owner.session.count({
        where: {
          userId: target,
          activeOrganizationId: organizationId,
          revokedAt: null,
        },
      })
    expect(await live(orgA.organizationId)).toBe(0)
    expect(await live(orgB.organizationId)).toBe(1)

    // THE AUDIT ROW: the extension's own, attributed to the acting owner.
    const membership = await owner.membership.findFirst({
      where: { userId: target, organizationId: orgA.organizationId },
      select: { id: true },
    })
    const rows = await owner.auditLog.findMany({
      where: {
        organizationId: orgA.organizationId,
        entityType: 'Membership',
        entityId: membership!.id,
      },
      select: { userId: true, action: true, changes: true },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.action).toBe('UPDATE')
    expect(rows[0]!.userId).toBe(orgA.userId)
    expect((rows[0]!.changes as Record<string, unknown>).role).toEqual({
      from: 'ADMIN',
      to: 'MANAGER',
    })
  })

  it('refuses yourself; the same change to somebody else goes through', async () => {
    const other = await person(orgA.organizationId, 'selfpair', 'MANAGER')
    expect(await changeInA(ownerA(), orgA.userId, 'ADMIN')).toEqual({
      ok: false,
      reason: 'cannot_change_self',
    })
    expect((await changeInA(ownerA(), other, 'ADMIN')).ok).toBe(true)
  })

  it('refuses a member of another organization by not finding them; one of its own is found', async () => {
    const theirs = await person(orgB.organizationId, 'theirs', 'MANAGER')
    const ours = await person(orgA.organizationId, 'ours', 'MANAGER')
    expect(await changeInA(ownerA(), theirs, 'ADMIN')).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(await roleIn(orgB.organizationId, theirs)).toBe('MANAGER')
    expect((await changeInA(ownerA(), ours, 'ADMIN')).ok).toBe(true)
  })

  it('refuses the role it already has; a different one goes through', async () => {
    const same = await person(orgA.organizationId, 'same', 'MANAGER')
    expect(await changeInA(ownerA(), same, 'MANAGER')).toEqual({
      ok: false,
      reason: 'unchanged',
    })
    expect((await changeInA(ownerA(), same, 'ADMIN')).ok).toBe(true)
  })

  it('an ADMIN may not touch an OWNER or grant OWNER; an OWNER may do both', async () => {
    const admin = await person(orgA.organizationId, 'actoradmin', 'ADMIN')
    const second = await person(orgA.organizationId, 'secondowner', 'OWNER')
    const plain = await person(orgA.organizationId, 'plainmanager', 'MANAGER')
    const asAdmin = { userId: admin, role: 'ADMIN' as const }
    expect(await changeInA(asAdmin, second, 'MANAGER')).toEqual({
      ok: false,
      reason: 'owner_needs_owner',
    })
    expect(await changeInA(asAdmin, plain, 'OWNER')).toEqual({
      ok: false,
      reason: 'role_not_grantable',
    })
    expect((await changeInA(ownerA(), plain, 'OWNER')).ok).toBe(true)
    expect((await changeInA(ownerA(), second, 'MANAGER')).ok).toBe(true)
  })

  it('refuses DRIVER in either direction; the same member to ADMIN goes through', async () => {
    const driver = await person(orgA.organizationId, 'driverrole', 'DRIVER')
    const manager = await person(orgA.organizationId, 'notdriver', 'MANAGER')
    expect(await changeInA(ownerA(), driver, 'MANAGER')).toEqual({
      ok: false,
      reason: 'driver_via_link',
    })
    expect(await changeInA(ownerA(), manager, 'DRIVER')).toEqual({
      ok: false,
      reason: 'driver_via_link',
    })
    expect((await changeInA(ownerA(), manager, 'ADMIN')).ok).toBe(true)
  })

  it('refuses to move the last OWNER; with a second owner, the same move goes through', async () => {
    // A FRESH organization whose only OWNER is the target, changed by an
    // OWNER-role actor from outside it — the one shape in which the count,
    // not an earlier rule, is what refuses.
    const solo = await seedOrganization(owner, `rolesSolo`, nonce)
    try {
      const actor = { userId: orgA.userId, role: 'OWNER' as const }
      const change = () =>
        inOrgAs(solo, solo.userId, (tx) =>
          changeUserRole(tx, solo.organizationId, actor, solo.userId, 'ADMIN'),
        )
      expect(
        await owner.membership.count({
          where: { organizationId: solo.organizationId, role: 'OWNER' },
        }),
      ).toBe(1)
      expect(await change()).toEqual({ ok: false, reason: 'last_owner' })
      await person(solo.organizationId, 'soloowner2', 'OWNER')
      expect((await change()).ok).toBe(true)
    } finally {
      await dropOrganization(owner, solo)
    }
  })

  it('two owners demoting each other at once leave exactly one owner', async () => {
    const race = await seedOrganization(owner, `rolesRace`, nonce)
    try {
      const other = await person(race.organizationId, 'raceowner', 'OWNER')
      const demote = (actorId: string, target: string) =>
        inOrgAs(race, actorId, (tx) =>
          changeUserRole(
            tx,
            race.organizationId,
            { userId: actorId, role: 'OWNER' },
            target,
            'ADMIN',
          ),
        )
      const outcomes = await Promise.all([
        demote(race.userId, other),
        demote(other, race.userId),
      ])
      expect(outcomes.filter((o) => o.ok)).toHaveLength(1)
      expect(outcomes.find((o) => !o.ok)).toEqual({
        ok: false,
        reason: 'last_owner',
      })
      expect(
        await owner.membership.count({
          where: { organizationId: race.organizationId, role: 'OWNER' },
        }),
      ).toBe(1)
    } finally {
      await dropOrganization(owner, race)
    }
  })
})
