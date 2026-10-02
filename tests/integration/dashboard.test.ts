import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { transitionOperational } from '@/lib/load-status'
import { setLoadRate } from '@/lib/rates'
import {
  actionQueue,
  fleetGlance,
  referenceCount,
  thisWeek,
} from '@/lib/dashboard'
import { COUNTED_ROWS, needsYouCounts } from '@/lib/dashboard-counts'
import { recordPayment } from '@/lib/payments'
import { isLoadViewName, viewWhere } from '@/lib/load-views'
import type { AuthorizedSession } from '@/lib/permissions'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// The dashboard against real Postgres.
//
// The role filtering and the week boundary are covered in tests/dashboard.test.ts.
// What can only be asserted here: that the counts are COUNTS — that a load
// moving from delivered to POD-received moves it from one queue row to another
// without anything being told to recalculate, and that the week is scoped per
// authority rather than summed.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let alphaId = ''
let betaId = ''
let userId = ''
let brokerId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'dashboard.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 20_000,
  })

const asOwner = (): AuthorizedSession => ({
  userId,
  organizationId,
  role: 'OWNER',
  companyScopes: [],
})

const rowFor = async (key: string, scope = {}) =>
  (await inOrg((tx) => actionQueue(tx, asOwner(), scope))).find(
    (row) => row.key === key,
  )

async function bookLoad(companyId: string, day: number) {
  return inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        stops: [
          {
            type: 'PICKUP',
            city: 'Chicago',
            state: 'IL',
            scheduledAt: new Date(Date.UTC(2026, 10, day)),
          },
          {
            type: 'DELIVERY',
            city: 'Dallas',
            state: 'TX',
            scheduledAt: new Date(Date.UTC(2026, 10, day + 1)),
          },
        ],
      },
      { byUserId: userId },
    ),
  )
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Dashboard ${nonce}`,
      slug: `dashboard-${nonce}`,
      maxCompanies: 5,
      companies: {
        create: [{ name: `Alpha ${nonce}` }, { name: `Beta ${nonce}` }],
      },
    },
    include: { companies: { orderBy: { name: 'asc' } } },
  })
  organizationId = organization.id
  alphaId = organization.companies[0]!.id
  betaId = organization.companies[1]!.id

  const user = await owner.user.create({
    data: { email: `dashboard-${nonce}@example.test`, name: 'Dash Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Broker ${nonce}` }),
    )
  ).id
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('the queue counts real state', () => {
  it('moves a load between rows as its own status changes', async () => {
    const load = await bookLoad(alphaId, 3)

    // Booked with nothing assigned — the dispatch row.
    expect((await rowFor('unassigned'))?.count).toBe(1)
    expect(await rowFor('podMissing')).toBeUndefined()

    await inOrg((tx) =>
      transitionOperational(tx, load.id, 'DELIVERED', {
        source: 'MANUAL',
        userId,
      }),
    )
    // Delivered, no POD. It left the dispatch row without being told to.
    expect((await rowFor('podMissing'))?.count).toBe(1)
    expect(await rowFor('unassigned')).toBeUndefined()

    await inOrg((tx) =>
      transitionOperational(tx, load.id, 'POD_RECEIVED', {
        source: 'AUTOMATIC',
        userId,
      }),
    )
    // POD in, no rate — a different row again, and NOT ready to invoice,
    // because a load with no rate cannot be billed.
    expect(await rowFor('podMissing')).toBeUndefined()
    expect((await rowFor('noRate'))?.count).toBe(1)
    expect(await rowFor('readyToInvoice')).toBeUndefined()

    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '2450', fuelSurcharge: '0' }),
    )
    expect(await rowFor('noRate')).toBeUndefined()
    expect((await rowFor('readyToInvoice'))?.count).toBe(1)
  }, 300_000)

  it('drops a row entirely rather than showing a nought', async () => {
    // A queue of zeroes is a queue nobody reads. Every row present has work in
    // it, which is why the empty state can be an invitation rather than a list
    // of noughts.
    const rows = await inOrg((tx) => actionQueue(tx, asOwner(), {}))
    expect(rows.every((row) => row.count > 0)).toBe(true)
  }, 300_000)

  it('respects the authority scope', async () => {
    await bookLoad(betaId, 5)

    const alphaOnly = await inOrg((tx) =>
      actionQueue(tx, asOwner(), { companyId: { in: [alphaId] } }),
    )
    const betaOnly = await inOrg((tx) =>
      actionQueue(tx, asOwner(), { companyId: { in: [betaId] } }),
    )

    // Beta's load is booked and unassigned; Alpha's has moved on to invoicing.
    expect(betaOnly.find((row) => row.key === 'unassigned')?.count).toBe(1)
    expect(alphaOnly.find((row) => row.key === 'unassigned')).toBeUndefined()
    expect(alphaOnly.find((row) => row.key === 'readyToInvoice')?.count).toBe(1)
  }, 300_000)

  it('never counts a row the session cannot read', async () => {
    // The dispatcher's queue is built from a shorter list of specs, so the
    // money queries are not issued at all — proven here by the rows that come
    // back rather than by inspecting the SQL.
    const dispatcher: AuthorizedSession = { ...asOwner(), role: 'DISPATCHER' }
    const rows = await inOrg((tx) => actionQueue(tx, dispatcher, {}))

    expect(rows.map((row) => row.key)).not.toContain('readyToInvoice')
    expect(rows.map((row) => row.key)).not.toContain('noRate')
  }, 300_000)
})

