import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createUser, listUsers, setUserActive } from '@/lib/users'
import { dropOrganization, seedOrganization, type OrgFixture } from './fixtures'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// USER PROVISIONING, AGAINST THE TENANT WALL.
//
// `User` carries no organizationId, so it is one of the few tables row-level
// security does NOT protect — it cannot, because one person may hold
// memberships in several organizations. Every claim in src/lib/users.ts about
// staying inside the current tenant is therefore an application-layer claim,
// and application-layer claims are the ones that rot quietly.
//
// So this suite runs TWO organizations through the zebra_app role and asks the
// questions that would matter: can org A see org B's people, and can org A
// deactivate one of them.
//
// STANDING RULE 11 throughout: every refusal is paired with the same call
// succeeding once the single reason for it is removed.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let app: PrismaClient
let orgA: OrgFixture
let orgB: OrgFixture

const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(
  fixture: OrgFixture,
  fn: Parameters<typeof withOrg<T>>[1],
): Promise<T> =>
  withOrg(fixture.organizationId, fn, {
    attribution: {
      userId: fixture.userId,
      ip: null,
      userAgent: 'users.test',
    },
    maxWaitMs: 15_000,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  app = retryingClient(process.env.DATABASE_URL!)
  orgA = await seedOrganization(owner, `usersA`, nonce)
  orgB = await seedOrganization(owner, `usersB`, nonce)
}, 180_000)

afterAll(async () => {
  await owner.user.deleteMany({
    where: { email: { contains: `+u${nonce}@` } },
  })
  await dropOrganization(owner, orgA)
  await dropOrganization(owner, orgB)
  await owner.$disconnect()
  await app.$disconnect()
})

const address = (label: string) => `${label}+u${nonce}@example.test`

describe('the list is built from Membership, not from User', () => {
  it('shows this organization’s people', async () => {
    const created = await inOrg(orgA, (tx) =>
      createUser(tx, orgA.organizationId, 'OWNER', {
        name: 'Alpha Dispatcher',
        email: address('alpha'),
        role: 'DISPATCHER',
        companyIds: [],
      }),
    )
    expect(created.ok).toBe(true)

    const rows = await inOrg(orgA, (tx) => listUsers(tx, orgA.organizationId))
    expect(rows.map((row) => row.email)).toContain(address('alpha'))
  })

  it('and does NOT show the other organization’s', async () => {
    await inOrg(orgB, (tx) =>
      createUser(tx, orgB.organizationId, 'OWNER', {
        name: 'Bravo Dispatcher',
        email: address('bravo'),
        role: 'DISPATCHER',
        companyIds: [],
      }),
    )

    const rows = await inOrg(orgA, (tx) => listUsers(tx, orgA.organizationId))
    const emails = rows.map((row) => row.email)

    // The pair: bravo IS visible from org B, so the absence above is about the
    // tenant and not about the row failing to exist.
    expect(emails).not.toContain(address('bravo'))
    const fromB = await inOrg(orgB, (tx) => listUsers(tx, orgB.organizationId))
    expect(fromB.map((row) => row.email)).toContain(address('bravo'))
  })
})

