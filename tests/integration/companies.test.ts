import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { addCompany } from '@/lib/companies'
import { createLoad } from '@/lib/loads'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// ADDING AN AUTHORITY (Phase 6 §7 flag 11), against real Postgres.
//
// The interesting assertions are the refusals: the plan limit, which has
// defaulted to 1 since the init migration and has never been enforced because
// nothing could create a company; and the counter, which must NOT exist until
// the authority books something.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'companies.test' },
    maxWaitMs: 20_000,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    // Two, so the limit is reachable without creating a hundred rows.
    data: { name: `Co ${nonce}`, slug: `co-${nonce}`, maxCompanies: 2 },
  })
  organizationId = organization.id
  const user = await owner.user.create({
    data: { email: `co-${nonce}@example.test`, name: 'Company Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('adding an authority', () => {
  it('creates one with the fields the invoice header prints', async () => {
    const result = await inOrg((tx) =>
      addCompany(tx, organizationId, {
        name: `RAM Haulage ${nonce}`,
        mcNumber: '112499',
        dotNumber: '3162967',
        addressLine1: '1200 W Main St',
        city: 'Bolingbrook',
        state: 'il',
        postalCode: '60490',
        phone: '(630) 716-3311',
      }),
    )
    expect(result.ok).toBe(true)

    const row = await owner.company.findFirstOrThrow({
      where: { organizationId },
      select: { name: true, mcNumber: true, dotNumber: true, state: true },
    })
    // Uppercased on the way in, so the invoice never prints "il".
    expect(row).toMatchObject({
      mcNumber: '112499',
      dotNumber: '3162967',
      state: 'IL',
    })
  }, 300_000)

  it('refuses a second authority with the same name, whatever the case', async () => {
    const result = await inOrg((tx) =>
      addCompany(tx, organizationId, { name: `ram haulage ${nonce}` }),
    )
    expect(result).toMatchObject({ ok: false, reason: 'duplicate_name' })
  }, 300_000)

  // THE SCHEMA HAS ALWAYS HAD `@@unique([organizationId, dotNumber])` AND
  // NOTHING EVER HANDLED IT — a duplicate escaped as a Prisma unique violation
  // and reached the browser as a 500 with no sentence in it. Harmless while a
  // DOT number was typed occasionally; not harmless now the FMCSA lookup fills
  // it in, because looking the same carrier up twice is exactly what somebody
  // does when they are not sure whether they already added it.
  it('refuses a second authority with the same USDOT, naming the number', async () => {
    const result = await inOrg((tx) =>
      addCompany(tx, organizationId, {
        name: `RAM Haulage again ${nonce}`,
        dotNumber: '3162967',
      }),
    )
    expect(result).toMatchObject({
      ok: false,
      reason: 'duplicate_dot',
      dot: '3162967',
    })
  }, 300_000)

  it('refuses a state that is not a two-letter code', async () => {
    const result = await inOrg((tx) =>
      addCompany(tx, organizationId, {
        name: `Illinois spelled out ${nonce}`,
        state: 'Illinois',
      }),
    )
    expect(result).toMatchObject({ ok: false, reason: 'bad_state' })
  }, 300_000)
})

describe('the plan limit, which is the paid lever', () => {
  it('allows the second authority the plan covers', async () => {
    const result = await inOrg((tx) =>
      addCompany(tx, organizationId, { name: `Dolphins ${nonce}` }),
    )
    expect(result.ok).toBe(true)
  }, 300_000)

  it('and REFUSES the third, naming the number', async () => {
    // `maxCompanies` has defaulted to 1 since the init migration and nothing
    // ever checked it, because nothing could create a company. A tenant on a
    // two-authority plan that can add a third is not on a plan.
    const result = await inOrg((tx) =>
      addCompany(tx, organizationId, { name: `Third ${nonce}` }),
    )
    expect(result).toMatchObject({
      ok: false,
      reason: 'limit_reached',
      limit: 2,
    })

    expect(await owner.company.count({ where: { organizationId } })).toBe(2)
  }, 300_000)
})

describe('a new authority’s numbering', () => {
  it('has NO counter until it books something', async () => {
    // The standing per-authority rule: the series starts at the first booking.
    // Seeding a counter here would put a row at zero under a carrier that may
    // never book, and would be a second place deciding where a series starts.
    const company = await owner.company.findFirstOrThrow({
      where: { organizationId, name: `Dolphins ${nonce}` },
      select: { id: true },
    })
    expect(
      await owner.counter.count({ where: { companyId: company.id } }),
    ).toBe(0)
  }, 300_000)

  it('and starts its OWN series at the first load, not the other authority’s', async () => {
    const [alpha, beta] = await owner.company.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: { id: true },
    })
    const customer = await owner.customer.create({
      data: { organizationId, name: `Broker ${nonce}` },
    })

    const book = (companyId: string) =>
      inOrg((tx) =>
        createLoad(tx, organizationId, {
          companyId,
          customerId: customer.id,
          stops: [
            { type: 'PICKUP', city: 'Chicago', state: 'IL' },
            { type: 'DELIVERY', city: 'Dallas', state: 'TX' },
          ],
        }),
      )

    const first = await book(alpha!.id)
    const second = await book(beta!.id)

    // Each authority numbers from its own start — two loads booked minutes
    // apart carry the same number under different carriers, which is the whole
    // point of a per-authority series.
    expect(second.loadNumber).toBe(first.loadNumber)
  }, 300_000)
})