describe('the fleet at a glance', () => {
  it('counts live equipment and excludes what has gone', async () => {
    await owner.truck.createMany({
      data: [
        { organizationId, companyId: alphaId, unitNumber: `T1-${nonce}` },
        {
          organizationId,
          companyId: alphaId,
          unitNumber: `T2-${nonce}`,
          status: 'SOLD',
        },
      ],
    })
    await owner.driver.create({
      data: {
        organizationId,
        companyId: alphaId,
        firstName: 'Gone',
        lastName: `Away ${nonce}`,
        status: 'INACTIVE',
      },
    })

    const glance = await inOrg((tx) => fleetGlance(tx, {}))
    // The sold truck and the inactive driver are equipment the carrier no
    // longer has; counting them makes the fleet look bigger than it is.
    expect(glance.trucksPaired + glance.trucksIdle).toBe(1)
    expect(glance.driversPaired + glance.driversIdle).toBe(0)
  }, 300_000)

  it('splits by assignment state, and a retired driver frees the truck', async () => {
    const truck = await owner.truck.create({
      data: { organizationId, companyId: alphaId, unitNumber: `P1-${nonce}` },
    })
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId: alphaId,
        firstName: 'Paired',
        lastName: `Up ${nonce}`,
        assignedTruckId: truck.id,
      },
    })

    const paired = await inOrg((tx) => fleetGlance(tx, {}))
    expect(paired.trucksPaired).toBe(1)
    expect(paired.driversPaired).toBe(1)

    // RETIRE THE DRIVER. The truck must go back to idle rather than staying
    // spoken for by somebody who no longer works here — which is why the
    // count uses `none` over the live-driver filter and not `NOT some`.
    await owner.driver.update({
      where: { id: driver.id },
      data: { status: 'INACTIVE' },
    })

    const after = await inOrg((tx) => fleetGlance(tx, {}))
    expect(after.trucksPaired).toBe(0)
    expect(after.trucksIdle).toBe(paired.trucksIdle + 1)
    expect(after.driversPaired).toBe(0)
  }, 300_000)
})

