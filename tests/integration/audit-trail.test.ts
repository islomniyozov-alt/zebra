import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { recentAuditRows } from '@/lib/audit-trail'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE AUDIT TRAIL READER SEES ONE ORGANIZATION'S ROWS AND NO OTHER'S.
//
// ── WHY THIS IS THE TEST THAT MATTERS ────────────────────────────────────
//
// The reader has no `organizationId` in its `where`, deliberately: the fence is
// row-level security, and a filter in the query would be a second and weaker
// expression of it (`tenancy.ts`). That design is only defensible if something
// proves the fence holds — so this seeds TWO organizations with audit rows and
// reads as one.
//
// "SEES NO ROWS FROM THE OTHER ORGANIZATION" IS TRUE OF AN EMPTY TABLE, which is
// the most comfortable way to be wrong (AGENTS.md). So the other organization's
// rows are counted as the owner first: they exist, and they are still invisible.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let mine = ''
let theirs = ''
let myUserId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(
  organizationId: string,
  fn: Parameters<typeof withOrg<T>>[1],
) =>
  withOrg(organizationId, fn, {
    attribution: { userId: myUserId, ip: null, userAgent: 'audit-trail.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const make = async (slug: string) =>
    (
      await owner.organization.create({
        data: { name: `Audit ${slug} ${nonce}`, slug: `${slug}-${nonce}` },
      })
    ).id
  mine = await make('mine')
  theirs = await make('theirs')

  const user = await owner.user.create({
    data: { email: `audit-${nonce}@example.test`, name: 'Audit Reader' },
  })
  myUserId = user.id
  await owner.membership.create({
    data: { userId: myUserId, organizationId: mine, role: 'OWNER' },
  })

  // ── ROWS IN BOTH, WRITTEN AS THE OWNER so RLS is not in the way of the
  //    FIXTURE. What is under test is the READ.
  const row = (
    organizationId: string,
    entityId: string,
    userId: string | null,
  ) =>
    owner.auditLog.create({
      data: {
        organizationId,
        userId,
        action: 'UPDATE',
        entityType: 'Load',
        entityId,
        changes: { rateCents: { from: 100, to: 200 }, status: {} },
      },
    })

  await row(mine, `mine-1-${nonce}`, myUserId)
  await row(mine, `mine-2-${nonce}`, null)
  await row(theirs, `theirs-1-${nonce}`, null)
  await row(theirs, `theirs-2-${nonce}`, null)
}, 300_000)

afterAll(async () => {
  for (const id of [mine, theirs]) {
    await owner.organization.delete({ where: { id } }).catch(() => {})
  }
  await owner.user.delete({ where: { id: myUserId } }).catch(() => {})
  await owner.$disconnect()
})

describe('recentAuditRows is scoped to the reading organization', () => {
  it('returns my rows and none of theirs', async () => {
    // THE CONTROL FIRST: the other organization's rows exist. Without this the
    // assertion below is satisfied by an empty table.
    expect(
      await owner.auditLog.count({ where: { organizationId: theirs } }),
    ).toBe(2)

    const rows = await inOrg(mine, (tx) => recentAuditRows(tx))
    const ids = rows.map((row) => row.entityId)

    expect(ids).toContain(`mine-1-${nonce}`)
    expect(ids).toContain(`mine-2-${nonce}`)
    expect(ids).not.toContain(`theirs-1-${nonce}`)
    expect(ids).not.toContain(`theirs-2-${nonce}`)
  }, 300_000)

  it('and reading as the other organization sees the mirror image', async () => {
    // BOTH DIRECTIONS, because a policy that returned nothing to everybody would
    // pass the test above.
    const rows = await inOrg(theirs, (tx) => recentAuditRows(tx))
    const ids = rows.map((row) => row.entityId)
    expect(ids).toContain(`theirs-1-${nonce}`)
    expect(ids).not.toContain(`mine-1-${nonce}`)
  }, 300_000)
})

describe('the shape a row arrives in', () => {
  it('carries the timestamp, action, entity and the changed field names', async () => {
    const rows = await inOrg(mine, (tx) => recentAuditRows(tx))
    const row = rows.find((entry) => entry.entityId === `mine-1-${nonce}`)
    expect(row).toBeDefined()
    expect(row?.action).toBe('UPDATE')
    expect(row?.entityType).toBe('Load')
    expect(row?.at).toBeInstanceOf(Date)
    // HUMANISED FIELD NAMES, no values.
    expect(row?.fields).toEqual(['Rate', 'Status'])
  }, 300_000)

  it('names the acting user, and says nothing where there was none', async () => {
    const rows = await inOrg(mine, (tx) => recentAuditRows(tx))
    expect(
      rows.find((entry) => entry.entityId === `mine-1-${nonce}`)?.actor,
    ).toBe('Audit Reader')
    // A MIGRATION OR A SYSTEM JOB WRITES WITH NO USER. Null is the honest
    // answer and the page renders it as an em dash (§8).
    expect(
      rows.find((entry) => entry.entityId === `mine-2-${nonce}`)?.actor,
    ).toBeNull()
  }, 300_000)

  it('is newest first and bounded by the limit it is given', async () => {
    const rows = await inOrg(mine, (tx) => recentAuditRows(tx, 1))
    expect(rows).toHaveLength(1)

    const all = await inOrg(mine, (tx) => recentAuditRows(tx))
    const times = all.map((row) => row.at.getTime())
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  }, 300_000)
})
