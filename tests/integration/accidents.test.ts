import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { recordAccident, registerFor, voidAccident } from '@/lib/accidents'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE REGISTER AGAINST REAL ROWS.
//
// `tests/accidents.test.ts` grades §390.5 against hand-built facts. This
// grades the two things only a database can answer: that one authority's
// register never carries another's rows, and that an entry cannot leave the
// register — because there is no column that would let it.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let ramId = ''
let dolphinsId = ''
let userId = ''
let ramAccidentId = ''

const nonce = Math.random().toString(36).slice(2, 8)
const NOW = new Date()
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'accidents.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const company = async (name: string) =>
  (
    await owner.company.create({
      data: {
        organizationId,
        name: `${name} ${nonce}`,
        addressLine1: '5062 Free Pike',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
      },
    })
  ).id

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  organizationId = (
    await owner.organization.create({
      data: { name: `Acc ${nonce}`, slug: `acc-${nonce}` },
    })
  ).id
  ramId = await company('RAM')
  dolphinsId = await company('Dolphins')
  userId = (
    await owner.user.create({
      data: { email: `acc-${nonce}@example.test`, name: 'Acc' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  ramAccidentId = (
    await inOrg((tx) =>
      recordAccident(
        tx,
        organizationId,
        {
          companyId: ramId,
          occurredAt: days(-5).toISOString(),
          city: 'Whiteland',
          state: 'IN',
          towedAway: 'on',
        },
        { byUserId: userId },
      ),
    )
  ).id

  await inOrg((tx) =>
    recordAccident(
      tx,
      organizationId,
      {
        companyId: dolphinsId,
        occurredAt: days(-9).toISOString(),
        city: 'Gastonia',
        state: 'NC',
        injuries: '2',
      },
      { byUserId: userId },
    ),
  )
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

// ── THE GUARD NAMED "a company's register showing another's rows" ──────
describe('one register per authority', () => {
  it('shows only its own rows', async () => {
    // RLS separates TENANTS and has nothing to say about two authorities
    // inside one — both these companies share `organizationId`, so the policy
    // passes both rows and the `companyId` in `registerFor` is the only thing
    // keeping them apart. That makes this the test rather than a nicety.
    const ram = await inOrg((tx) => registerFor(tx, ramId, NOW))
    const dolphins = await inOrg((tx) => registerFor(tx, dolphinsId, NOW))

    expect(ram).toHaveLength(1)
    expect(ram[0]!.place).toBe('Whiteland, IN')
    expect(dolphins).toHaveLength(1)
    expect(dolphins[0]!.place).toBe('Gastonia, NC')

    expect(ram.map((e) => e.id)).not.toContain(dolphins[0]!.id)
  })

  it('derives recordable from the row, each register separately', async () => {
    const ram = await inOrg((tx) => registerFor(tx, ramId, NOW))
    const dolphins = await inOrg((tx) => registerFor(tx, dolphinsId, NOW))
    // One by tow-away, one by injuries. Neither by a stored flag.
    expect(ram[0]!.recordable).toBe(true)
    expect(ram[0]!.towedAway).toBe(true)
    expect(ram[0]!.injuries).toBe(0)
    expect(dolphins[0]!.recordable).toBe(true)
    expect(dolphins[0]!.injuries).toBe(2)
    expect(dolphins[0]!.towedAway).toBe(false)
  })

  it('records a hazmat release without making it recordable', async () => {
    const spill = await inOrg((tx) =>
      recordAccident(
        tx,
        organizationId,
        {
          companyId: ramId,
          occurredAt: days(-2).toISOString(),
          city: 'Etna',
          state: 'OH',
          hazmatReleased: 'on',
        },
        { byUserId: userId },
      ),
    )
    const ram = await inOrg((tx) => registerFor(tx, ramId, NOW))
    const entry = ram.find((row) => row.id === spill.id)!
    expect(entry.hazmatReleased).toBe(true)
    expect(entry.recordable).toBe(false)
  })
})

describe('an entry is voided, never deleted', () => {
  it('stays on the register with its reason', async () => {
    const voided = await inOrg((tx) =>
      voidAccident(tx, ramAccidentId, 'Filed against the wrong authority'),
    )
    expect(voided.voidedAt).toBeInstanceOf(Date)

    const ram = await inOrg((tx) => registerFor(tx, ramId, NOW))
    const entry = ram.find((row) => row.id === ramAccidentId)!
    expect(entry.voidReason).toBe('Filed against the wrong authority')
    // STILL THERE, and still recordable. Voiding says the ENTRY was a mistake,
    // not that the occurrence was not an accident.
    expect(entry.recordable).toBe(true)
  })

  it('refuses a second void rather than overwriting the first reason', async () => {
    await expect(
      inOrg((tx) => voidAccident(tx, ramAccidentId, 'Changed my mind')),
    ).rejects.toMatchObject({ code: 'already_voided' })
  })

  it('refuses a void with no reason', async () => {
    const fresh = await inOrg((tx) =>
      recordAccident(
        tx,
        organizationId,
        { companyId: ramId, occurredAt: days(-1).toISOString() },
        { byUserId: userId },
      ),
    )
    await expect(
      inOrg((tx) => voidAccident(tx, fresh.id, '  ')),
    ).rejects.toMatchObject({ code: 'required', field: 'voidReason' })
  })

  it('and the DATABASE refuses half a void', async () => {
    // The CHECK, not the service layer: a reason with no date, or a date with
    // no reason, are both rows nobody can explain to an auditor.
    const fresh = await owner.accident.findFirstOrThrow({
      where: { companyId: dolphinsId },
      select: { id: true },
    })
    await expect(
      owner.accident.update({
        where: { id: fresh.id },
        data: { voidedAt: new Date() },
      }),
    ).rejects.toThrow(/Accident_void_needs_reason|violates check/i)
  })
})

describe('three years, and nothing removes anything', () => {
  it('marks an old entry as past retention and keeps it', async () => {
    const old = await inOrg((tx) =>
      recordAccident(
        tx,
        organizationId,
        {
          companyId: dolphinsId,
          occurredAt: new Date(Date.UTC(2020, 0, 15)).toISOString(),
          city: 'Lexington',
          state: 'KY',
        },
        { byUserId: userId },
      ),
    )
    const register = await inOrg((tx) => registerFor(tx, dolphinsId, NOW))
    const entry = register.find((row) => row.id === old.id)!
    expect(entry.withinRetention).toBe(false)
    expect(entry.retainedUntil.getUTCFullYear()).toBe(2023)
  })
})
