import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import {
  listedAuthorities,
  SELECTABLE_AUTHORITY,
  setCompanyActive,
} from '@/lib/companies'
import { thisWeek } from '@/lib/dashboard'
import { settingsForScope } from '@/lib/settings'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// A DEACTIVATED AUTHORITY APPEARS ON NO LIST (GAPS code gap 11, 2026-10-08).
//
// The ruling named four lists: the chips (`/loads` and the money screens),
// Record a payment, the factoring page, and the dashboard library's This-week
// rows. The first three read `listedAuthorities`, and
// `tests/authority-lists.test.ts` proves from source that they do, so asking
// `listedAuthorities` here answers for all three. The fourth is read directly.
//
// The deactivated authority is deactivated with the same call the companies
// screen's button makes, against the shape production has: AG FREIGHT INC and
// SIR CHARLES were active, with no freight, and then switched off. A retired
// authority sits beside it to prove the list rule did not quietly become the
// creation rule.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let userId = ''
let activeId = ''
let retiredId = ''
let deactivatedId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'authority-lists.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Lists ${nonce}`,
      slug: `lists-${nonce}`,
      maxCompanies: 3,
      companies: {
        create: [
          { name: `Active ${nonce}` },
          { name: `Retired ${nonce}`, retired: true },
          { name: `Switched off ${nonce}` },
        ],
      },
    },
    include: { companies: { orderBy: { name: 'asc' } } },
  })
  organizationId = organization.id
  const byName = new Map(organization.companies.map((c) => [c.name, c.id]))
  activeId = byName.get(`Active ${nonce}`)!
  retiredId = byName.get(`Retired ${nonce}`)!
  deactivatedId = byName.get(`Switched off ${nonce}`)!

  const user = await owner.user.create({
    data: { email: `lists-${nonce}@example.test`, name: 'Lists Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  // Through the function the Deactivate button calls, not a raw update.
  const result = await inOrg((tx) => setCompanyActive(tx, deactivatedId, false))
  expect(result.ok).toBe(true)
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('a deactivated authority', () => {
  it('is not on the chips, Record a payment or the factoring page', async () => {
    const listed = await inOrg((tx) => listedAuthorities(tx, []))
    const ids = listed.map((row) => row.id)
    expect(ids).toContain(activeId)
    expect(ids).not.toContain(deactivatedId)
  }, 300_000)

  it('is not listed even to a member scoped to it', async () => {
    const listed = await inOrg((tx) =>
      listedAuthorities(tx, [activeId, deactivatedId]),
    )
    expect(listed.map((row) => row.id)).toEqual([activeId])
  }, 300_000)

  it("is not a row in the dashboard library's This-week", async () => {
    const week = await inOrg((tx) => thisWeek(tx, []))
    const ids = week.map((row) => row.companyId)
    expect(ids).toContain(activeId)
    expect(ids).not.toContain(deactivatedId)
  }, 300_000)

  it('is not on the Settings page', async () => {
    const rows = await inOrg((tx) => settingsForScope(tx))
    const ids = rows.map((row) => row.companyId)
    expect(ids).toContain(activeId)
    expect(ids).not.toContain(deactivatedId)
  }, 300_000)

  it('comes back on every list when reactivated', async () => {
    await inOrg((tx) => setCompanyActive(tx, deactivatedId, true))
    const listed = await inOrg((tx) => listedAuthorities(tx, []))
    expect(listed.map((row) => row.id)).toContain(deactivatedId)
    await inOrg((tx) => setCompanyActive(tx, deactivatedId, false))
  }, 300_000)
})

describe('a retired authority', () => {
  it('stays on the lists, so its history can still be filtered to', async () => {
    const listed = await inOrg((tx) => listedAuthorities(tx, []))
    expect(listed.map((row) => row.id)).toContain(retiredId)
  }, 300_000)

  it('is still refused by the creation rule', async () => {
    const bookable = await inOrg((tx) =>
      tx.company.findMany({
        where: SELECTABLE_AUTHORITY,
        select: { id: true },
      }),
    )
    const ids = bookable.map((row) => row.id)
    expect(ids).toEqual([activeId])
  }, 300_000)
})
