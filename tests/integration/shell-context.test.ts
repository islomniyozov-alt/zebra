import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { createPrismaClient, statementsOf } from '@/lib/db'
import {
  createSession,
  resolveSession,
  revokeSession,
  type IssuedSession,
} from '@/lib/session'
import {
  readDensity,
  writePreference,
  PREFERENCE_KEYS,
} from '@/lib/preferences'
import { resolveShellContext } from '@/lib/shell-context'
import { dropOrganization, seedOrganization, type OrgFixture } from './fixtures'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE SHELL'S ONE READ AGREES WITH THE THREE IT REPLACES (GAPS 42 item 3;
// migration 71). Two organizations, one session each, each with its own
// density: the function's row equals the session read, the account read and
// the density read taken separately — and both sides are above zero, so the
// test cannot pass on a preference the policy hid (the "sees no rows"
// vacuity AGENTS.md names, which is exactly what a SECURITY DEFINER function
// that forgot its predicate would produce the other way round).
// ---------------------------------------------------------------------------

let owner: PrismaClient
let orgA: OrgFixture
let orgB: OrgFixture
let sessionA: IssuedSession
let sessionB: IssuedSession
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(org: OrgFixture, fn: Parameters<typeof withOrg<T>>[1]) =>
  withOrg(org.organizationId, fn, {
    attribution: { userId: org.userId, ip: null, userAgent: 'shell.test' },
    maxWaitMs: 15_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  orgA = await seedOrganization(owner, 'shellA', nonce)
  orgB = await seedOrganization(owner, 'shellB', nonce)
  sessionA = await createSession(owner, orgA.userId, {
    organizationId: orgA.organizationId,
    role: 'OWNER',
    companyScopes: [orgA.companyId],
  })
  sessionB = await createSession(owner, orgB.userId, {
    organizationId: orgB.organizationId,
    role: 'OWNER',
    companyScopes: [],
    permissionOverrides: { grant: ['load:read'], revoke: [] },
  })
  await inOrg(orgA, (tx) =>
    writePreference(
      tx,
      orgA.organizationId,
      orgA.userId,
      PREFERENCE_KEYS.density,
      'compact',
    ),
  )
  await inOrg(orgB, (tx) =>
    writePreference(
      tx,
      orgB.organizationId,
      orgB.userId,
      PREFERENCE_KEYS.density,
      'comfortable',
    ),
  )
}, 240_000)

afterAll(async () => {
  await dropOrganization(owner, orgA)
  await dropOrganization(owner, orgB)
  await owner.$disconnect()
})

describe('the one read agrees with the three, for each organization', () => {
  for (const [label, pick] of [
    ['A', () => [orgA, sessionA, 'compact'] as const],
    ['B', () => [orgB, sessionB, 'comfortable'] as const],
  ] as const) {
    it(`organization ${label}: session, account and density all equal, and above zero`, async () => {
      const [org, issued, density] = pick()
      const one = await resolveShellContext(owner, issued.token)
      const session = await resolveSession(owner, issued.token)
      const account = await owner.user.findUnique({
        where: { id: org.userId },
        select: { name: true, email: true },
      })
      const separately = await inOrg(org, (tx) => readDensity(tx, org.userId))
      expect(one).not.toBeNull()
      expect(session).not.toBeNull()
      expect(one!.session).toEqual(session)
      expect(one!.account).toEqual(account)
      expect(one!.density).toBe(density)
      expect(separately).toBe(density)
      expect(one!.account.email.length).toBeGreaterThan(0)
    })
  }

  it('the overrides come through the function as they came through the row', async () => {
    const one = await resolveShellContext(owner, sessionB.token)
    expect(one!.session.permissionOverrides).toEqual({
      grant: ['load:read'],
      revoke: [],
    })
  })

  it('is ONE statement on the request’s own client', async () => {
    const client = createPrismaClient(process.env.DIRECT_DATABASE_URL!)
    try {
      await client.$queryRaw`select 1`
      const before = statementsOf(client)!
      const one = await resolveShellContext(client, sessionA.token)
      expect(one?.session.userId).toBe(orgA.userId)
      expect(statementsOf(client)! - before).toBe(1)
    } finally {
      await client.$disconnect()
    }
  })

  it('no preference is the default; a bad token, a revoked session are nobody', async () => {
    const fresh = await createSession(owner, orgA.userId, {
      organizationId: orgA.organizationId,
      role: 'OWNER',
      companyScopes: [],
    })
    // Org A's user has a density in org A; a session on org B's id for the
    // same user would read nothing there — the predicate is the session's
    // own organization, not the user's any organization.
    const elsewhere = await createSession(owner, orgA.userId, {
      organizationId: orgB.organizationId,
      role: 'OWNER',
      companyScopes: [],
    })
    expect((await resolveShellContext(owner, elsewhere.token))?.density).toBe(
      'standard',
    )
    expect((await resolveShellContext(owner, fresh.token))?.density).toBe(
      'compact',
    )
    expect(await resolveShellContext(owner, 'not-a-token')).toBeNull()
    expect(await resolveShellContext(owner, null)).toBeNull()
    await revokeSession(owner, fresh.token)
    expect(await resolveShellContext(owner, fresh.token)).toBeNull()
    expect(await resolveSession(owner, fresh.token)).toBeNull()
  })
})