describe('creating', () => {
  it('refuses somebody who already works here, by name', async () => {
    const again = await inOrg(orgA, (tx) =>
      createUser(tx, orgA.organizationId, 'OWNER', {
        name: 'Alpha Again',
        email: address('alpha'),
        role: 'DISPATCHER',
        companyIds: [],
      }),
    )
    expect(again).toEqual({ ok: false, reason: 'already_a_member' })
  })

  it('refuses an address that belongs to another tenant WITHOUT saying so', async () => {
    const outcome = await inOrg(orgA, (tx) =>
      createUser(tx, orgA.organizationId, 'OWNER', {
        name: 'Bravo Poached',
        email: address('bravo'),
        role: 'DISPATCHER',
        companyIds: [],
      }),
    )

    // `email_unavailable`, never `already_a_member`: the difference between
    // "taken here" and "taken somewhere you cannot see" is the fact worth
    // hiding, and the two map to different sentences in i18n.
    expect(outcome).toEqual({ ok: false, reason: 'email_unavailable' })

    // The pair: an address nobody holds goes through on the identical call.
    const fresh = await inOrg(orgA, (tx) =>
      createUser(tx, orgA.organizationId, 'OWNER', {
        name: 'Alpha Second',
        email: address('alpha2'),
        role: 'DISPATCHER',
        companyIds: [],
      }),
    )
    expect(fresh.ok).toBe(true)
  })

  it('refuses a company scope from another organization', async () => {
    const outcome = await inOrg(orgA, (tx) =>
      createUser(tx, orgA.organizationId, 'OWNER', {
        name: 'Scoped Wrong',
        email: address('scopedwrong'),
        role: 'DISPATCHER',
        companyIds: [orgB.companyId],
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'company_not_in_org' })

    // The pair: org A's own company on the same call.
    const right = await inOrg(orgA, (tx) =>
      createUser(tx, orgA.organizationId, 'OWNER', {
        name: 'Scoped Right',
        email: address('scopedright'),
        role: 'DISPATCHER',
        companyIds: [orgA.companyId],
      }),
    )
    expect(right.ok).toBe(true)

    const rows = await inOrg(orgA, (tx) => listUsers(tx, orgA.organizationId))
    const scoped = rows.find((row) => row.email === address('scopedright'))
    expect(scoped?.companyNames).toHaveLength(1)
  })

  it('will not let an ADMIN mint an OWNER', async () => {
    const outcome = await inOrg(orgA, (tx) =>
      createUser(tx, orgA.organizationId, 'ADMIN', {
        name: 'Sneaky Owner',
        email: address('sneaky'),
        role: 'OWNER',
        companyIds: [],
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'role_not_grantable' })

    // The pair: the same ADMIN, the same address, a role they may grant.
    const allowed = await inOrg(orgA, (tx) =>
      createUser(tx, orgA.organizationId, 'ADMIN', {
        name: 'Sneaky Manager',
        email: address('sneaky'),
        role: 'MANAGER',
        companyIds: [],
      }),
    )
    expect(allowed.ok).toBe(true)
  })
})

describe('deactivating', () => {
  it('cannot reach a user in another organization', async () => {
    const bravo = await inOrg(orgB, (tx) =>
      listUsers(tx, orgB.organizationId),
    ).then((rows) => rows.find((row) => row.email === address('bravo'))!)

    const outcome = await inOrg(orgA, (tx) =>
      setUserActive(tx, orgA.organizationId, orgA.userId, bravo.id, false),
    )
    expect(outcome).toEqual({ ok: false, reason: 'not_found' })

    // And bravo is still active, asked from the organization that owns them.
    const after = await inOrg(orgB, (tx) => listUsers(tx, orgB.organizationId))
    expect(after.find((row) => row.id === bravo.id)?.isActive).toBe(true)
  })

  it('reaches one of its own, and revokes their sessions', async () => {
    const rows = await inOrg(orgA, (tx) => listUsers(tx, orgA.organizationId))
    const alpha = rows.find((row) => row.email === address('alpha'))!

    // A live session, so that "revoked" is a change and not a starting state.
    await owner.session.create({
      data: {
        userId: alpha.id,
        // NOT `organizationId` — see the comment on the column. It is the
        // INPUT to row-level security rather than something subject to it.
        activeOrganizationId: orgA.organizationId,
        role: 'DISPATCHER',
        tokenHash: `users-test-${nonce}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    expect(
      await owner.session.count({
        where: { userId: alpha.id, revokedAt: null },
      }),
    ).toBe(1)

    const outcome = await inOrg(orgA, (tx) =>
      setUserActive(tx, orgA.organizationId, orgA.userId, alpha.id, false),
    )
    expect(outcome).toEqual({ ok: true })

    // isActive alone would only stop the NEXT sign-in. Somebody removed at
    // nine in the morning must not keep working until their cookie expires.
    expect(
      await owner.session.count({
        where: { userId: alpha.id, revokedAt: null },
      }),
    ).toBe(0)

    const after = await inOrg(orgA, (tx) => listUsers(tx, orgA.organizationId))
    expect(after.find((row) => row.id === alpha.id)?.isActive).toBe(false)
  })

  it('refuses to lock the actor out of their own organization', async () => {
    const outcome = await inOrg(orgA, (tx) =>
      setUserActive(tx, orgA.organizationId, orgA.userId, orgA.userId, false),
    )
    expect(outcome).toEqual({ ok: false, reason: 'cannot_deactivate_self' })

    // The pair: the same actor may deactivate somebody else, so the refusal
    // above is about self and not about the actor lacking the power.
    const rows = await inOrg(orgA, (tx) => listUsers(tx, orgA.organizationId))
    const other = rows.find((row) => row.email === address('alpha2'))!
    expect(
      await inOrg(orgA, (tx) =>
        setUserActive(tx, orgA.organizationId, orgA.userId, other.id, false),
      ),
    ).toEqual({ ok: true })
  })

  it('reactivates', async () => {
    const rows = await inOrg(orgA, (tx) => listUsers(tx, orgA.organizationId))
    const alpha = rows.find((row) => row.email === address('alpha'))!

    expect(
      await inOrg(orgA, (tx) =>
        setUserActive(tx, orgA.organizationId, orgA.userId, alpha.id, true),
      ),
    ).toEqual({ ok: true })

    const after = await inOrg(orgA, (tx) => listUsers(tx, orgA.organizationId))
    expect(after.find((row) => row.id === alpha.id)?.isActive).toBe(true)
  })
})
