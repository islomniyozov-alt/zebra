import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { FIXTURE_PASSWORD, FIXTURE_PASSWORD_HASH } from '../fixtures/password'
import { retryingClient } from '../retrying-client'
import {
  RATE_LIMIT,
  changeOwnPassword,
  changePassword,
  clearLoginFailures,
  login,
  logout,
  normalizeEmail,
} from '@/lib/auth'
import {
  hashSessionToken,
  refreshSessionsForUser,
  resolveSession,
  revokeAllSessionsForUser,
} from '@/lib/session'
import { can } from '@/lib/permissions'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Auth runs entirely outside row-level security — User, Session and
// LoginAttempt are the three tables that must be readable before a tenant is
// known. So these tests use the app role, and prove that the app role is
// enough: if login needed the owner, the deployed Worker could not log anyone
// in.
// ---------------------------------------------------------------------------

let app: PrismaClient
let owner: PrismaClient

const PASSWORD = FIXTURE_PASSWORD
let nonce: string
let email: string
let organizationId: string
let companyId: string
let userId: string

beforeAll(async () => {
  app = retryingClient(process.env.DATABASE_URL!)
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  nonce = Math.random().toString(36).slice(2, 10)
  email = `auth-${nonce}@example.test`

  const organization = await owner.organization.create({
    data: {
      name: `Auth ${nonce}`,
      slug: `auth-${nonce}`,
      companies: { create: { name: 'Authority' } },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: {
      email,
      name: 'Test Owner',
      passwordHash: FIXTURE_PASSWORD_HASH,
    },
  })
  userId = user.id

  await owner.membership.create({
    data: { userId, organizationId, role: 'DISPATCHER', isDefault: true },
  })
})

afterEach(async () => {
  // Each test starts with a clean rate-limit ledger and no live sessions.
  await owner.loginAttempt.deleteMany({ where: { email } })
  await owner.session.deleteMany({ where: { userId } })
})

afterAll(async () => {
  await owner.loginAttempt.deleteMany({ where: { email } })
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await app.$disconnect()
  await owner.$disconnect()
})

describe('login', () => {
  it('issues a session carrying the resolved context', async () => {
    const result = await login(app, { email, password: PASSWORD })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.context.userId).toBe(userId)
    expect(result.context.organizationId).toBe(organizationId)
    expect(result.context.role).toBe('DISPATCHER')
    expect(result.context.companyScopes).toEqual([])
    expect(result.context.expiresAt.getTime()).toBeGreaterThan(Date.now())

    // The session is immediately usable as an authorization subject.
    expect(can(result.context, 'read', 'load')).toBe(true)
    expect(can(result.context, 'read', 'invoice')).toBe(false)
  })

  it('stores only the hash of the token', async () => {
    const result = await login(app, { email, password: PASSWORD })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const stored = await owner.session.findMany({
      where: { userId },
      select: { tokenHash: true },
    })

    expect(stored).toHaveLength(1)
    expect(stored[0]!.tokenHash).toBe(await hashSessionToken(result.token))
    // The secret itself appears nowhere in the row.
    expect(stored[0]!.tokenHash).not.toBe(result.token)
    expect(stored[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is case- and whitespace-insensitive about the email', async () => {
    const result = await login(app, {
      email: `  ${email.toUpperCase()} `,
      password: PASSWORD,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses the wrong password', async () => {
    const result = await login(app, { email, password: 'not-it' })
    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' })
  })

  it('answers a missing user exactly as it answers a wrong password', async () => {
    // Same shape, so the response is not a list of which addresses have
    // accounts.
    const missing = await login(app, {
      email: `nobody-${nonce}@example.test`,
      password: PASSWORD,
    })
    expect(missing).toEqual({ ok: false, reason: 'invalid_credentials' })
    await owner.loginAttempt.deleteMany({
      where: { email: `nobody-${nonce}@example.test` },
    })
  })

  it('refuses a deactivated user holding the right password', async () => {
    await owner.user.update({
      where: { id: userId },
      data: { isActive: false },
    })
    try {
      expect(await login(app, { email, password: PASSWORD })).toEqual({
        ok: false,
        reason: 'invalid_credentials',
      })
    } finally {
      await owner.user.update({
        where: { id: userId },
        data: { isActive: true },
      })
    }
  })

  it('refuses a user with a password but no membership', async () => {
    const strayEmail = `stray-${nonce}@example.test`
    const stray = await owner.user.create({
      data: {
        email: strayEmail,
        name: 'Stray',
        passwordHash: FIXTURE_PASSWORD_HASH,
      },
    })
    try {
      expect(
        await login(app, { email: strayEmail, password: PASSWORD }),
      ).toEqual({
        ok: false,
        reason: 'no_membership',
      })
    } finally {
      await owner.loginAttempt.deleteMany({ where: { email: strayEmail } })
      await owner.user.delete({ where: { id: stray.id } })
    }
  })

  it('records the attempt either way', async () => {
    await login(app, { email, password: 'wrong' })
    await login(app, { email, password: PASSWORD })

    const attempts = await owner.loginAttempt.findMany({
      where: { email },
      orderBy: { createdAt: 'asc' },
      select: { succeeded: true },
    })
    expect(attempts.map((a) => a.succeeded)).toEqual([false, true])
  })

  it('stamps lastLoginAt', async () => {
    const before = await owner.user.findUniqueOrThrow({
      where: { id: userId },
      select: { lastLoginAt: true },
    })
    await login(app, { email, password: PASSWORD })
    const after = await owner.user.findUniqueOrThrow({
      where: { id: userId },
      select: { lastLoginAt: true },
    })
    expect(after.lastLoginAt).not.toEqual(before.lastLoginAt)
    expect(after.lastLoginAt).toBeInstanceOf(Date)
  })
})

describe('rate limiting', () => {
  it('locks an email after the configured number of failures', async () => {
    for (let attempt = 0; attempt < RATE_LIMIT.perEmail; attempt++) {
      expect(await login(app, { email, password: 'wrong' })).toEqual({
        ok: false,
        reason: 'invalid_credentials',
      })
    }

    const locked = await login(app, { email, password: 'wrong' })
    expect(locked).toMatchObject({ ok: false, reason: 'rate_limited' })
  })

  it('refuses the right password once locked', async () => {
    // Otherwise the limit is decoration: an attacker who guesses correctly on
    // attempt six is in.
    for (let attempt = 0; attempt < RATE_LIMIT.perEmail; attempt++) {
      await login(app, { email, password: 'wrong' })
    }

    const locked = await login(app, { email, password: PASSWORD })
    expect(locked).toMatchObject({ ok: false, reason: 'rate_limited' })
    expect(await owner.session.count({ where: { userId } })).toBe(0)
  })

  it('counts attempts made while locked, so hammering extends the lockout', async () => {
    for (let attempt = 0; attempt < RATE_LIMIT.perEmail + 3; attempt++) {
      await login(app, { email, password: 'wrong' })
    }
    expect(
      await owner.loginAttempt.count({ where: { email, succeeded: false } }),
    ).toBe(RATE_LIMIT.perEmail + 3)
  })

  it('only counts failures inside the window', async () => {
    // Age the failures past the window rather than waiting fifteen minutes.
    for (let attempt = 0; attempt < RATE_LIMIT.perEmail; attempt++) {
      await login(app, { email, password: 'wrong' })
    }
    await owner.loginAttempt.updateMany({
      where: { email },
      data: { createdAt: new Date(Date.now() - RATE_LIMIT.windowMs - 60_000) },
    })

    expect(await login(app, { email, password: PASSWORD })).toMatchObject({
      ok: true,
    })
  })

  it('does not let one locked email lock another', async () => {
    const otherEmail = `other-${nonce}@example.test`
    const other = await owner.user.create({
      data: {
        email: otherEmail,
        name: 'Other',
        passwordHash: FIXTURE_PASSWORD_HASH,
      },
    })
    await owner.membership.create({
      data: { userId: other.id, organizationId, role: 'DISPATCHER' },
    })

    try {
      for (let attempt = 0; attempt < RATE_LIMIT.perEmail + 1; attempt++) {
        await login(app, { email, password: 'wrong' })
      }
      // No shared IP recorded, so the other account is untouched.
      expect(
        await login(app, { email: otherEmail, password: PASSWORD }),
      ).toMatchObject({
        ok: true,
      })
    } finally {
      await owner.loginAttempt.deleteMany({ where: { email: otherEmail } })
      await owner.session.deleteMany({ where: { userId: other.id } })
      await owner.membership.deleteMany({ where: { userId: other.id } })
      await owner.user.delete({ where: { id: other.id } })
    }
  })

  it('locks an address that is spraying many different emails', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    try {
      for (let attempt = 0; attempt < RATE_LIMIT.perIp; attempt++) {
        await login(app, {
          email: `spray-${nonce}-${attempt}@example.test`,
          password: 'wrong',
          metadata: { ip },
        })
      }

      // A different, valid account from the same address is now refused.
      const blocked = await login(app, {
        email,
        password: PASSWORD,
        metadata: { ip },
      })
      expect(blocked).toMatchObject({ ok: false, reason: 'rate_limited' })

      // ...but the same account from elsewhere is fine.
      expect(
        await login(app, {
          email,
          password: PASSWORD,
          metadata: { ip: '203.0.113.9' },
        }),
      ).toMatchObject({ ok: true })
    } finally {
      await owner.loginAttempt.deleteMany({ where: { ip } })
      await owner.loginAttempt.deleteMany({
        where: { email: { startsWith: `spray-${nonce}` } },
      })
    }
  })

  it('can be cleared by an operator', async () => {
    for (let attempt = 0; attempt < RATE_LIMIT.perEmail; attempt++) {
      await login(app, { email, password: 'wrong' })
    }
    expect(await login(app, { email, password: PASSWORD })).toMatchObject({
      reason: 'rate_limited',
    })

    // perEmail failures, plus the locked-out attempt above — which is
    // recorded too, so that hammering extends the lockout.
    const cleared = await clearLoginFailures(app, email.toUpperCase())
    expect(cleared).toBe(RATE_LIMIT.perEmail + 1)
    expect(await login(app, { email, password: PASSWORD })).toMatchObject({
      ok: true,
    })
  })
})

describe('session rotation', () => {
  it('revokes the token the request arrived with', async () => {
    // Session fixation: a token planted before authentication must not still
    // be valid after it.
    const first = await login(app, { email, password: PASSWORD })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await login(app, {
      email,
      password: PASSWORD,
      currentToken: first.token,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.token).not.toBe(first.token)
    expect(await resolveSession(app, first.token)).toBeNull()
    expect(await resolveSession(app, second.token)).not.toBeNull()
  })

  it('leaves other devices alone', async () => {
    const phone = await login(app, { email, password: PASSWORD })
    const desktop = await login(app, { email, password: PASSWORD })
    expect(phone.ok && desktop.ok).toBe(true)
    if (!phone.ok || !desktop.ok) return

    // Logging in on the desktop must not sign the driver out of their phone.
    expect(await resolveSession(app, phone.token)).not.toBeNull()
  })

  it('issues a distinct token every time', async () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const result = await login(app, { email, password: PASSWORD })
      if (result.ok) tokens.add(result.token)
    }
    expect(tokens.size).toBe(5)
  })
})

describe('resolveSession', () => {
  it('returns null for nonsense', async () => {
    expect(await resolveSession(app, null)).toBeNull()
    expect(await resolveSession(app, '')).toBeNull()
    expect(await resolveSession(app, 'not-a-token')).toBeNull()
  })

  it('returns null once expired', async () => {
    const result = await login(app, { email, password: PASSWORD })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await owner.session.update({
      where: { id: result.context.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect(await resolveSession(app, result.token)).toBeNull()
  })

  it('returns null once the user is deactivated', async () => {
    const result = await login(app, { email, password: PASSWORD })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await owner.user.update({
      where: { id: userId },
      data: { isActive: false },
    })
    try {
      expect(await resolveSession(app, result.token)).toBeNull()
    } finally {
      await owner.user.update({
        where: { id: userId },
        data: { isActive: true },
      })
    }
  })
})

describe('logout and revocation', () => {
  it('ends the session immediately', async () => {
    const result = await login(app, { email, password: PASSWORD })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await logout(app, result.token)
    expect(await resolveSession(app, result.token)).toBeNull()

    // The row survives, so "when did this end, and how" stays answerable.
    const row = await owner.session.findUniqueOrThrow({
      where: { id: result.context.sessionId },
      select: { revokedAt: true },
    })
    expect(row.revokedAt).toBeInstanceOf(Date)
  })

  it('is idempotent and harmless on an unknown token', async () => {
    await expect(logout(app, 'never-existed')).resolves.toBeUndefined()
    await expect(logout(app, null)).resolves.toBeUndefined()
  })

  it('revokes every session a user holds', async () => {
    const a = await login(app, { email, password: PASSWORD })
    const b = await login(app, { email, password: PASSWORD })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return

    expect(await revokeAllSessionsForUser(app, userId)).toBe(2)
    expect(await resolveSession(app, a.token)).toBeNull()
    expect(await resolveSession(app, b.token)).toBeNull()
  })

  it('can spare the session doing the revoking', async () => {
    const keep = await login(app, { email, password: PASSWORD })
    const other = await login(app, { email, password: PASSWORD })
    expect(keep.ok && other.ok).toBe(true)
    if (!keep.ok || !other.ok) return

    await revokeAllSessionsForUser(app, userId, {
      exceptSessionId: keep.context.sessionId,
    })
    expect(await resolveSession(app, keep.token)).not.toBeNull()
    expect(await resolveSession(app, other.token)).toBeNull()
  })

  it('ends every other session when the password changes', async () => {
    // If the password is being changed because it leaked, leaving the
    // attacker's session alive makes the change decorative.
    const attacker = await login(app, { email, password: PASSWORD })
    const me = await login(app, { email, password: PASSWORD })
    expect(attacker.ok && me.ok).toBe(true)
    if (!attacker.ok || !me.ok) return

    const NEW = 'a-different-passphrase-7761'
    try {
      await changePassword(app, userId, NEW, {
        keepSessionId: me.context.sessionId,
      })

      expect(await resolveSession(app, attacker.token)).toBeNull()
      expect(await resolveSession(app, me.token)).not.toBeNull()

      await owner.loginAttempt.deleteMany({ where: { email } })
      expect(await login(app, { email, password: NEW })).toMatchObject({
        ok: true,
      })
      await owner.loginAttempt.deleteMany({ where: { email } })
      expect(await login(app, { email, password: PASSWORD })).toMatchObject({
        reason: 'invalid_credentials',
      })
    } finally {
      await owner.user.update({
        where: { id: userId },
        data: { passwordHash: FIXTURE_PASSWORD_HASH },
      })
    }
  })
})

describe('refreshSessionsForUser', () => {
  it('pushes a role change onto live sessions', async () => {
    const result = await login(app, { email, password: PASSWORD })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.context.role).toBe('DISPATCHER')

    await owner.membership.updateMany({
      where: { userId, organizationId },
      data: { role: 'ACCOUNTING' },
    })
    const outcome = await refreshSessionsForUser(app, userId, organizationId)
    expect(outcome).toEqual({ refreshed: 1, revoked: 0 })

    const refreshed = await resolveSession(app, result.token)
    expect(refreshed?.role).toBe('ACCOUNTING')
    expect(can(refreshed, 'create', 'invoice')).toBe(true)

    await owner.membership.updateMany({
      where: { userId, organizationId },
      data: { role: 'DISPATCHER' },
    })
  })

  it('pushes a company scope change', async () => {
    const result = await login(app, { email, password: PASSWORD })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.context.companyScopes).toEqual([])

    const membership = await owner.membership.findFirstOrThrow({
      where: { userId, organizationId },
    })
    await owner.membershipCompany.create({
      data: { membershipId: membership.id, companyId, organizationId },
    })
    try {
      await refreshSessionsForUser(app, userId, organizationId)
      expect((await resolveSession(app, result.token))?.companyScopes).toEqual([
        companyId,
      ])
    } finally {
      await owner.membershipCompany.deleteMany({
        where: { membershipId: membership.id },
      })
    }
  })

  it('revokes sessions when the membership is gone', async () => {
    // A removed member should not keep working until their session happens to
    // expire.
    const result = await login(app, { email, password: PASSWORD })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const membership = await owner.membership.findFirstOrThrow({
      where: { userId, organizationId },
    })
    await owner.membership.delete({ where: { id: membership.id } })
    try {
      expect(await refreshSessionsForUser(app, userId, organizationId)).toEqual(
        {
          refreshed: 0,
          revoked: 1,
        },
      )
      expect(await resolveSession(app, result.token)).toBeNull()
    } finally {
      await owner.membership.create({
        data: { userId, organizationId, role: 'DISPATCHER', isDefault: true },
      })
    }
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Owner@Example.TEST ')).toBe('owner@example.test')
  })
})

describe('changeOwnPassword', () => {
  // Phase 2 §6 — the owner changes their own password through the interface
  // rather than through a seed variable. The refusals are exercised against
  // the deployed worker in the step report; these cover the path that must
  // NOT be driven live, because doing so would put a real credential in a
  // transcript, which is the whole reason this exists.
  const NEXT = 'a-different-passphrase-7731'

  afterEach(async () => {
    await owner.user.update({
      where: { id: userId },
      data: { passwordHash: FIXTURE_PASSWORD_HASH },
    })
    await owner.loginAttempt.deleteMany({ where: { email } })
    await owner.session.deleteMany({ where: { userId } })
  })

  it('changes the password when the current one is right', async () => {
    expect(
      await changeOwnPassword(app, userId, PASSWORD, NEXT, { minLength: 12 }),
    ).toEqual({ ok: true })

    expect(await login(app, { email, password: NEXT })).toMatchObject({
      ok: true,
    })
    await owner.loginAttempt.deleteMany({ where: { email } })
    expect(await login(app, { email, password: PASSWORD })).toMatchObject({
      reason: 'invalid_credentials',
    })
  })

  it('stores the new password as argon2id', async () => {
    await changeOwnPassword(app, userId, PASSWORD, NEXT, { minLength: 12 })
    const user = await owner.user.findUniqueOrThrow({ where: { id: userId } })
    expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/)
  })

  it('refuses a wrong current password and leaves the old one working', async () => {
    expect(
      await changeOwnPassword(app, userId, 'not-it', NEXT, { minLength: 12 }),
    ).toEqual({ ok: false, reason: 'invalid_current' })

    expect(await login(app, { email, password: PASSWORD })).toMatchObject({
      ok: true,
    })
  })

  it('refuses a new password that is too short', async () => {
    expect(
      await changeOwnPassword(app, userId, PASSWORD, 'short', {
        minLength: 12,
      }),
    ).toEqual({ ok: false, reason: 'too_short' })
  })

  it('refuses a no-op change', async () => {
    // Reporting success for having done nothing is worse than refusing: the
    // reason to change a password is that the old one is suspect.
    expect(
      await changeOwnPassword(app, userId, PASSWORD, PASSWORD, {
        minLength: 12,
      }),
    ).toEqual({ ok: false, reason: 'unchanged' })
  })

  it('ends every other session and keeps the one that asked', async () => {
    // If the password is being changed because it leaked, leaving the
    // attacker's session alive makes the change decorative. Throwing out the
    // person who just proved they own the account is its own bug.
    const staying = await login(app, { email, password: PASSWORD })
    await owner.loginAttempt.deleteMany({ where: { email } })
    const leaving = await login(app, { email, password: PASSWORD })
    expect(staying.ok && leaving.ok).toBe(true)
    if (!staying.ok || !leaving.ok) return

    await changeOwnPassword(app, userId, PASSWORD, NEXT, {
      minLength: 12,
      keepSessionId: staying.context.sessionId,
    })

    expect(await resolveSession(app, staying.token)).not.toBeNull()
    expect(await resolveSession(app, leaving.token)).toBeNull()
  })

  it('refuses for a deactivated account', async () => {
    await owner.user.update({
      where: { id: userId },
      data: { isActive: false },
    })
    try {
      expect(
        await changeOwnPassword(app, userId, PASSWORD, NEXT, { minLength: 12 }),
      ).toEqual({ ok: false, reason: 'invalid_current' })
    } finally {
      await owner.user.update({
        where: { id: userId },
        data: { isActive: true },
      })
    }
  })
})