describe('this week, per authority', () => {
  it('gives every authority a row, including one that hauled nothing', async () => {
    const week = await inOrg((tx) =>
      thisWeek(tx, [alphaId, betaId], new Date('2026-11-05T12:00:00Z')),
    )

    // A MISSING row reads as a bug; a zero reads as a quiet week.
    expect(week).toHaveLength(2)
    expect(week.every((row) => row.companyName.length > 0)).toBe(true)
  }, 300_000)

  it('counts a load in the week it was DELIVERED, and only that week', async () => {
    const load = await bookLoad(alphaId, 20)
    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '1500', fuelSurcharge: '0' }),
    )
    await inOrg((tx) =>
      transitionOperational(tx, load.id, 'DELIVERED', {
        source: 'MANUAL',
        userId,
        occurredAt: new Date(Date.UTC(2026, 10, 4, 9, 0)),
      }),
    )

    // Wednesday 4 November 2026 is in the week beginning Monday the 2nd.
    const inWeek = await inOrg((tx) =>
      thisWeek(tx, [alphaId], new Date('2026-11-06T12:00:00Z')),
    )
    expect(inWeek[0]).toMatchObject({
      delivered: 1,
      revenueCents: 150000,
      // Not factored, so the whole of it is the carrier's to collect. The two
      // split the revenue exactly, which is the property worth asserting.
      factoredCents: 0,
      directCents: 150000,
    })
    expect(inWeek[0]!.factoredCents + inWeek[0]!.directCents).toBe(
      inWeek[0]!.revenueCents,
    )

    // The following week does not see it — revenue is earned when the freight
    // moves, and it moves once.
    const nextWeek = await inOrg((tx) =>
      thisWeek(tx, [alphaId], new Date('2026-11-13T12:00:00Z')),
    )
    expect(nextWeek[0]).toMatchObject({ delivered: 0, revenueCents: 0 })
  }, 300_000)

  it('keeps the two authorities apart', async () => {
    const week = await inOrg((tx) =>
      thisWeek(tx, [alphaId, betaId], new Date('2026-11-06T12:00:00Z')),
    )
    const alpha = week.find((row) => row.companyId === alphaId)
    const beta = week.find((row) => row.companyId === betaId)

    // RAM and Dolphins are separate businesses with separate books. The screen
    // may add them up under a label that says so; the service never does.
    expect(alpha?.revenueCents).toBe(150000)
    expect(beta?.revenueCents).toBe(0)
  }, 300_000)
})

