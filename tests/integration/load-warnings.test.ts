import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { loadWarnings, type WarningInput } from '@/lib/load-warnings'
import { createLoad, LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE DUPLICATE LOOKUPS, AGAINST REAL POSTGRES (§3 step 5).
//
// Each of these is a question about rows that exist, so none of them can be
// asked of a stub. The interesting ones are the NEGATIVES: a cancelled load is
// not a conflict, and another tenant's load is not one either.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let customerId = ''
let otherCustomerId = ''
let bookedNumber = ''
const nonce = Math.random().toString(36).slice(2, 8)

const BOL = `BOL-${nonce}-77`
const PO = `PO-${nonce}-4471`
const PICKUP_AT = new Date('2026-08-14T00:00:00Z')

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'warnings.test' },
    maxWaitMs: 20_000,
    // Prisma's 5s default cannot be met from here — see the note in
    // tests/transaction-budget.test.ts. One dial for all nineteen suites.
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const base = (): WarningInput => ({
  customerId,
  customerName: `Cascade ${nonce}`,
  bolNumber: null,
  poNumber: null,
  pickupAt: PICKUP_AT,
  deliveryAt: new Date('2026-08-15T00:00:00Z'),
  pickup: { city: 'Salem', state: 'OR' },
  delivery: { city: 'Sacramento', state: 'CA' },
  linehaulCents: 245_000,
})

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Warnings ${nonce}`,
      slug: `warnings-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: { email: `warnings-${nonce}@example.test`, name: 'Warnings Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  customerId = (
    await owner.customer.create({
      data: { organizationId, name: `Cascade ${nonce}` },
    })
  ).id
  otherCustomerId = (
    await owner.customer.create({
      data: { organizationId, name: `Meridian ${nonce}` },
    })
  ).id

  // THE LOAD EVERYTHING BELOW CONFLICTS WITH. Booked through the real service
  // so the stops, the numbering and the denormalised columns are what a booked
  // load actually has.
  const booked = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId,
        bolNumber: BOL,
        poNumber: PO,
        linehaulCents: 245_000,
        stops: [
          {
            type: 'PICKUP',
            name: 'Salem, OR',
            city: 'Salem',
            state: 'OR',
            scheduledAt: PICKUP_AT,
          },
          {
            type: 'DELIVERY',
            name: 'Sacramento, CA',
            city: 'Sacramento',
            state: 'CA',
            scheduledAt: new Date('2026-08-15T00:00:00Z'),
          },
        ],
      },
      { byUserId: userId },
    ),
  )
  bookedNumber = booked.loadNumber
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('a repeated shipper number', () => {
  it('names the load that already has the BOL', async () => {
    const warnings = await inOrg((tx) =>
      loadWarnings(tx, { ...base(), bolNumber: BOL }),
    )
    const duplicate = warnings.find((w) => w.kind === 'duplicate_bol')
    // NAMING THE RECORD IS THE WHOLE VALUE. "Duplicate BOL" sends somebody
    // looking; this tells them whether it is the split they expected.
    expect(duplicate?.values).toMatchObject({
      bol: BOL,
      load: bookedNumber,
      customer: `Cascade ${nonce}`,
    })
    expect(duplicate?.values.date).toBeTruthy()
  }, 300_000)

  it('and does not care how it was capitalised', async () => {
    const warnings = await inOrg((tx) =>
      loadWarnings(tx, { ...base(), bolNumber: BOL.toLowerCase() }),
    )
    expect(warnings.map((w) => w.kind)).toContain('duplicate_bol')
  }, 300_000)

  it('the same for a PO', async () => {
    const warnings = await inOrg((tx) =>
      loadWarnings(tx, { ...base(), poNumber: PO }),
    )
    expect(
      warnings.find((w) => w.kind === 'duplicate_po')?.values,
    ).toMatchObject({ po: PO, load: bookedNumber })
  }, 300_000)

  it('and says nothing about a number nobody has used', async () => {
    const warnings = await inOrg((tx) =>
      loadWarnings(tx, {
        ...base(),
        bolNumber: `${BOL}-X`,
        poNumber: `${PO}-X`,
        pickup: { city: 'Boise', state: 'ID' },
      }),
    )
    expect(warnings).toEqual([])
  }, 300_000)
})

