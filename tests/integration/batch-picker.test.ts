import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { openBatch, refreshDraft } from '@/lib/settlement-batch'
import {
  excludeTrips,
  includeTrips,
  excludedLoadIds,
} from '@/lib/batch-exclusions'
import { weekOf } from '@/lib/settlement-week'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE TRIP PICKER'S TWO CLAIMS, AGAINST ROWS (§6.2.10 parts 1–2).
//
//   * the trips left ticked sum to the batch's gross, TO THE CENT;
//   * an exclusion is monotonic — a refresh adds new freight and never
//     un-excludes.
//
// ── WHY THE AGREEMENT TEST IS THE IMPORTANT ONE ──────────────────────────
//
// A picker that silently dropped a trip would look right on every screen: the
// grid would show what it showed, the batch would total what it totalled, and
// nobody would have the two numbers side by side. The only way that defect
// surfaces is somebody adding them up, which is what this does.
//
// BOTH SIDES SEEDED ABOVE ZERO, deliberately. An agreement test between two
// zeroes passes against a function that returns nothing at all.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let otherCompanyId = ''
let userId = ''
let brokerId = ''
let truckId = ''
let driverId = ''
let otherDriverId = ''

const nonce = Math.random().toString(36).slice(2, 8)

// A SETTLED WEEK IN THE PAST, so nothing here depends on today being a Tuesday.
const WEEK = weekOf(new Date(Date.UTC(2026, 6, 8)))

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'batch-picker.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  organizationId = (
    await owner.organization.create({
      data: { name: `Pick ${nonce}`, slug: `pick-${nonce}` },
    })
  ).id
  const company = (name: string) =>
    owner.company.create({
      data: {
        organizationId,
        name,
        addressLine1: '1 Dock St',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
      },
    })
  companyId = (await company(`RAM ${nonce}`)).id
  otherCompanyId = (await company(`DOLPHINS ${nonce}`)).id

  userId = (
    await owner.user.create({
      data: { email: `pick-${nonce}@example.test`, name: 'Picker' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  truckId = (
    await owner.truck.create({
      data: {
        organizationId,
        companyId,
        unitNumber: `P-${nonce}`,
        vin: `VINP${nonce}0000000`,
      },
    })
  ).id

  const driver = async (first: string, company: string) => {
    const row = await owner.driver.create({
      data: {
        organizationId,
        companyId: company,
        firstName: first,
        lastName: nonce.toUpperCase(),
        employmentType: 'OWNER_OPERATOR',
      },
    })
    // A PERCENTAGE RULE IN FORCE, or every trip lands in `noRule` and the test
    // would be measuring an empty batch.
    await owner.driverPayRule.create({
      data: {
        organizationId,
        driverId: row.id,
        type: 'PERCENT_LINEHAUL',
        percentBps: 3000,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      },
    })
    return row.id
  }
  driverId = await driver('TICKED', companyId)
  otherDriverId = await driver('OTHER', otherCompanyId)

  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `BK ${nonce}` }),
    )
  ).id
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