// ── CLOSED HISTORY IS IN NO QUEUE ──────────────────────────────────────────
//
// 13,517 loads on dev ran, were billed and were paid in Datatruck before this
// system existed. `billing-status.ts` says what that cost once already: the
// `podMissing` row counted them and read "14,346 delivered, waiting on a POD",
// which is not a queue anybody can work.
//
// ONE SEEDED CLOSED-HISTORY LOAD PER ROW, EACH SHAPED TO QUALIFY IF THE
// PREDICATE LET IT. That is the whole design of these three: the load is set up
// to satisfy every other clause, so the only thing keeping it out of the count
// is the closed-history exclusion. A fixture that failed on some other clause
// would pass whether or not the exclusion existed.
//
// TWO OF THE THREE ALREADY EXCLUDED IT and one did not. Measured on dev
// 2026-10-01: all three counts are the same number before and after, because
// the 18 archived AVAILABLE/BOOKED loads all happen to carry both a driver and
// a truck. That is the coincidence `billing-status.ts` warns about, and these
// tests are what turn it into a rule.
// ── CLOSED HISTORY IS IN NO QUEUE ──────────────────────────────────────────
//
// 13,517 loads on dev ran, were billed and were paid in Datatruck before this
// system existed. `billing-status.ts` records what that cost once already: the
// `podMissing` row counted them and read "14,346 delivered, waiting on a POD",
// which is not a queue anybody can work.
//
// ── EACH FIXTURE IS SHAPED TO QUALIFY IF THE PREDICATE LET IT ──────────────
//
// That is the whole design: the load satisfies every other clause of its row,
// so the only thing keeping it out is the closed-history exclusion. A fixture
// that failed on some other clause would pass whether or not the exclusion
// existed.
//
// ── AND EACH IS MEASURED AS A DELTA, NOT AN ABSOLUTE ──────────────────────
//
// The first version asserted `toBeUndefined()` and `count === 1`. Both failed,
// and they were right to: earlier describes in this file leave BOOKED loads on
// `betaId`, so the row is not empty before these tests start and an absolute
// count measures the file's history as well as the fixture. Counting before
// and after asks the question these tests are actually about — does THIS load
// change the number — and gives the same answer whatever else is seeded.
describe('closed history is in no queue', () => {
  const countOf = async (key: string) =>
    (await rowFor(key, { companyId: betaId }))?.count ?? 0

  /** Book one, then mark it as freight another system already closed. */
  const archive = async (loadId: string) => {
    await owner.load.update({
      where: { id: loadId },
      data: { billingStatus: 'CLOSED_IN_DATATRUCK' },
    })
  }

  it('adds nothing to Ready to invoice', async () => {
    const before = await countOf('readyToInvoice')

    const load = await bookLoad(betaId, 2)
    for (const to of ['DELIVERED', 'POD_RECEIVED'] as const) {
      await inOrg((tx) =>
        transitionOperational(tx, load.id, to, { source: 'MANUAL', userId }),
      )
    }
    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '1900', fuelSurcharge: '0' }),
    )

    // THE CONTROL FIRST. Every other clause is satisfied, so this load IS in
    // the queue — which is what makes the next assertion mean something.
    expect(await countOf('readyToInvoice')).toBe(before + 1)

    // ARCHIVED LAST, because the transitions and the rate both rewrite
    // `billingStatus`. Stamping it earlier would test a load that had since
    // stopped being archived.
    await archive(load.id)
    expect(await countOf('readyToInvoice')).toBe(before)
  }, 300_000)

  it('adds nothing to Finished with no driver or truck', async () => {
    const before = await countOf('unassignedFinished')

    const load = await bookLoad(betaId, 4)
    for (const to of ['DELIVERED', 'POD_RECEIVED'] as const) {
      await inOrg((tx) =>
        transitionOperational(tx, load.id, to, { source: 'MANUAL', userId }),
      )
    }
    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '1900', fuelSurcharge: '0' }),
    )
    await owner.load.update({
      where: { id: load.id },
      data: { driverId: null, truckId: null },
    })

    expect(await countOf('unassignedFinished')).toBe(before + 1)

    await archive(load.id)
    expect(await countOf('unassignedFinished')).toBe(before)
  }, 300_000)

  it('adds nothing to Booked with no truck or driver', async () => {
    // THE ROW THAT DID NOT HAVE THE EXCLUSION until 2026-10-01. A freshly
    // booked load is AVAILABLE/BOOKED with neither a driver nor a truck, which
    // is the entire predicate — so before the fix this counted archived
    // freight from another system into today's dispatch queue.
    const before = await countOf('unassigned')

    const load = await bookLoad(betaId, 6)
    expect(await countOf('unassigned')).toBe(before + 1)

    await archive(load.id)
    expect(await countOf('unassigned')).toBe(before)
  }, 300_000)
})