describe('the same freight booked twice', () => {
  it('warns on broker + day + lane, and names the lane', async () => {
    const warnings = await inOrg((tx) => loadWarnings(tx, base()))
    const duplicate = warnings.find((w) => w.kind === 'duplicate_load')
    expect(duplicate?.values).toMatchObject({
      load: bookedNumber,
      lane: 'Salem, OR → Sacramento, CA',
    })
  }, 300_000)

  it('but not for a different broker down the same lane', async () => {
    // Two carriers' freight leaving the same town on the same day is a Tuesday.
    const warnings = await inOrg((tx) =>
      loadWarnings(tx, { ...base(), customerId: otherCustomerId }),
    )
    expect(warnings).toEqual([])
  }, 300_000)

  it('nor for the same broker on a different day', async () => {
    const warnings = await inOrg((tx) =>
      loadWarnings(tx, {
        ...base(),
        pickupAt: new Date('2026-08-15T00:00:00Z'),
      }),
    )
    expect(warnings).toEqual([])
  }, 300_000)

  it('nor for the same broker and day down a different lane', async () => {
    const warnings = await inOrg((tx) =>
      loadWarnings(tx, {
        ...base(),
        delivery: { city: 'Reno', state: 'NV' },
      }),
    )
    expect(warnings).toEqual([])
  }, 300_000)
})

describe('what is NOT a conflict', () => {
  it('a cancelled load is not one', async () => {
    // THE NEGATIVE THAT KEEPS WARNINGS WORTH READING. Warning about freight
    // somebody already cancelled trains the office to click through, and a
    // warning everybody clicks through is worse than no warning at all.
    const cancelled = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId,
          customerId,
          bolNumber: `${BOL}-CANCELLED`,
          stops: [
            {
              type: 'PICKUP',
              name: 'Boise, ID',
              city: 'Boise',
              state: 'ID',
              scheduledAt: PICKUP_AT,
            },
            {
              type: 'DELIVERY',
              name: 'Reno, NV',
              city: 'Reno',
              state: 'NV',
            },
          ],
        },
        { byUserId: userId },
      ),
    )
    await owner.load.update({
      where: { id: cancelled.id },
      data: { isCancelled: true, cancelledAt: new Date() },
    })

    const warnings = await inOrg((tx) =>
      loadWarnings(tx, {
        ...base(),
        bolNumber: `${BOL}-CANCELLED`,
        pickup: { city: 'Boise', state: 'ID' },
        delivery: { city: 'Reno', state: 'NV' },
      }),
    )
    expect(warnings).toEqual([])
  }, 300_000)

  it('and another organization’s load is invisible, not a duplicate', async () => {
    // RLS is what makes this true; the assertion is that the warning path is
    // inside it rather than reaching around it with a raw query.
    const other = await owner.organization.create({
      data: {
        name: `Warnings other ${nonce}`,
        slug: `warnings-other-${nonce}`,
        maxCompanies: 2,
        companies: { create: [{ name: `Beta ${nonce}` }] },
      },
      include: { companies: true },
    })
    const otherOrgCustomer = await owner.customer.create({
      data: { organizationId: other.id, name: `Cascade ${nonce}` },
    })
    await owner.load.create({
      data: {
        organizationId: other.id,
        companyId: other.companies[0]!.id,
        loadNumber: '9001',
        customerId: otherOrgCustomer.id,
        bolNumber: `${BOL}-OTHERTENANT`,
      },
    })

    const warnings = await inOrg((tx) =>
      loadWarnings(tx, {
        ...base(),
        bolNumber: `${BOL}-OTHERTENANT`,
        pickup: { city: 'Boise', state: 'ID' },
      }),
    )
    expect(warnings).toEqual([])

    await owner.organization.delete({ where: { id: other.id } }).catch(() => {})
  }, 300_000)
})
