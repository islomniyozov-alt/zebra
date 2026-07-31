import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { FIXTURE_PASSWORD, FIXTURE_PASSWORD_HASH } from '../fixtures/password'
import { retryingClient } from '../retrying-client'
import { hashSessionToken, resolveSession } from '@/lib/session'
import { login, RATE_LIMIT } from '@/lib/auth'
import {
  MIN_PASSWORD_LENGTH,
  purgeUsedResetTokens,
  requestPasswordReset,
  resetPassword,
} from '@/lib/password-reset'
import type { PrismaClient } from '@/generated/prisma/client'

// §11.6. The four properties that make a reset link safe, and one that makes
// it honest: it never says whether the account exists.

let app: PrismaClient
let owner: PrismaClient

const PASSWORD = FIXTURE_PASSWORD
const NEW_PASSWORD = 'a-brand-new-passphrase-2'
let email = ''
let userId = ''
let organizationId = ''

beforeAll(async () => {
  app = retryingClient(process.env.DATABASE_URL!)
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const nonce = Math.random().toString(36).slice(2, 10)
  email = `reset-${nonce}@example.test`

  const organization = await owner.organization.create({
    data: { name: `Reset ${nonce}`, slug: `reset-${nonce}` },
  })
  organizationId = organization.id

  const user = await owner.user.create({
    data: {
      email,
      name: 'Forgetful',
      passwordHash: FIXTURE_PASSWORD_HASH,
    },
  })
  userId = user.id

  await owner.membership.create({
    data: { userId, organizationId, role: 'DISPATCHER', isDefault: true },
  })
})

afterEach(async () => {
  await owner.passwordResetToken.deleteMany({ where: { userId } })
  await owner.loginAttempt.deleteMany({ where: { email } })
  await owner.session.deleteMany({ where: { userId } })
  await owner.user.update({
    where: { id: userId },
    data: { passwordHash: FIXTURE_PASSWORD_HASH },
  })
})

afterAll(async () => {
  await owner.passwordResetToken.deleteMany({ where: { userId } })
  await owner.loginAttempt.deleteMany({ where: { email } })
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await app.$disconnect()
  await owner.$disconnect()
})

describe('requesting a reset', () => {
  it('issues a token and stores only its digest', async () => {
    const outcome = await requestPasswordReset(app, email)
    expect(outcome.token).toBeTruthy()
    expect(outcome.rateLimited).toBe(false)

    const stored = await owner.passwordResetToken.findMany({
      where: { userId },
    })
    expect(stored).toHaveLength(1)
    expect(stored[0]!.tokenHash).toBe(await hashSessionToken(outcome.token!))
    // A dump of this table opens nothing.
    expect(stored[0]!.tokenHash).not.toBe(outcome.token)
    expect(stored[0]!.usedAt).toBeNull()
  })

  it('says nothing about whether the account exists', async () => {
    // The shape of the answer is identical. Otherwise this becomes the
    // account-enumeration oracle that login carefully is not.
    const unknown = await requestPasswordReset(
      app,
      `nobody-${Date.now()}@example.test`,
    )
    expect(unknown).toEqual({ token: null, rateLimited: false })
    await owner.loginAttempt.deleteMany({
      where: { email: { startsWith: 'nobody-' } },
    })
  })

  it('issues nothing for a deactivated account', async () => {
    await owner.user.update({
      where: { id: userId },
      data: { isActive: false },
    })
    try {
      expect((await requestPasswordReset(app, email)).token).toBeNull()
    } finally {
      await owner.user.update({
        where: { id: userId },
        data: { isActive: true },
      })
    }
  })

  it('is rate limited on the same ledger as login', async () => {
    // "Request a reset" is unauthenticated, writes to the database and sends
    // mail. All three are worth spending on someone else's behalf.
    for (let attempt = 0; attempt < RATE_LIMIT.perEmail; attempt++) {
      await requestPasswordReset(app, email)
    }
    expect((await requestPasswordReset(app, email)).rateLimited).toBe(true)
  })

  it('is case-insensitive about the address', async () => {
    expect(
      (await requestPasswordReset(app, email.toUpperCase())).token,
    ).toBeTruthy()
  })
})

describe('redeeming a reset', () => {
  it('sets the new password and refuses the old one', async () => {
    const { token } = await requestPasswordReset(app, email)
    expect(await resetPassword(app, token!, NEW_PASSWORD)).toEqual({ ok: true })

    await owner.loginAttempt.deleteMany({ where: { email } })
    expect(await login(app, { email, password: NEW_PASSWORD })).toMatchObject({
      ok: true,
    })

    await owner.loginAttempt.deleteMany({ where: { email } })
    expect(await login(app, { email, password: PASSWORD })).toMatchObject({
      reason: 'invalid_credentials',
    })
  })

  it('is single use', async () => {
    // Recorded as used rather than deleted, so a replay is refused by a check
    // instead of by the row happening to be gone.
    const { token } = await requestPasswordReset(app, email)
    expect(await resetPassword(app, token!, NEW_PASSWORD)).toEqual({ ok: true })
    expect(
      await resetPassword(app, token!, 'another-passphrase-entirely'),
    ).toEqual({
      ok: false,
      reason: 'already_used',
    })

    const row = await owner.passwordResetToken.findFirstOrThrow({
      where: { userId },
    })
    expect(row.usedAt).toBeInstanceOf(Date)
  })

  it('refuses an expired link', async () => {
    const { token } = await requestPasswordReset(app, email)
    await owner.passwordResetToken.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect(await resetPassword(app, token!, NEW_PASSWORD)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('refuses a token nobody issued', async () => {
    expect(await resetPassword(app, 'not-a-real-token', NEW_PASSWORD)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('refuses a password too short to be worth hashing', async () => {
    const { token } = await requestPasswordReset(app, email)
    expect(
      await resetPassword(app, token!, 'a'.repeat(MIN_PASSWORD_LENGTH - 1)),
    ).toEqual({
      ok: false,
      reason: 'too_short',
    })
    // And the link survives, so a typo does not cost the user the email.
    expect(await resetPassword(app, token!, NEW_PASSWORD)).toEqual({ ok: true })
  })

  it('ends every existing session', async () => {
    // If the password is being reset because it leaked, leaving the attacker's
    // session alive makes the reset decorative.
    const session = await login(app, { email, password: PASSWORD })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    await owner.loginAttempt.deleteMany({ where: { email } })
    const { token } = await requestPasswordReset(app, email)
    await resetPassword(app, token!, NEW_PASSWORD)

    expect(await resolveSession(app, session.token)).toBeNull()
  })

  it('invalidates every other outstanding link', async () => {
    // Two "forgot password" emails from last week must not both still work.
    const first = await requestPasswordReset(app, email)
    const second = await requestPasswordReset(app, email)

    expect(await resetPassword(app, second.token!, NEW_PASSWORD)).toEqual({
      ok: true,
    })
    expect(
      await resetPassword(app, first.token!, 'yet-another-passphrase'),
    ).toEqual({
      ok: false,
      reason: 'already_used',
    })
  })
})

describe('housekeeping', () => {
  it('purges spent and expired tokens', async () => {
    const { token } = await requestPasswordReset(app, email)
    await resetPassword(app, token!, NEW_PASSWORD)
    await owner.passwordResetToken.updateMany({
      where: { userId },
      data: { usedAt: new Date('2020-01-01') },
    })

    expect(await purgeUsedResetTokens(app)).toBeGreaterThanOrEqual(1)
    expect(await owner.passwordResetToken.count({ where: { userId } })).toBe(0)
  })
})
