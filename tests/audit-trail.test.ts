import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AUDIT_TRAIL_LIMIT, fieldsOf } from '@/lib/audit-trail'
import { can, type AuthorizedSession } from '@/lib/permissions'
import type { Role } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// WHO MAY SEE THE AUDIT TRAIL, AND WHAT A ROW SUMMARISES TO.
//
// The tenant boundary is proved against real Postgres in
// `tests/integration/audit-trail.test.ts` — two organizations, read as one.
// What is here is everything that does not need a database: the permission
// matrix, the change summary, and that the page cannot be reached by a role
// without the grant.
// ---------------------------------------------------------------------------

const session = (role: Role): AuthorizedSession => ({
  userId: 'usr_1',
  organizationId: 'org_1',
  role,
  companyScopes: [],
})

describe('only the roles with auditLog:read may read it', () => {
  it.each(['OWNER', 'ADMIN'] as const)('%s may', (role) => {
    expect(can(session(role), 'read', 'auditLog')).toBe(true)
  })

  it.each(['MANAGER', 'DISPATCHER', 'ACCOUNTING', 'DRIVER'] as const)(
    '%s may not',
    (role) => {
      expect(can(session(role), 'read', 'auditLog')).toBe(false)
    },
  )

  it('and MANAGER losing it is the deliberate narrowing, not an oversight', () => {
    // THE GRANT EXISTED AND NOTHING READ IT — no audit screen, so it granted
    // access to a resource with no surface. Giving it one made the question
    // real. This asserts the removal is recorded where it happened, so the next
    // reader finds the reason rather than restoring it on a guess.
    const source = readFileSync('src/lib/permissions.ts', 'utf8')
    expect(source).toContain('REMOVED FROM MANAGER')
    // AND IT IS ACTUALLY GONE, not just explained.
    const manager = source.slice(
      source.indexOf('MANAGER: new Set<Permission>(['),
      source.indexOf('DISPATCHER: new Set<Permission>(['),
    )
    expect(manager).not.toMatch(/^\s*'auditLog:read',/m)
  })
})

describe('the page is gated and bounded', () => {
  const page = () => readFileSync('src/app/(app)/audit/page.tsx', 'utf8')

  it('refuses a role without the grant before it reads anything', () => {
    const source = page()
    // §4: a route a role may not use should not exist for that role either — so
    // `notFound()`, and BEFORE the transaction rather than after it.
    //
    // LINE-ANCHORED, because `indexOf` on the call finds it inside a COMMENT:
    // the break that comments the gate out was watched PASSING against that
    // version of this assertion, which would have left the page ungated with
    // this test green. Second time in two tasks.
    const gate = source.search(
      /^\s*if \(!\(await currentUserCan\('read', 'auditLog'\)\)\) notFound\(\)/m,
    )
    const read = source.indexOf('withCurrentOrg(')
    expect(gate).toBeGreaterThan(-1)
    expect(read).toBeGreaterThan(gate)
  })

  it('asks through withCurrentOrg, so row-level security applies', () => {
    // THE TENANT FENCE IS RLS. A reader that took a plain client would bypass
    // `app.current_org_id` and see every tenant's rows — which is the one
    // mistake this screen must not make.
    expect(page()).toContain("withCurrentOrg(\n    'read',\n    'auditLog',")
    expect(page()).not.toContain('createPrismaClient')
    expect(page()).not.toContain('unauthenticatedDb')
  })

  it('shows a bounded number of rows', () => {
    // NOT UNBOUNDED. An audit table grows forever, and a page that fetched all
    // of it would get slower every week until somebody noticed.
    expect(AUDIT_TRAIL_LIMIT).toBeGreaterThanOrEqual(50)
    expect(AUDIT_TRAIL_LIMIT).toBeLessThanOrEqual(100)
  })

  it('does not put a diff VALUE on screen', () => {
    // FIELD NAMES ONLY. A diff carries rates, pay and addresses; the summary
    // line on an admin page is not where those belong. The reader gets the
    // record id and can open the record.
    const source = page()
    expect(source).toContain('row.fields.join')
    expect(source).not.toMatch(/\.from\b/)
    expect(source).not.toMatch(/\.to\b/)
  })
})

describe('the change summary', () => {
  it('names the fields that changed, humanised and sorted', () => {
    // SORTED, AND THE ORDER IS ASSERTED FROM THE OTHER END. Written in reverse
    // here on purpose: a JS object literal keeps insertion order, so a test that
    // listed them already-sorted would pass against an unsorted implementation —
    // which is exactly how the 'order recorded' claim survived until Postgres
    // returned jsonb's own order and the integration test caught it.
    expect(fieldsOf({ status: {}, rateCents: { from: 1, to: 2 } })).toEqual([
      'Rate',
      'Status',
    ])
  })

  it('survives a shape nothing enforces', () => {
    // `changes` IS `Json?` AND THE DATABASE ENFORCES NOTHING. A row from before
    // the current shape, or from a future writer, must not take the page down —
    // the row is still evidence that the write happened.
    expect(fieldsOf(null)).toEqual([])
    expect(fieldsOf(undefined)).toEqual([])
    expect(fieldsOf('a string')).toEqual([])
    expect(fieldsOf(42)).toEqual([])
    expect(fieldsOf(['an', 'array'])).toEqual([])
    expect(fieldsOf({})).toEqual([])
  })
})