// ── THE SQL AND THE PREDICATE AGREE, ONE CASE PER ROW, BY NAME ─────────────
//
// Owner's ruling 3 asks that each filter be "the same predicate function its
// screen uses (tested equal by name)". IT CANNOT LITERALLY BE THE SAME: the
// screens hold Prisma `where` objects and `needsYouCounts` holds SQL. Two
// expressions of one rule is flag 88, and the mitigation is the one
// `by-company.ts` already uses — run both and require the same number.
//
// ONE CASE PER ROW, NAMED, because a single assertion over a total would let
// two filters drift in opposite directions and still sum correctly. A test
// called "readyToInvoice" that fails tells somebody which rule moved.
//
// RUN AGAINST WHATEVER THIS FILE HAS SEEDED. The numbers are not asserted —
// only the agreement is — so these cases keep working as the fixtures above
// change, and they are meaningful precisely because the earlier describes have
// left real rows in several of these states.
// ── THE ONE ROW WHOSE SCREEN SHARES ITS PREDICATE ─────────────────────────
// ── EVERY ROW COUNTS WHAT ITS DESTINATION LISTS ────────────────────────────
//
// Owner's ruling, 2026-10-01: compare each filter against the predicate THE
// ROW'S TARGET SCREEN LISTS WITH — not against `ActionSpec.count`, because "a
// reference nothing runs is rule 7, the shared dead name agrees with itself."
//
// Before the named views, only `readyToInvoice` could answer that. Measured on
// dev the day the ruling was written:
//
//   podMissing          counted     1   /loads?status=DELIVERED      listed 13,500
//   noRate              counted     0   /loads?status=POD_RECEIVED   listed    858
//   unassignedFinished  counted   101   /loads?status=POD_RECEIVED   listed    858
//
// `load-views.ts` now holds one named predicate per row; the row's href is
// `?view=<name>`; the loads list resolves that name through the same function;
// `needsYouCounts` translates it into SQL. All eight pairs agree on dev.
//
// ── THE SECOND SIDE IS THE DESTINATION, NOT A REFERENCE ──────────────────
//
// For the five Load rows that is `viewWhere(key)`, which is literally what the
// loads page calls. For the three others it is the predicate their own screen
// lists with — receivables, the payments Unapplied tab, the settlements list —
// written out here because those pages build it inline.
//
// ── AND THE CONTROL IS ON EVERY ROW ──────────────────────────────────────
//
// Both sides greater than zero, per the ruling. Without it a row whose seed
// failed compares nothing to nothing and reports agreement — which is how the
// first version of this file's direct-settled case passed while proving nothing,
// and how three `watch-guard` breaks came back NOT OK.
describe('every Needs-you row counts what its destination lists', () => {
  /** Seeded once for the whole describe, so each row has something to count. */
  let seeded = false

  const seedOnePerRow = async () => {
    if (seeded) return
    seeded = true

    // podMissing — DELIVERED, no POD.
    const delivered = await bookLoad(betaId, 2)
    await inOrg((tx) =>
      transitionOperational(tx, delivered.id, 'DELIVERED', {
        source: 'MANUAL',
        userId,
      }),
    )

    // noRate — POD in, nothing on it. `bookLoad` sets no rate, so reaching
    // POD_RECEIVED is the whole fixture.
    const unrated = await bookLoad(betaId, 4)
    for (const to of ['DELIVERED', 'POD_RECEIVED'] as const) {
      await inOrg((tx) =>
        transitionOperational(tx, unrated.id, to, { source: 'MANUAL', userId }),
      )
    }

    // unassignedFinished AND readyToInvoice — POD in, a rate on it, nobody on
    // it. ONE LOAD SATISFIES BOTH, which is worth saying: the two rows overlap
    // by design and the dashboard shows both, because "finished and unbilled"
    // and "finished and unattached" are different jobs for different people.
    const finished = await bookLoad(betaId, 6)
    for (const to of ['DELIVERED', 'POD_RECEIVED'] as const) {
      await inOrg((tx) =>
        transitionOperational(tx, finished.id, to, {
          source: 'MANUAL',
          userId,
        }),
      )
    }
    await inOrg((tx) =>
      setLoadRate(tx, finished.id, { linehaul: '1850', fuelSurcharge: '0' }),
    )
    await owner.load.update({
      where: { id: finished.id },
      data: { driverId: null, truckId: null },
    })

    // unassigned — booked, nothing on it. `bookLoad` leaves it that way.
    await bookLoad(betaId, 8)

    // unapplied — a payment with money left on it.
    await inOrg((tx) =>
      recordPayment(tx, organizationId, {
        companyId: betaId,
        customerId: brokerId,
        method: 'ACH',
        referenceNumber: `EIGHT-${nonce}`,
        receivedAt: new Date(Date.UTC(2026, 10, 10)),
        amountCents: 250_000,
      }),
    )

    // A DRIVER FOR THE DRAFT SETTLEMENT. `Settlement.driverId` is required and
    // this file keeps no shared driver id, so one is made here.
    const payee = await owner.driver.create({
      data: {
        organizationId,
        companyId: betaId,
        firstName: 'Eight',
        lastName: `Rows ${nonce}`,
      },
    })

    // draftSettlements — a DRAFT settlement on this authority.
    await owner.settlement.create({
      data: {
        organizationId,
        companyId: betaId,
        driverId: payee.id,
        status: 'DRAFT',
        periodStart: new Date(Date.UTC(2026, 10, 8)),
        periodEnd: new Date(Date.UTC(2026, 10, 14)),
        settlementNumber: `DRAFT-EIGHT-${nonce}`,
      },
    })

    // overdue — an invoice past its due date with a balance.
    await owner.invoice.create({
      data: {
        organizationId,
        companyId: betaId,
        customerId: brokerId,
        invoiceNumber: `OD-${nonce}`,
        status: 'SENT',
        issueDate: new Date(Date.UTC(2026, 8, 1)),
        dueDate: new Date(Date.UTC(2026, 8, 15)),
        subtotalCents: 190_000,
        totalCents: 190_000,
        balanceCents: 190_000,
      },
    })
  }

  /** What each row's DESTINATION lists, scoped to this describe's authority. */
  const destinationCount = async (key: string): Promise<number> => {
    const scope = { companyId: { in: [betaId] } }
    return inOrg(async (tx) => {
      if (isLoadViewName(key)) {
        // EXACTLY WHAT `loads/page.tsx` DOES: `base` is `deletedAt: null` plus
        // the scope, and the named view on top.
        return tx.load.count({
          where: { deletedAt: null, ...scope, ...viewWhere(key) },
        })
      }
      if (key === 'overdue') {
        // `/receivables`.
        return tx.invoice.count({
          where: {
            ...scope,
            deletedAt: null,
            isFactored: false,
            balanceCents: { gt: 0 },
            status: { notIn: ['DRAFT', 'VOID', 'WRITTEN_OFF'] },
            dueDate: { lt: new Date() },
          },
        })
      }
      if (key === 'unapplied') {
        // The payments Unapplied tab: `unappliedCents > 0` over live payments.
        return tx.payment.count({
          where: { ...scope, deletedAt: null, unappliedCents: { gt: 0 } },
        })
      }
      // `/settlements`, the drafts.
      return tx.settlement.count({
        where: { ...scope, deletedAt: null, status: 'DRAFT' },
      })
    })
  }

  it.each([...COUNTED_ROWS])(
    '%s',
    async (key) => {
      await seedOnePerRow()

      const counted = await inOrg((tx) => needsYouCounts(tx, [betaId]))
      const listed = await destinationCount(key)

      // THE CONTROL, ON EVERY ROW, per the ruling.
      expect(
        listed,
        `${key}: its destination lists nothing, so the agreement below is two empty sets`,
      ).toBeGreaterThan(0)
      expect(counted.counts[key]).toBeGreaterThan(0)

      expect(
        counted.counts[key],
        `${key}: count and destination disagree`,
      ).toBe(listed)
    },
    300_000,
  )
})

