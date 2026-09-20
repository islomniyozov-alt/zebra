import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// TWO PROMISES THE DATABASE MAKES, AND ONE IT CANNOT.
//
// Item 10. A partial unique index makes a second default authority impossible
// to write; the frozen payee on a settlement is a promise the WRITER keeps, so
// it is checked by moving the driver afterwards and reading the statement row
// back.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''

const nonce = Math.random().toString(36).slice(2, 8)

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  organizationId = (
    await owner.organization.create({
      data: { name: `Item10 ${nonce}`, slug: `item10-${nonce}` },
    })
  ).id

  companyId = (
    await owner.company.create({
      data: {
        organizationId,
        name: `RAM ${nonce}`,
        addressLine1: '5062 Free Pike',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
        isDefault: true,
      },
    })
  ).id
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

describe('the default authority', () => {
  it('refuses a SECOND default in the same organization', async () => {
    // THE GUARD NAMED "two defaults". "Exactly one" is the kind of rule that
    // survives every code path only when nothing can write the second row —
    // an application check would hold until the first importer, seeder or
    // console session that did not know about it.
    await expect(
      owner.company.create({
        data: {
          organizationId,
          name: `Dolphins ${nonce}`,
          addressLine1: '1 Dock Road',
          city: 'Dayton',
          state: 'OH',
          postalCode: '45426',
          isDefault: true,
        },
      }),
    ).rejects.toThrow(/Unique constraint|Company_one_default_per_org/i)
  })

  it('allows a second NON-default, which is the normal case', async () => {
    // The pair: the index must constrain defaults, not authorities.
    const second = await owner.company.create({
      data: {
        organizationId,
        name: `Midwest ${nonce}`,
        addressLine1: '2 Dock Road',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
      },
    })
    expect(second.isDefault).toBe(false)
  })

  it('lets ANOTHER organization have its own default', async () => {
    // Scoped to the organization, not global. Without the scope the second
    // tenant could never name a default at all.
    const other = await owner.organization.create({
      data: { name: `Other ${nonce}`, slug: `other-${nonce}` },
    })
    const company = await owner.company.create({
      data: {
        organizationId: other.id,
        name: `Other RAM ${nonce}`,
        addressLine1: '3 Dock Road',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
        isDefault: true,
      },
    })
    expect(company.isDefault).toBe(true)
  })
})

describe('the payee on a settlement', () => {
  it('does not move when the driver changes theirs afterwards', async () => {
    // THE GUARD NAMED "payTo not frozen". An owner-operator who changes LLC in
    // November must not restate every statement they were paid on in March.
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'JERRY ROBERT',
        lastName: 'MCKANE',
        payToName: 'MCKANE HAULING LLC',
        payToAddress: '12 Mill Road, Dayton, OH',
      },
    })

    const settlement = await owner.settlement.create({
      data: {
        organizationId,
        companyId,
        driverId: driver.id,
        settlementNumber: `ST-FROZE-${nonce}`,
        periodStart: new Date(Date.UTC(2026, 2, 1)),
        periodEnd: new Date(Date.UTC(2026, 2, 7)),
        // Frozen at generation, exactly as the batch writes it.
        payToName: driver.payToName,
        payToAddress: driver.payToAddress,
      },
    })

    await owner.driver.update({
      where: { id: driver.id },
      data: {
        payToName: 'MCKANE LOGISTICS LLC',
        payToAddress: '99 New Street, Columbus, OH',
      },
    })

    const after = await owner.settlement.findUniqueOrThrow({
      where: { id: settlement.id },
      select: { payToName: true, payToAddress: true },
    })
    expect(after.payToName).toBe('MCKANE HAULING LLC')
    expect(after.payToAddress).toBe('12 Mill Road, Dayton, OH')
  })

  it('records NULL for a driver paid under their own name', async () => {
    // Null is a fact about that statement — "it printed the driver" — and not
    // an absence for somebody to fill in later.
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'SOLO',
        lastName: 'RUNNER',
      },
    })
    const settlement = await owner.settlement.create({
      data: {
        organizationId,
        companyId,
        driverId: driver.id,
        settlementNumber: `ST-PLAIN-${nonce}`,
        periodStart: new Date(Date.UTC(2026, 2, 1)),
        periodEnd: new Date(Date.UTC(2026, 2, 7)),
        payToName: driver.payToName,
        payToAddress: driver.payToAddress,
      },
    })
    expect(settlement.payToName).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// CLOSED HISTORY TAKES NO PAYMENT TYPE.
