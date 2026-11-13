import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { can } from '@/lib/permissions'
import { roleChoicesFor } from '@/lib/users'
import type { Role } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// §6.11 — who may change a role, what the screen offers, and the action's
// shape. The rules themselves are integration-tested against a real database
// (tests/integration/user-roles.test.ts).
// ---------------------------------------------------------------------------

const session = (role: Role) => ({
  userId: 'cuser0000000000000000000a',
  organizationId: 'corg00000000000000000000a',
  role,
  companyScopes: [],
})

describe('user:update is OWNER and ADMIN, and nobody else', () => {
  it('holds for the two, and is refused for every other role', () => {
    expect(can(session('OWNER'), 'update', 'user')).toBe(true)
    expect(can(session('ADMIN'), 'update', 'user')).toBe(true)
    for (const role of [
      'MANAGER',
      'DISPATCHER',
      'ACCOUNTING',
      'DRIVER',
    ] as const)
      expect(can(session(role), 'update', 'user'), role).toBe(false)
  })
})

describe('what the screen offers a row', () => {
  const owner = { userId: 'me', role: 'OWNER' as const }
  const admin = { userId: 'me', role: 'ADMIN' as const }

  it('nothing on your own row, a driver row, or an owner row for an admin', () => {
    expect(roleChoicesFor(owner, { id: 'me', role: 'OWNER' })).toBeNull()
    expect(roleChoicesFor(owner, { id: 'x', role: 'DRIVER' })).toBeNull()
    expect(roleChoicesFor(admin, { id: 'x', role: 'OWNER' })).toBeNull()
  })

  it('an owner is offered OWNER, an admin is not, and nobody is offered DRIVER', () => {
    const byOwner = roleChoicesFor(owner, { id: 'x', role: 'MANAGER' })!
    const byAdmin = roleChoicesFor(admin, { id: 'x', role: 'MANAGER' })!
    expect(byOwner).toContain('OWNER')
    expect(byAdmin).not.toContain('OWNER')
    expect(byOwner).not.toContain('DRIVER')
    expect(byAdmin).not.toContain('DRIVER')
    expect(byAdmin).toEqual(['ADMIN', 'MANAGER', 'DISPATCHER', 'ACCOUNTING'])
  })
})

describe('the action reads the form, calls one function, and returns', () => {
  const actions = readFileSync('src/app/(app)/users/actions.ts', 'utf8')
  const body = actions.slice(
    actions.indexOf('export async function changeUserRoleAction'),
    actions.indexOf('export async function setUserActiveAction'),
  )
  it('asks user:update and calls changeUserRole with the session as the actor', () => {
    expect(body).toContain("withCurrentOrg('update', 'user', (tx, session) =>")
    expect(body).toContain('{ userId: session.userId, role: session.role }')
    expect(body.match(/changeUserRole\(/g)?.length).toBe(1)
    // No rule inline: nothing here compares roles.
    expect(body).not.toMatch(/'OWNER'|'ADMIN'|'DRIVER'/)
  })

  it('the page draws the control from roleChoicesFor, behind user:update', () => {
    const page = readFileSync('src/app/(app)/users/page.tsx', 'utf8')
    expect(page).toMatch(
      /const choices = mayUpdate\s*\?\s*roleChoicesFor\(actor,/,
    )
    expect(page).toContain('changeUserRoleAction.bind(null, row.id)')
  })
})