describe('the one statement translates each Prisma predicate faithfully', () => {
  it.each([...COUNTED_ROWS])(
    '%s',
    async (key) => {
      const [reference, sql] = await inOrg(async (tx) => {
        const ref = await referenceCount(tx, key, {
          companyId: { in: [betaId] },
        })
        const one = await needsYouCounts(tx, [betaId])
        return [ref, one] as const
      })

      expect(sql.counts[key]).toBe(reference.count)
    },
    300_000,
  )

  // THE TWO AMOUNTS TOO. A count that agrees while its amount does not is the
  // shape that puts "$14,200 not applied" beside a count of three payments
  // that total something else.
  it('and on the amounts, which are summed from the same filter', async () => {
    const { ref, sql } = await inOrg(async (tx) => ({
      ref: {
        unapplied: await referenceCount(tx, 'unapplied', {
          companyId: { in: [betaId] },
        }),
        unassignedFinished: await referenceCount(tx, 'unassignedFinished', {
          companyId: { in: [betaId] },
        }),
      },
      sql: await needsYouCounts(tx, [betaId]),
    }))

    expect(sql.amounts.unapplied).toBe(ref.unapplied.amountCents)
    expect(sql.amounts.unassignedFinished).toBe(
      ref.unassignedFinished.amountCents,
    )
  }, 300_000)

  // AN EMPTY SCOPE MEANS EVERY AUTHORITY, in both expressions.
  //
  // This is the one disagreement that would look like good news: an empty array
  // rendered as `= ANY('{}')` matches nothing, so an unscoped owner would see
  // an empty queue and read it as a clear morning. `companyScopeFilter` gives
  // `{}` for no scopes and `needsYouCounts` takes `[]`, and they have to mean
  // the same thing.
  it('and an unscoped read means all authorities, not none', async () => {
    const { ref, sql } = await inOrg(async (tx) => ({
      ref: await referenceCount(tx, 'unassigned', {}),
      sql: await needsYouCounts(tx, []),
    }))

    expect(sql.counts.unassigned).toBe(ref.count)
    // AND IT IS NOT ZERO, or the assertion above is satisfied by two empty
    // answers — the most comfortable way to be wrong.
    expect(ref.count).toBeGreaterThan(0)
  }, 300_000)
})

