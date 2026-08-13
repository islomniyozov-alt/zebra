import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import {
  addCompany,
  companyUsage,
  deleteCompany,
  setCompanyActive,
  updateCompany,
} from '@/lib/companies'
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

describe('editing an authority', () => {
  it('corrects a field, and lets the row keep its own name and USDOT', async () => {
    // Created directly rather than through `addCompany`: the plan limit is 2
    // and both are spent by the tests above. These are about editing, and a
    // fixture that fought the limit would be testing the limit again.
    const { id } = await owner.company.create({
      data: {
        organizationId,
        name: `Editable ${nonce}`,
        dotNumber: '9000001',
        state: 'TX',
      },
    })

    // THE BUG AN EDIT FORM WRITTEN BY COPYING A CREATE FORM ALWAYS HAS: every
    // duplicate check has to exclude the record being edited, or saving a row
    // without touching its name refuses because its name is taken by itself.
    const same = await inOrg((tx) =>
      updateCompany(tx, id, {
        name: `Editable ${nonce}`,
        dotNumber: '9000001',
        legalName: 'Editable Holdings LLC',
        state: 'TX',
      }),
    )
    expect(same.ok).toBe(true)

    const row = await owner.company.findFirstOrThrow({ where: { id } })
    expect(row.legalName).toBe('Editable Holdings LLC')
  }, 300_000)

  it('still refuses a name or USDOT that belongs to a DIFFERENT authority', async () => {
    const first = await owner.company.findFirstOrThrow({
      where: { organizationId, name: `RAM Haulage ${nonce}` },
    })
    const second = await owner.company.findFirstOrThrow({
      where: { organizationId, name: `Editable ${nonce}` },
    })

    const byName = await inOrg((tx) =>
      updateCompany(tx, second.id, { name: first.name }),
    )
    expect(byName).toMatchObject({ ok: false, reason: 'duplicate_name' })

    const byDot = await inOrg((tx) =>
      updateCompany(tx, second.id, {
        name: second.name,
        dotNumber: first.dotNumber ?? '',
      }),
    )
    expect(byDot).toMatchObject({ ok: false, reason: 'duplicate_dot' })
  }, 300_000)

  it('keeps the strict two-letter state on the way in', async () => {
    const second = await owner.company.findFirstOrThrow({
      where: { organizationId, name: `Editable ${nonce}` },
    })
    const result = await inOrg((tx) =>
      updateCompany(tx, second.id, { name: second.name, state: 'Texas' }),
    )
    expect(result).toMatchObject({ ok: false, reason: 'bad_state' })
  }, 300_000)

  // FIELD-LEVEL DIFFS COME FROM THE AUDITED PATH, NOT FROM `updateCompany`.
  // The Prisma extension reads the row before and after and writes
  // `{ field: { from, to } }`. This asserts the wiring, because a lib function
  // called outside `withOrg` would leave an audit gap instead.
  it('writes a field-level audit diff naming what moved', async () => {
    const second = await owner.company.findFirstOrThrow({
      where: { organizationId, name: `Editable ${nonce}` },
    })
    await inOrg((tx) =>
      updateCompany(tx, second.id, {
        name: second.name,
        phone: '(555) 010-9999',
      }),
    )

    const entry = await owner.auditLog.findFirst({
      where: {
        organizationId,
        entityType: 'Company',
        entityId: second.id,
        action: 'UPDATE',
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry).not.toBeNull()
    const changes = entry!.changes as Record<
      string,
      { from: unknown; to: unknown }
    >
    expect(changes['phone']).toMatchObject({ to: '(555) 010-9999' })
    // And NOT every column: a diff that listed the whole row would bury the
    // field that actually moved, which is audit.ts's own stated reasoning.
    expect(Object.keys(changes)).not.toContain('name')
  }, 300_000)
})

describe('deactivating rather than deleting', () => {
  it('takes an authority out of the booking path and leaves its history', async () => {
    const company = await owner.company.findFirstOrThrow({
      where: { organizationId, name: `Editable ${nonce}` },
    })

    await inOrg((tx) => setCompanyActive(tx, company.id, false))

    // The topbar switcher, the create-load select and the Relay import all
    // filter on exactly this, which is what makes deactivation mean something.
    const bookable = await inOrg((tx) =>
      tx.company.findMany({ where: { isActive: true }, select: { id: true } }),
    )
    expect(bookable.map((row) => row.id)).not.toContain(company.id)

    // And the row is still there, still readable, still joinable by historical freight.
    const still = await inOrg((tx) =>
      tx.company.findFirst({ where: { id: company.id } }),
    )
    expect(still).not.toBeNull()

    await inOrg((tx) => setCompanyActive(tx, company.id, true))
    const back = await inOrg((tx) =>
      tx.company.findMany({ where: { isActive: true }, select: { id: true } }),
    )
    expect(back.map((row) => row.id)).toContain(company.id)
  }, 300_000)

  // THE ONE THAT MATTERS. `onDelete: Cascade` is on every child of Company, so
  // an unguarded delete of an authority that has run freight destroys its
  // loads, invoices, settlements and audit trail in one statement — and
  // reports success.
  it('REFUSES to delete an authority with freight, and names what is under it', async () => {
    const company = await owner.company.findFirstOrThrow({
      where: { organizationId, name: `RAM Haulage ${nonce}` },
    })
    const customer = await inOrg((tx) =>
      tx.customer.create({
        data: { organizationId, name: `Shipper ${nonce}` },
      }),
    )
    await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: company.id,
        customerId: customer.id,
        stops: [
          { type: 'PICKUP', city: 'Chicago', state: 'IL' },
          { type: 'DELIVERY', city: 'Dallas', state: 'TX' },
        ],
      }),
    )

    const refused = await inOrg((tx) => deleteCompany(tx, company.id))
    expect(refused.ok).toBe(false)
    expect(refused).toMatchObject({ reason: 'has_history' })
    if (!refused.ok && refused.reason === 'has_history') {
      expect(refused.usage.loads).toBeGreaterThan(0)
    }

    // RULE 11 — the pair. The refusal is about the freight, not about the
    // request: the authority is still there afterwards.
    const survived = await inOrg((tx) =>
      tx.company.findFirst({ where: { id: company.id } }),
    )
    expect(survived).not.toBeNull()
  }, 300_000)

  it('and ALLOWS removing a mistaken entry with nothing under it', async () => {
    // Created directly: the plan limit is 2 and both are spent by the tests
    // above, and this one is about deletion rather than about the limit.
    const { id } = await owner.company.create({
      data: { organizationId, name: `Typo ${nonce}` },
    })

    const usage = await inOrg((tx) => companyUsage(tx, id))
    expect(usage.total).toBe(0)

    const removed = await inOrg((tx) => deleteCompany(tx, id))
    expect(removed.ok).toBe(true)

    const gone = await owner.company.findFirst({ where: { id } })
    expect(gone).toBeNull()
  }, 300_000)

  // A counter row means this authority allocated a load number at some point,
  // which is freight even if the load has since gone.
  it('counts more than the three the sentence names', async () => {
    const company = await owner.company.create({
      data: { organizationId, name: `Trucks only ${nonce}` },
    })
    await owner.truck.create({
      data: {
        organizationId,
        companyId: company.id,
        unitNumber: `T-${nonce}`,
      },
    })

    const usage = await inOrg((tx) => companyUsage(tx, company.id))
    expect(usage.loads).toBe(0)
    expect(usage.invoices).toBe(0)
    expect(usage.settlements).toBe(0)
    // The safety net: a check that looked only at the named three would
    // happily cascade this truck away.
    expect(usage.other).toBeGreaterThan(0)
    expect(usage.total).toBeGreaterThan(0)

    const refused = await inOrg((tx) => deleteCompany(tx, company.id))
    expect(refused).toMatchObject({ ok: false, reason: 'has_history' })
  }, 300_000)
})
