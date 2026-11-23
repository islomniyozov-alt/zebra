import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { recordRenewal, recordsForSubject } from '@/lib/compliance'
import { readRenewalForm } from '@/lib/compliance-form'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// §0 RULE 14 (a), v11.45 — THE READER FAILS ENTIRELY; THE RECORD TYPED BY HAND
// STILL PERSISTS.
//
// Owner's brief 2026-11-23, item 3. Every document reader the app has is made
// to fail: the model client and the classifier throw on any call. The office
// then types truck 4974's annual inspection from
// Annual-DOT-Inspection-02.18.26.jpg exactly as dev refused it — `2/18/2027` —
// through the same two functions the compliance panel's action calls, and the
// row is read back from Postgres under RLS. If the manual path ever reached for
// a reader, the throw would fail this test.
// ---------------------------------------------------------------------------

vi.mock('@/lib/claude', async (original) => {
  const actual = await original<Record<string, unknown>>()
  const fail = () => {
    throw new Error('compliance-manual.test: the reader is down')
  }
  return { ...actual, askAboutDocument: fail }
})
vi.mock('@/lib/classify', () => ({
  classifyDocument: () => {
    throw new Error('compliance-manual.test: the classifier is down')
  },
}))

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let truckId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'compliance-manual.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Compliance manual ${nonce}`,
      slug: `compliance-manual-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  const user = await owner.user.create({
    data: { email: `compliance-manual-${nonce}@example.test`, name: 'Office' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
  truckId = (
    await owner.truck.create({
      data: { organizationId, companyId, unitNumber: `4974-${nonce}` },
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

describe('the reader is down and the office types it by hand', () => {
  it('the reader really is down', async () => {
    // The precondition: without it, the case below proves nothing.
    const { classifyDocument } = await import('@/lib/classify')
    const { askAboutDocument } = await import('@/lib/claude')
    expect(() => classifyDocument({} as never)).toThrow(/classifier is down/)
    expect(() => askAboutDocument({} as never)).toThrow(/reader is down/)
  })

  it('persists the annual inspection exactly as typed', async () => {
    const data = new FormData()
    data.set('type', 'ANNUAL_INSPECTION')
    data.set('expiresAt', '2/18/2027')
    data.set('issuedAt', '2/18/2026')
    data.set('identifier', `160526036-${nonce}`)
    data.set('issuer', 'Inspector N')
    data.set('notes', 'typed by hand; the reader failed')

    const read = readRenewalForm(data, new Date(Date.UTC(2026, 10, 23)))
    expect(read.ok).toBe(true)
    if (!read.ok) return

    const outcome = await inOrg((tx) =>
      recordRenewal(tx, {
        subject: 'truck',
        subjectId: truckId,
        ...read.fields,
      }),
    )
    expect(outcome.ok).toBe(true)

    const rows = await inOrg((tx) => recordsForSubject(tx, 'truck', truckId))
    const saved = rows.find((row) => row.identifier === `160526036-${nonce}`)
    expect(saved).toBeDefined()
    expect(saved!.type).toBe('ANNUAL_INSPECTION')
    expect(saved!.expiresAt.toISOString()).toBe('2027-02-18T00:00:00.000Z')
    expect(saved!.issuedAt?.toISOString()).toBe('2026-02-18T00:00:00.000Z')
    expect(saved!.issuer).toBe('Inspector N')
    const stored = await inOrg((tx) =>
      tx.complianceItem.findUniqueOrThrow({
        where: { id: saved!.id },
        select: { notes: true, truckId: true },
      }),
    )
    expect(stored).toEqual({
      notes: 'typed by hand; the reader failed',
      truckId,
    })
  })
})