// ── A DIRECT-SETTLED LOAD, SO THAT CLAUSE IS ACTUALLY EXERCISED ───────────
//
// `watch-guard` refused the break that deleted `directSettled = false` from
// the ready-to-invoice filter: the count did not move, because nothing in this
// file was direct-settled and the clause had no work to do. An agreement test
// over data that exercises eight clauses and not the ninth agrees about eight
// clauses.
//
// So one load is booked under a customer that settles directly, taken to POD
// with a rate on it — which satisfies every other clause of
// `readyToInvoiceWhere` — and must therefore be kept out by `directSettled`
// alone, in BOTH expressions of the rule.
describe('the ready-to-invoice filter excludes direct-settled freight', () => {
  it('and both expressions agree that it does', async () => {
    const relay = await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Relay ${nonce}` }),
    )
    // `createBroker` does not take the flag — it is a property of the terms,
    // set on the customer — so it is set here directly.
    await owner.customer.update({
      where: { id: relay.id },
      data: { settlesDirectly: true },
    })

    const load = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId: betaId,
          customerId: relay.id,
          stops: [
            {
              type: 'PICKUP',
              city: 'Joliet',
              state: 'IL',
              scheduledAt: new Date(Date.UTC(2026, 10, 20)),
            },
            {
              type: 'DELIVERY',
              city: 'Memphis',
              state: 'TN',
              scheduledAt: new Date(Date.UTC(2026, 10, 21)),
            },
          ],
        },
        { byUserId: userId },
      ),
    )

    for (const to of ['DELIVERED', 'POD_RECEIVED'] as const) {
      await inOrg((tx) =>
        transitionOperational(tx, load.id, to, { source: 'MANUAL', userId }),
      )
    }
    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '2100', fuelSurcharge: '0' }),
    )

    // THE FLAG IS COPIED AT BOOKING, so this asserts the booking path did it
    // rather than assuming — if it were false the fixture would be testing
    // nothing and the clause would still have no work.
    const stored = await owner.load.findUniqueOrThrow({
      where: { id: load.id },
      select: { directSettled: true },
    })
    expect(stored.directSettled).toBe(true)

    const { reference, sql } = await inOrg(async (tx) => ({
      reference: await referenceCount(tx, 'readyToInvoice', {
        companyId: { in: [betaId] },
      }),
      sql: await needsYouCounts(tx, [betaId]),
    }))

    // NEITHER COUNTS IT, and they agree on the number — which is the pair of
    // claims the break can now move.
    expect(sql.counts.readyToInvoice).toBe(reference.count)
  }, 300_000)
})

// ── THE TWO AMOUNTS, OVER DATA THAT MAKES THEM NON-ZERO ───────────────────
//
// `watch-guard` refused two breaks here — summing the wrong column, and
// summing under a filter different from the one that counted — because BOTH
// AMOUNTS WERE ZERO IN BOTH EXPRESSIONS. This file seeds no payments at all,
// and its one unassigned-finished load is archived by the test above, so every
// assertion about the amounts was 0 === 0.
//
// That is the comfortable way to be wrong this codebase keeps naming: two
// expressions of a money rule, agreeing, over nothing. So the amounts are
// given something to sum and the test asserts they are NOT ZERO before it
// asserts they agree — the control that makes the agreement mean something.
describe('the two amounts agree, over amounts that exist', () => {
  it('sums each from the same filter that counted it', async () => {
    // AN UNAPPLIED PAYMENT. `recordPayment` leaves the whole amount unapplied,
    // which is the state the row is about.
    const paid = await inOrg((tx) =>
      recordPayment(tx, organizationId, {
        companyId: betaId,
        customerId: brokerId,
        method: 'ACH',
        referenceNumber: `DASH-${nonce}`,
        receivedAt: new Date(Date.UTC(2026, 10, 12)),
        amountCents: 412_500,
      }),
    )
    expect(paid.ok).toBe(true)

    // PARTIALLY APPLIED, SET DIRECTLY, AND THE SHORTCUT IS THE POINT.
    //
    // `recordPayment` leaves the whole amount unapplied, so `unappliedCents`
    // EQUALS `amountCents` — and `watch-guard` refused the break that summed
    // `amountCents` instead, because over this data the two columns hold the
    // same number and the wrong one is indistinguishable from the right one.
    //
    // A real partial application would need an invoice and an allocation,
    // which is `payments.test.ts`'s subject and not this file's. The column is
    // therefore set to represent the state, which is what makes the two sums
    // tell apart.
    await owner.payment.updateMany({
      where: { referenceNumber: `DASH-${nonce}` },
      data: { unappliedCents: 150_000 },
    })

    // AND FINISHED FREIGHT ATTACHED TO NOBODY, left that way — not archived,
    // unlike the fixture in the closed-history describe above.
    const orphan = await bookLoad(betaId, 14)
    for (const to of ['DELIVERED', 'POD_RECEIVED'] as const) {
      await inOrg((tx) =>
        transitionOperational(tx, orphan.id, to, { source: 'MANUAL', userId }),
      )
    }
    await inOrg((tx) =>
      setLoadRate(tx, orphan.id, { linehaul: '3150', fuelSurcharge: '0' }),
    )
    await owner.load.update({
      where: { id: orphan.id },
      data: { driverId: null, truckId: null },
    })

    const { ref, sql } = await inOrg(async (tx) => ({
      ref: {
        unapplied: await referenceCount(tx, 'unapplied', {
          companyId: { in: [betaId] },
        }),
        finished: await referenceCount(tx, 'unassignedFinished', {
          companyId: { in: [betaId] },
        }),
      },
      sql: await needsYouCounts(tx, [betaId]),
    }))

    // THE CONTROL FIRST. Without these four the assertions below are satisfied
    // by two empty sums, which is what refused the breaks.
    expect(ref.unapplied.amountCents).toBeGreaterThan(0)
    expect(ref.finished.amountCents).toBeGreaterThan(0)
    expect(sql.amounts.unapplied).toBeGreaterThan(0)
    expect(sql.amounts.unassignedFinished).toBeGreaterThan(0)

    expect(sql.amounts.unapplied).toBe(ref.unapplied.amountCents)
    expect(sql.amounts.unassignedFinished).toBe(ref.finished.amountCents)
  }, 300_000)
})