/** A delivered, POD-received trip inside the week, on the given authority. */
async function trip(input: {
  cents: number
  company?: string
  driver?: string
  /**
   * The week the trip belongs to. Defaults to the module's week.
   *
   * PARAMETERISED AFTER A FIXTURE BUG: it was hard-coded, so trips made for a
   * later batch landed in the FIRST week and the batch under test came out
   * empty. Two tests failed with "expected +0", which is what a test measuring
   * the wrong week looks like — the code was right.
   */
  week?: { start: Date; end: Date }
}): Promise<string> {
  const week = input.week ?? WEEK
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId: input.company ?? companyId,
        customerId: brokerId,
        referenceNumber: `T-${nonce}-${Math.random().toString(36).slice(2, 7)}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: new Date(week.start.getTime() + 86_400_000),
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: new Date(week.start.getTime() + 2 * 86_400_000),
          },
        ],
        linehaulCents: input.cents,
      },
      { byUserId: userId },
    ),
  )

  await owner.load.update({
    where: { id: load.id },
    data: {
      truckId,
      driverId: input.driver ?? driverId,
      operationalStatus: 'POD_RECEIVED',
    },
  })
  // THE POD EVENT IS WHAT PUTS A TRIP IN A WEEK (MONEY-DESIGN §0), so it is
  // written rather than implied by the status.
  await owner.loadStatusEvent.create({
    data: {
      organizationId,
      loadId: load.id,
      axis: 'OPERATIONAL',
      toStatus: 'POD_RECEIVED',
      outcome: 'APPLIED',
      occurredAt: new Date(week.start.getTime() + 3 * 86_400_000),
    },
  })
  return load.id
}

const grossOf = (batchId: string) =>
  owner.settlement
    .aggregate({ where: { batchId }, _sum: { grossCents: true } })
    .then((row) => row._sum.grossCents ?? 0)

describe('the trips left ticked sum to the batch gross', () => {
  it('to the cent, with one trip unticked on the way in', async () => {
    const keep = [await trip({ cents: 120_000 }), await trip({ cents: 95_050 })]
    const drop = await trip({ cents: 77_077 })

    const opened = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period: WEEK,
        statementDate: WEEK.end,
        companyId,
        excludeLoadIds: [drop],
        excludedByUserId: userId,
      }),
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    // THE TWO NUMBERS, SIDE BY SIDE. This is the only place they meet.
    expect(await grossOf(opened.batchId)).toBe(120_000 + 95_050)

    // AND THE UNTICKED TRIP IS ON NOBODY'S STATEMENT — asserted separately,
    // because a gross that happened to match while the trip was also settled
    // would be the worse bug.
    const lines = await owner.settlementLoadLine.count({
      where: { loadId: drop },
    })
    expect(lines).toBe(0)
    expect(await excludedLoadIds(owner, opened.batchId)).toEqual([drop])
    void keep
  })

  it('and a named authority settles only its own freight', async () => {
    // THE WEEK IS NAMED ON BOTH TRIPS. Without it they default to the module's
    // week, the batch under test comes out EMPTY, and `not.toContain` passes
    // against nothing — which is what `watch-guard` caught: breaking the company
    // on the batch did not fail this test.
    const week = weekOf(new Date(Date.UTC(2026, 6, 15)))
    const mine = await trip({ cents: 50_000, week })
    const theirs = await trip({
      cents: 60_000,
      company: otherCompanyId,
      driver: otherDriverId,
      week,
    })

    const opened = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period: week,
        statementDate: new Date(Date.UTC(2026, 6, 21)),
        companyId,
      }),
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const settled = await owner.settlementLoadLine.findMany({
      where: { settlement: { batchId: opened.batchId } },
      select: { loadId: true },
    })
    const ids = settled.map((row) => row.loadId)
    // BOTH DIRECTIONS, AND THE ORDER OF THESE TWO LINES IS THE LESSON. Asserting
    // only the absence passes against an empty batch; asserting the presence
    // first is what makes the absence mean "scoped" rather than "nothing came
    // back". Both trips are in the same week, both settleable, both with rules
    // in force, and they differ only by authority.
    expect(ids).toContain(mine)
    expect(ids).not.toContain(theirs)
  })
})

describe('an exclusion is monotonic', () => {
  it('a refresh adds new freight and never un-excludes', async () => {
    const week = weekOf(new Date(Date.UTC(2026, 6, 22)))
    const first = await trip({ cents: 30_000, week })
    void first

    const opened = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period: week,
        statementDate: new Date(Date.UTC(2026, 6, 28)),
        companyId,
      }),
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const batchId = opened.batchId

    // THE OFFICE DECLINES ONE TRIP.
    const declined = await trip({ cents: 44_000, week })
    await inOrg((tx) =>
      excludeTrips(tx, {
        batchId,
        loadIds: [declined],
        byUserId: userId,
        reason: 'paid next week',
      }),
    )
    const after = await grossOf(batchId)

    // THEN NEW FREIGHT ARRIVES AND SOMEBODY REFRESHES.
    const late = await trip({ cents: 11_000, week })
    await inOrg((tx) => refreshDraft(tx, batchId))

    // THE LATE TRIP IS IN — that is the add half.
    const gross = await grossOf(batchId)
    expect(gross).toBe(after + 11_000)

    // AND THE DECLINED TRIP IS STILL OUT — that is the half a picked set loses.
    expect(await excludedLoadIds(owner, batchId)).toEqual([declined])
    const lines = await owner.settlementLoadLine.count({
      where: { loadId: declined },
    })
    expect(lines).toBe(0)
    void late
  })

  it('and the office can change its mind, which is the only way back in', async () => {
    const week = weekOf(new Date(Date.UTC(2026, 6, 29)))
    const kept = await trip({ cents: 25_000, week })
    const declined = await trip({ cents: 65_000, week })

    const opened = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period: week,
        statementDate: new Date(Date.UTC(2026, 7, 4)),
        companyId,
        excludeLoadIds: [declined],
        excludedByUserId: userId,
      }),
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    expect(await grossOf(opened.batchId)).toBe(25_000)

    // "SELECT ALL AVAILABLE" IS THIS CALL WITH NO IDS.
    await inOrg((tx) => includeTrips(tx, { batchId: opened.batchId }))

    expect(await grossOf(opened.batchId)).toBe(25_000 + 65_000)
    expect(await excludedLoadIds(owner, opened.batchId)).toEqual([])
    void kept
  })

  it('and a FINAL batch refuses both verbs, because it is a document', async () => {
    const week = weekOf(new Date(Date.UTC(2026, 7, 5)))
    const one = await trip({ cents: 15_000, week })
    const opened = await inOrg((tx) =>
      openBatch(tx, {
        organizationId,
        period: week,
        statementDate: new Date(Date.UTC(2026, 7, 11)),
        companyId,
      }),
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await owner.settlementBatch.update({
      where: { id: opened.batchId },
      data: { status: 'FINAL' },
    })

    const out = await inOrg((tx) =>
      excludeTrips(tx, {
        batchId: opened.batchId,
        loadIds: [one],
        byUserId: userId,
      }),
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason.kind).toBe('not_draft')

    const back = await inOrg((tx) =>
      includeTrips(tx, { batchId: opened.batchId }),
    )
    expect(back.ok).toBe(false)
  })
})