//
// Datatruck billed and was paid for that freight under whatever it agreed at
// the time. Stamping an arrangement on it now is this system asserting a
// commercial fact it was not present for — on 14,464 rows, landing in the
// receivables column beside live freight as though somebody had decided it.
// ---------------------------------------------------------------------------
describe('payment type on closed history', () => {
  it('is refused, by name', async () => {
    const { withOrg } = await import('@/lib/tenancy')
    const { createBroker } = await import('@/lib/brokers')
    const { createLoad, updateLoad } = await import('@/lib/loads')

    const user = await owner.user.create({
      data: { email: `ch-${nonce}@example.test`, name: 'CH' },
    })
    await owner.membership.create({
      data: { userId: user.id, organizationId, role: 'OWNER' },
    })
    const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]) =>
      withOrg(organizationId, fn, {
        attribution: { userId: user.id, ip: null, userAgent: 'ch.test' },
        timeoutMs: LOAD_WRITE_TIMEOUT_MS,
      })

    const broker = await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BROKER ${nonce}` }),
    )
    const at = new Date(Date.UTC(2026, 2, 3))
    const load = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId,
          customerId: broker.id,
          referenceNumber: `CH-${nonce}`,
          stops: [
            { type: 'PICKUP', city: 'Whiteland', state: 'IN', scheduledAt: at },
            {
              type: 'DELIVERY',
              city: 'Gastonia',
              state: 'NC',
              scheduledAt: at,
            },
          ],
          linehaulCents: 100_000,
        },
        { byUserId: user.id },
      ),
    )
    await owner.load.update({
      where: { id: load.id },
      data: { billingStatus: 'CLOSED_IN_DATATRUCK' },
    })

    await expect(
      inOrg((tx) => updateLoad(tx, load.id, { paymentType: 'Factored' })),
    ).rejects.toThrow(/closed_history_payment_type/)
  })

  it('still lets a LIVE load take one', async () => {
    // The pair: the refusal must be about closed history, not about payment
    // types. Without it the rule could refuse everything and still pass.
    const { withOrg } = await import('@/lib/tenancy')
    const { createBroker } = await import('@/lib/brokers')
    const { createLoad, updateLoad } = await import('@/lib/loads')

    const user = await owner.user.findFirstOrThrow({
      where: { memberships: { some: { organizationId } } },
    })
    const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]) =>
      withOrg(organizationId, fn, {
        attribution: { userId: user.id, ip: null, userAgent: 'ch.test' },
        timeoutMs: LOAD_WRITE_TIMEOUT_MS,
      })

    const broker = await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BROKER2 ${nonce}` }),
    )
    const at = new Date(Date.UTC(2026, 2, 4))
    const load = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId,
          customerId: broker.id,
          referenceNumber: `LIVE-${nonce}`,
          stops: [
            { type: 'PICKUP', city: 'Whiteland', state: 'IN', scheduledAt: at },
            {
              type: 'DELIVERY',
              city: 'Gastonia',
              state: 'NC',
              scheduledAt: at,
            },
          ],
          linehaulCents: 100_000,
        },
        { byUserId: user.id },
      ),
    )

    await inOrg((tx) => updateLoad(tx, load.id, { paymentType: 'Factored' }))
    const after = await owner.load.findUniqueOrThrow({
      where: { id: load.id },
      select: { paymentType: true },
    })
    expect(after.paymentType).toBe('Factored')
  })
})
