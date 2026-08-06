import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import {
  complianceCount,
  complianceQueue,
  recordsForSubject,
} from '@/lib/compliance'
import { actionQueue } from '@/lib/dashboard'
import type { AuthorizedSession } from '@/lib/permissions'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Compliance against real Postgres.
//
// The derivation itself is covered in tests/compliance.test.ts. What can only
// be asserted here is §4's first acceptance box, in full:
//
//   "A truck with an expiring annual inspection appears in the queue exactly
//    `leadTime` days out, and in the dashboard row, and on its own detail
//    panel — all three from one derivation"
//
// So all three are asked, about the same truck, on the same day, and made to
// agree. And the lead time comes from the authority's OWN CompanySettings
// row — the Phase 1 field nothing read until now.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let truckId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'compliance.test' },
    maxWaitMs: 20_000,
  })

const asOwner = (): AuthorizedSession => ({
  userId,
  organizationId,
  role: 'OWNER',
  companyScopes: [],
})

/** A compliance record expiring `days` from `NOW`. */
async function record(
  type: 'ANNUAL_INSPECTION' | 'REGISTRATION' | 'CDL',
  days: number,
  identifier?: string,
) {
  const expiresAt = new Date(NOW.getTime())
  expiresAt.setUTCDate(expiresAt.getUTCDate() + days)
  return owner.complianceItem.create({
    data: {
      organizationId,
      companyId,
      type,
      truckId,
      expiresAt,
      ...(identifier ? { identifier } : {}),
    },
    select: { id: true },
  })
}

/** A fixed "today", so a test run at 23:58 does not answer differently. */
const NOW = new Date('2026-08-06T12:00:00Z')

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Compliance ${nonce}`,
      slug: `compliance-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  // THE LEAD TIME IS THE AUTHORITY'S OWN. Fourteen, not the 30 default, so a
  // passing test cannot be explained by the constant.
  await owner.companySettings.create({
    data: { companyId, organizationId, complianceWarnDays: 14 },
  })

  const user = await owner.user.create({
    data: { email: `compliance-${nonce}@example.test`, name: 'Safety Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  truckId = (
    await owner.truck.create({
      data: { organizationId, companyId, unitNumber: `104-${nonce}` },
    })
  ).id
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('§4: the queue, the dashboard and the panel agree', () => {
  it('shows up in all three exactly at the lead time, and not a day early', async () => {
    // 15 days out, against a 14-day lead time: NOT yet.
    const item = await record('ANNUAL_INSPECTION', 15, `AI-${nonce}`)

    const early = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(early.leadDays).toBe(14)
    expect(early.rows.map((row) => row.id)).not.toContain(item.id)

    // Move it one day closer. Fourteen days out is exactly the boundary.
    const at = new Date(NOW.getTime())
    at.setUTCDate(at.getUTCDate() + 14)
    await owner.complianceItem.update({
      where: { id: item.id },
      data: { expiresAt: at },
    })

    // 1 — THE QUEUE.
    const queue = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    const queued = queue.rows.find((row) => row.id === item.id)
    expect(queued, 'not in the queue at exactly leadTime days').toBeDefined()
    expect(queued).toMatchObject({
      status: 'expiring',
      daysLeft: 14,
      subject: 'truck',
      isSuperseded: false,
    })

    // 2 — THE DASHBOARD ROW. Counted through the same function.
    const counted = await inOrg((tx) => complianceCount(tx, {}, NOW))
    expect(counted.count).toBe(queue.rows.length)

    const rows = await inOrg((tx) => actionQueue(tx, asOwner(), {}))
    expect(rows.find((row) => row.key === 'compliance')?.count).toBe(
      queue.rows.length,
    )

    // 3 — THE ASSET PANEL.
    const panel = await inOrg((tx) =>
      recordsForSubject(tx, 'truck', truckId, NOW),
    )
    const onPanel = panel.find((row) => row.id === item.id)
    expect(onPanel).toMatchObject({ status: 'expiring', daysLeft: 14 })

    // All three, from one derivation.
    expect(onPanel?.status).toBe(queued?.status)
  }, 300_000)

  it('reads the lead time per authority, not from a constant', async () => {
    // Same record, a different policy: widen the window and the answer moves.
    await owner.companySettings.update({
      where: { companyId },
      data: { complianceWarnDays: 60 },
    })
    const wide = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(wide.leadDays).toBe(60)

    await owner.companySettings.update({
      where: { companyId },
      data: { complianceWarnDays: 14 },
    })
  }, 300_000)
})

describe('a renewal supersedes without overwriting', () => {
  it('keeps the lapsed record, marks it, and takes it out of the queue', async () => {
    const lapsed = await record('REGISTRATION', -40, `REG-OLD-${nonce}`)

    // Expired and in the queue — nobody has renewed it yet.
    const before = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(before.rows.find((row) => row.id === lapsed.id)).toMatchObject({
      status: 'expired',
      isSuperseded: false,
    })

    // Renew: a NEW record, nothing updated.
    const renewed = await record('REGISTRATION', 300, `REG-NEW-${nonce}`)

    const after = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    // OUT of the queue: a red row for a truck that is entirely legal teaches
    // people to ignore red.
    expect(after.rows.map((row) => row.id)).not.toContain(lapsed.id)

    // But STILL THERE, and marked — §2.1's whole point.
    const panel = await inOrg((tx) =>
      recordsForSubject(tx, 'truck', truckId, NOW),
    )
    expect(panel.find((row) => row.id === lapsed.id)).toMatchObject({
      status: 'expired',
      isSuperseded: true,
      identifier: `REG-OLD-${nonce}`,
    })
    expect(panel.find((row) => row.id === renewed.id)).toMatchObject({
      status: 'current',
      isSuperseded: false,
    })

    // Nothing was overwritten: the old row's own columns are untouched.
    const stored = await owner.complianceItem.findUnique({
      where: { id: lapsed.id },
      select: { identifier: true, deletedAt: true },
    })
    expect(stored).toMatchObject({
      identifier: `REG-OLD-${nonce}`,
      deletedAt: null,
    })
  }, 300_000)
})

describe('what the queue filters', () => {
  it('narrows by subject and by type', async () => {
    const bySubject = await inOrg((tx) =>
      complianceQueue(tx, {}, { subject: 'driver' }, NOW),
    )
    // Every record in this fixture is on a truck.
    expect(bySubject.rows).toEqual([])

    const byType = await inOrg((tx) =>
      complianceQueue(tx, {}, { type: 'ANNUAL_INSPECTION' }, NOW),
    )
    expect(byType.rows.every((row) => row.type === 'ANNUAL_INSPECTION')).toBe(
      true,
    )
    expect(byType.rows.length).toBeGreaterThan(0)
  }, 300_000)

  it('leaves current records out — it is a queue, not an inventory', async () => {
    const far = await record('CDL', 900)
    const queue = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(queue.rows.map((row) => row.id)).not.toContain(far.id)

    // The panel has it, because the panel IS the inventory.
    const panel = await inOrg((tx) =>
      recordsForSubject(tx, 'truck', truckId, NOW),
    )
    expect(panel.map((row) => row.id)).toContain(far.id)
  }, 300_000)

  it('can be asked for the superseded ones explicitly', async () => {
    const withHistory = await inOrg((tx) =>
      complianceQueue(tx, {}, { includeSuperseded: true }, NOW),
    )
    expect(withHistory.rows.some((row) => row.isSuperseded)).toBe(true)
  }, 300_000)
})
