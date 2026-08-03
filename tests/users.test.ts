import { describe, expect, it } from 'vitest'
import { generateTemporaryPassword, grantableRoles } from '@/lib/users'
import { MIN_PASSWORD_LENGTH } from '@/lib/password-reset'
import type { Role } from '@/generated/prisma/client'

// The parts of user provisioning that are decidable without a database. The
// tenancy rules — every read from Membership, every write proving membership
// first — are asserted against real Postgres in tests/integration/users.test.ts,
// because they are claims about row-level security and nothing else can check
// them.

describe('the temporary password', () => {
  it('is long enough that its short life is not the only protection', () => {
    // 24 random bytes, base64url — 32 characters, comfortably over the
    // minimum a user is later allowed to choose.
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(
      MIN_PASSWORD_LENGTH,
    )
    expect(generateTemporaryPassword()).toHaveLength(32)
  })

  it('survives being pasted into a chat message', () => {
    // base64url only. `+`, `/` and `=` get mangled by URL encoding, by
    // autocorrect, and by at least one messenger's link detector — and the
    // whole delivery mechanism here is somebody pasting it to a colleague.
    for (let index = 0; index < 50; index++) {
      expect(generateTemporaryPassword()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('is different every time', () => {
    const seen = new Set(
      Array.from({ length: 200 }, () => generateTemporaryPassword()),
    )
    expect(seen.size).toBe(200)
  })
})

describe('which roles an actor may hand out', () => {
  it('lets an OWNER grant anything, including OWNER', () => {
    expect(grantableRoles('OWNER')).toContain('OWNER')
  })

  it.each<Role>(['ADMIN', 'MANAGER', 'DISPATCHER', 'ACCOUNTING', 'DRIVER'])(
    '%s cannot mint an OWNER',
    (role) => {
      expect(grantableRoles(role)).not.toContain('OWNER')
    },
  )

  it('still lets an ADMIN staff the company', () => {
    // The pair, per standing rule 11: the refusal above means something only
    // because the same call grants everything else.
    expect(grantableRoles('ADMIN')).toEqual([
      'ADMIN',
      'MANAGER',
      'DISPATCHER',
      'ACCOUNTING',
      'DRIVER',
    ])
  })

  it('offers no role that is not a real one', () => {
    const real: Role[] = [
      'OWNER',
      'ADMIN',
      'MANAGER',
      'DISPATCHER',
      'ACCOUNTING',
      'DRIVER',
    ]
    for (const actor of real) {
      for (const granted of grantableRoles(actor)) {
        expect(real).toContain(granted)
      }
    }
  })
})
