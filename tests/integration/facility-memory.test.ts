import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { matchFacility, saveFacility } from '@/lib/facility-memory'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// FACILITY MEMORY AGAINST REAL POSTGRES (§3 step 4).
//
// The fold has its own unit tests; this asks the questions only a database can
// answer — does a saved dock come back on the next document, does the memory
// come with it, and does one tenant's dock stay invisible to another.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let otherOrganizationId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const willamette = {
  name: 'Willamette Cold Storage',
  addressLine1: `3120 Turner Road SE ${nonce}`,
  city: 'Salem',
  state: 'OR',
  postalCode: '97302',
}

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'facility.test' },
    maxWaitMs: 20_000,
    // Prisma's 5s default cannot be met from here — see the note in
    // tests/transaction-budget.test.ts. One dial for all nineteen suites.
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Facility ${nonce}`,
      slug: `facility-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
  })
  organizationId = organization.id

  const other = await owner.organization.create({
    data: {
      name: `Facility other ${nonce}`,
      slug: `facility-other-${nonce}`,
      maxCompanies: 5,
    },
  })
  otherOrganizationId = other.id

  const user = await owner.user.create({
    data: { email: `facility-${nonce}@example.test`, name: 'Facility Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
}, 300_000)

afterAll(async () => {
  for (const id of [organizationId, otherOrganizationId]) {
    await owner.organization.delete({ where: { id } }).catch(() => {})
  }
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('a dock the office has never been to', () => {
  it('matches nothing', async () => {
    expect(await inOrg((tx) => matchFacility(tx, willamette))).toBeNull()
  }, 300_000)

  it('and a stop with no street address is not even asked about', async () => {
    // The common case. No key means no query and no match — never a match on
    // the town, which would hand out the wrong dock's gate code.
    expect(
      await inOrg((tx) => matchFacility(tx, { city: 'Salem', state: 'OR' })),
    ).toBeNull()
  }, 300_000)
})

describe('saved at confirm, found on the next document', () => {
  let locationId = ''

  it('saves what the DOCUMENT said and nothing it did not', async () => {
    const saved = await inOrg((tx) =>
      saveFacility(tx, organizationId, {
        ...willamette,
        contactName: 'Dana',
        contactPhone: '(503) 555-0134',
        instructions: 'Check in at the guard shack.',
      }),
    )
    expect(saved).not.toBeNull()
    locationId = saved!.locationId

    const row = await owner.location.findFirstOrThrow({
      where: { id: locationId },
      select: {
        name: true,
        addressLine1: true,
        postalCode: true,
        timezone: true,
        gateCode: true,
        dockNotes: true,
        instructions: true,
      },
    })
    expect(row.name).toBe(willamette.name)
    expect(row.postalCode).toBe('97302')
    expect(row.instructions).toBe('Check in at the guard shack.')
    // NULL, and correctly so: Oregon spans two zones, and src/lib/stop-time.ts
    // records a zone only where the state has exactly one. An unknown zone is a
    // fact; a guessed one would make every stop look certain.
    expect(row.timezone).toBeNull()
    expect(row.gateCode).toBeNull()
    expect(row.dockNotes).toBeNull()
  }, 300_000)

  it('and the next document finds it — spelled the other way', async () => {
    // THE POINT OF THE WHOLE STEP. A different broker's confirmation prints
    // "Rd" and no zip, and it is the same dock.
    const found = await inOrg((tx) =>
      matchFacility(tx, {
        addressLine1: `3120 Turner Rd SE ${nonce}`,
        city: 'Salem',
        state: 'OR',
      }),
    )
    expect(found?.locationId).toBe(locationId)
  }, 300_000)

  it('carrying what the office wrote down since', async () => {
    // The gate code is not on any rate confirmation. Somebody put it here
    // after a driver called from the gate, which is the only way it ever
    // arrives — and having it arrive with the address next time is the feature.
    await owner.location.update({
      where: { id: locationId },
      data: {
        gateCode: '#4417',
        dockNotes: 'Dock 4 only — back in from Elder Creek.',
      },
    })

    const found = await inOrg((tx) => matchFacility(tx, willamette))
    expect(found?.hasMemory).toBe(true)
    expect(found?.memory.gateCode).toBe('#4417')
    expect(found?.memory.dockNotes).toContain('Dock 4 only')
    expect(found?.memory.contactPhone).toBe('(503) 555-0134')
  }, 300_000)

  it('and saving it twice does not make a second dock', async () => {
    // Two dispatchers booking the same new lane at the same time is ordinary.
    // A duplicate with half the notes on each is not recoverable by looking.
    const again = await inOrg((tx) =>
      saveFacility(tx, organizationId, { ...willamette, name: 'Willamette' }),
    )
    expect(again?.locationId).toBe(locationId)
    expect(
      await owner.location.count({
        where: { organizationId, normalizedAddress: { not: null } },
      }),
    ).toBe(1)
  }, 300_000)
})

describe('one tenant does not learn another tenant’s docks', () => {
  it('the same address in another organization is a different facility', async () => {
    // RLS is what enforces it; this is the proof that it does, on a table where
    // the lookup is by a column that is IDENTICAL across tenants — which is the
    // shape where a missing policy would go unnoticed longest.
    await owner.location.create({
      data: {
        organizationId: otherOrganizationId,
        name: 'Someone else’s dock',
        addressLine1: `3120 Turner Road SE ${nonce}`,
        city: 'Salem',
        state: 'OR',
        postalCode: '97302',
        normalizedAddress: `3120 TURNER RD SE ${nonce.toUpperCase()}|OR`,
        gateCode: 'NOT OURS',
      },
    })

    const found = await inOrg((tx) => matchFacility(tx, willamette))
    expect(found?.memory.gateCode).toBe('#4417')
    expect(found?.name).toBe(willamette.name)
  }, 300_000)
})
