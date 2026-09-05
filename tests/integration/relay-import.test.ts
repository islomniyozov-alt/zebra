import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { parseRelayCsv } from '@/lib/relay-csv'
import {
  RELAY_CUSTOMER_NAME,
  ensureRelayCustomer,
  importRelayLoad,
  planRelayImport,
  planSignature,
  previewMoment,
} from '@/lib/relay-import'
import { RELAY_HEADER, relayRow } from '../fixtures/relay'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE RELAY IMPORT (Phase 6 §3a), against real Postgres.
//
// The assertions worth having are the ones a mapping cannot be reasoned into:
// that a delivered import really lands DELIVERED through the status engine
// rather than by a data write, that the money wall holds when the importer is
// a dispatcher, and that the same file imported twice warns rather than
// silently doubling the freight.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'relay-import.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const file = (...rows: string[]) => `﻿${RELAY_HEADER}\n${rows.join('\n')}\n`

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: { name: `Relay ${nonce}`, slug: `relay-${nonce}` },
  })
  organizationId = organization.id
  const company = await owner.company.create({
    data: { organizationId, name: `Relay Carrier ${nonce}` },
  })
  companyId = company.id
  const user = await owner.user.create({
    data: { email: `relay-${nonce}@example.test`, name: 'Relay Tester' },
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

/** Plan and write one file, end to end, the way the action does. */
async function importFile(
  csv: string,
  options: { maySeeMoney?: boolean } = {},
) {
  const trips = parseRelayCsv(csv)
  const plan = await inOrg((tx) =>
    planRelayImport(tx, { trips, maySeeMoney: options.maySeeMoney ?? true }),
  )
  const customer = await inOrg((tx) => ensureRelayCustomer(tx, organizationId))
  const written = []
  for (const planned of plan.create) {
    written.push(
      await inOrg((tx) =>
        importRelayLoad(tx, organizationId, planned, {
          companyId,
          customerId: customer.id,
          byUserId: userId,
        }),
      ),
    )
  }
  return { plan, written }
}

describe('importing upcoming trips as booked', () => {
  // A ROW THAT HAS NOT FINISHED, WHICH IS NOW THE ONLY WAY TO BOOK ONE.
  //
  // It used to pass `{ mode: 'booked' }` against a row whose own status said
  // Completed — asserting the radio's power to overrule Amazon about Amazon's
  // freight. That override is gone deliberately (see `landsDelivered`), so the
  // fixture states what the test is actually about: an unfinished trip books.
  it('books the load, with the window on every stop', async () => {
    const { plan, written } = await importFile(
      file(
        relayRow({
          loadId: `BOOK-${nonce}`,
          execution: 'In Progress',
          s2actArrDate: '',
          s2actArrTime: '',
          s2actDepDate: '',
          s2actDepTime: '',
        }),
      ),
    )

    expect(plan.skip).toHaveLength(0)
    expect(written).toHaveLength(1)

    const load = await inOrg((tx) =>
      tx.load.findFirstOrThrow({
        where: { id: written[0]!.id },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      }),
    )

    expect(load.operationalStatus).toBe('BOOKED')
    expect(load.referenceNumber).toBe(`BOOK-${nonce}`)
    expect(load.dispatchedMiles).toBe(241)
    expect(load.stops).toHaveLength(2)

    // THE WINDOW REACHED ITS COLUMNS, READ AS A WALL CLOCK IN THE STOP'S OWN
    // ZONE — flag 14, settled against the Relay portal.
    //
    // 23:30 at a facility whose offset column says −6 is 23:30 CDT, because
    // August is not standard time: 2026-08-12T04:30Z. The first version
    // subtracted the column and produced 05:30Z, an hour late, on every stop
    // of every summer import.
    const [first, second] = load.stops
    expect(first!.type).toBe('PICKUP')
    expect(first!.windowStart!.toISOString()).toBe('2026-08-12T04:30:00.000Z')
    // 00:01 the NEXT day, 31 minutes later — the departure's own date column.
    expect(first!.windowEnd!.toISOString()).toBe('2026-08-12T05:01:00.000Z')
    expect(first!.appointmentType).toBe('WINDOW')
    expect(second!.type).toBe('DELIVERY')
    // A −5 column is EASTERN, and in August Eastern is EDT: 06:31 EDT is
    // 10:31Z. Reading it as −5 would have given 11:31Z; reading it in the
    // fallback zone, as a stop with no address otherwise would, gives the
    // SAME 11:31Z — which is why the zone comes from the offset column's zone
    // family and not from the fallback.
    expect(second!.windowStart!.toISOString()).toBe('2026-08-12T10:31:00.000Z')

    // Booked, not run: the actual columns are in the file and are NOT written.
    expect(first!.arrivedAt).toBeNull()
    expect(first!.departedAt).toBeNull()
  })

  it('files the trip’s own facts instead of guessing at the fleet', async () => {
    const { written } = await importFile(
      file(relayRow({ loadId: `NOTE-${nonce}`, driver: 'Jane Roe' })),
    )
    const load = await inOrg((tx) =>
      tx.load.findFirstOrThrow({ where: { id: written[0]!.id } }),
    )

    // The driver is NAMED and not ASSIGNED. A name is not a Driver.id, and
    // two loads of one Relay trip overlap at the handoff — assigning would
    // hit Phase 4's conflict check and fail an import over freight that
    // really did run that way.
    expect(load.driverId).toBeNull()
    expect(load.truckId).toBeNull()
    expect(load.dispatcherNotes).toContain('Jane Roe')
    expect(load.dispatcherNotes).toContain('T-TESTTRIP1')
  })

  it('creates a facility per code, and reuses it the second time', async () => {
    const csv = file(
      relayRow({ loadId: `FAC1-${nonce}`, s1: `ZZ1-${nonce}` }),
      relayRow({ loadId: `FAC2-${nonce}`, s1: `ZZ1-${nonce}` }),
    )
    const { written } = await importFile(csv)
    expect(written).toHaveLength(2)

    const places = await inOrg((tx) =>
      tx.location.findMany({ where: { name: `ZZ1-${nonce}` } }),
    )
    expect(places).toHaveLength(1)
    // No address, because the export has none. That is the truth rather than
    // a town parsed out of a facility code.
    expect(places[0]!.city).toBeNull()
    expect(places[0]!.state).toBeNull()
    // THE ZONE IS RECORDED THOUGH, and it has to be: with no state and no
    // timezone, the load screen's `renderStopTime` falls back to the company
    // zone and renders a correctly-stored Eastern appointment an hour out.
    expect(places[0]!.timezone).toBe('America/Chicago')
  })
})

describe('importing finished trips as delivered', () => {
  it('lands DELIVERED through the status engine, with the actual times', async () => {
    const { written } = await importFile(
      file(relayRow({ loadId: `DONE-${nonce}` })),
    )

    const load = await inOrg((tx) =>
      tx.load.findFirstOrThrow({
        where: { id: written[0]!.id },
        include: {
          stops: { orderBy: { sequence: 'asc' } },
          statusEvents: { orderBy: { occurredAt: 'asc' } },
        },
      }),
    )

    // PAST DELIVERED, TO POD RECEIVED — and that is the 2026-09-03 ruling
    // reaching the board importer, not just the load-detail screen.
    //
    // The board importer creates its loads under Amazon Relay, which settles
    // directly (see "the money wall and the settlement terms" below), and a
    // direct-settled load carries its POD the moment it is delivered: drivers
    // upload into Relay, Amazon holds the signed paperwork, and nothing in
    // this application will ever receive a POD document for this freight.
    //
    // IT IS THE PAYABLE STATE, which is why this is the right answer rather
    // than an accident. `settleableWhere` selects on POD_RECEIVED; a load that
    // stopped at DELIVERED would be invisible to every settlement period, for
    // every driver, forever.
    expect(load.operationalStatus).toBe('POD_RECEIVED')

    // THROUGH THE ENGINE, which means the event log records it. A
    // `data: { operationalStatus }` write would leave a load that is
    // delivered with no history of becoming so.
    const delivered = load.statusEvents.find(
      (event) => event.toStatus === 'DELIVERED',
    )
    expect(delivered).toBeDefined()
    expect(delivered!.source).toBe('INTEGRATION')

    // AND THE POD BEHIND IT, on the log as its own event. §7: POD_RECEIVED is
    // never set by hand, and a status the log cannot explain is worse than one
    // the load never reached.
    const pod = load.statusEvents.find(
      (event) => event.toStatus === 'POD_RECEIVED',
    )
    expect(pod).toBeDefined()
    expect(pod!.source).toBe('AUTOMATIC')

    // The actuals are on the stops, and the PLAN is still there beside them —
    // a delivered load whose appointment was erased cannot be asked whether
    // it was late, which is the question a Relay scorecard turns on.
    const [first] = load.stops
    // 22:16 and 22:40 CDT on the 11th.
    expect(first!.arrivedAt!.toISOString()).toBe('2026-08-12T03:16:00.000Z')
    expect(first!.departedAt!.toISOString()).toBe('2026-08-12T03:40:00.000Z')
    expect(first!.windowStart).not.toBeNull()
  })

  it('imports a mixed file whole, each row landing where its status says', async () => {
    const csv = file(
      relayRow({ loadId: `MIX-A-${nonce}` }),
      relayRow({
        loadId: `MIX-B-${nonce}`,
        execution: 'In Progress',
        s2actArrDate: '',
        s2actArrTime: '',
        s2actDepDate: '',
        s2actDepTime: '',
      }),
    )
    const { plan } = await importFile(csv)

    // BOTH ROWS IMPORT, EACH LANDING WHERE ITS OWN STATUS SAYS. This is the
    // whole ruling in one assertion: a mixed file needs no question answered
    // about it, because every row already answers for itself.
    expect(plan.create.map((load) => load.loadId)).toEqual([
      `MIX-A-${nonce}`,
      `MIX-B-${nonce}`,
    ])
    expect(plan.create.map((load) => load.delivered)).toEqual([true, false])

    // AND NOTHING IS DROPPED. This test was named "skips a trip that has not
    // finished, and says which", and it passed: under a file-wide "Finished"
    // the unfinished row was SKIPPED. The office saw one load from a two-row
    // file and a skip reason it had to go and read. Choosing the other radio
    // dropped the other half instead. That silent truncation is what the
    // per-row reading removes, and this assertion is what would catch its
    // return.
    expect(plan.skip).toEqual([])
  })

  it('imports the same row as booked when it will not import as delivered', async () => {
    const csv = file(
      relayRow({
        loadId: `PROG-${nonce}`,
        execution: 'In Progress',
        s2actArrDate: '',
        s2actArrTime: '',
        s2actDepDate: '',
        s2actDepTime: '',
      }),
    )
    const { plan } = await importFile(csv)
    expect(plan.skip).toHaveLength(0)
    expect(plan.create).toHaveLength(1)
  })
})

describe('what the import refuses and what it warns about', () => {
  it('skips a row whose stop has times but no UTC offset', async () => {
    const { plan } = await importFile(
      file(relayRow({ loadId: `NOOFF-${nonce}`, s2offset: '' })),
    )
    expect(plan.create).toHaveLength(0)
    expect(plan.skip[0]!.reason).toBe('missing_offset')
  })

  it('skips a stop planned out before it is planned in', async () => {
    const { plan } = await importFile(
      file(
        relayRow({
          loadId: `INV-${nonce}`,
          s1planDepDate: '08/11/2026',
          s1planDepTime: '20:00',
        }),
      ),
    )
    // Caught in the PREVIEW rather than by `writeStops` after the confirm.
    expect(plan.skip[0]!.reason).toBe('window_inverted')
  })

  it('skips a Load ID repeated inside one file, keeping the first', async () => {
    const { plan } = await importFile(
      file(
        relayRow({ loadId: `TWICE-${nonce}` }),
        relayRow({ loadId: `TWICE-${nonce}`, s2: 'CCC3' }),
      ),
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.skip[0]!.reason).toBe('repeated_in_file')
  })

  it('warns by name when the file has already been imported', async () => {
    const csv = file(relayRow({ loadId: `AGAIN-${nonce}` }))
    const first = await importFile(csv)
    expect(first.plan.create[0]!.warnings).toHaveLength(0)

    const second = await importFile(csv)
    const warning = second.plan.create[0]!.warnings.find(
      (entry) => entry.kind === 'duplicate_reference',
    )
    expect(warning).toBeDefined()
    // NAMING THE RECORD IS THE WHOLE VALUE. "Duplicate" sends somebody
    // looking; the load number tells them whether this is the one they meant.
    expect(warning!.values['reference']).toBe(`AGAIN-${nonce}`)
    expect(warning!.values['load']).toBe(first.written[0]!.loadNumber)
    expect(warning!.values['customer']).toBe(RELAY_CUSTOMER_NAME)
  })

  it('changes its signature when a warning appears, so a confirm goes stale', async () => {
    const csv = file(relayRow({ loadId: `SIG-${nonce}` }))
    const trips = parseRelayCsv(csv)
    const before = await inOrg((tx) =>
      planRelayImport(tx, { trips, maySeeMoney: true }),
    )

    await importFile(csv)

    const after = await inOrg((tx) =>
      planRelayImport(tx, { trips, maySeeMoney: true }),
    )
    expect(planSignature(after)).not.toBe(planSignature(before))
  })
})

describe('the money wall and the settlement terms', () => {
  it('creates Amazon Relay settling directly, so its loads never invoice', async () => {
    const { written } = await importFile(
      file(relayRow({ loadId: `DIR-${nonce}` })),
    )
    const load = await inOrg((tx) =>
      tx.load.findFirstOrThrow({
        where: { id: written[0]!.id },
        include: { customer: true },
      }),
    )
    expect(load.customer.name).toBe(RELAY_CUSTOMER_NAME)
    expect(load.customer.settlesDirectly).toBe(true)
    // COPIED onto the load, not joined — the schema's own reasoning.
    expect(load.directSettled).toBe(true)
    expect(load.linehaulCents).toBe(47789)
  })

  // §1.3 — a DISPATCHER's screens carry no money at all, and the import is a
  // screen. The plan has no rate in it and the write must not invent one.
  it('books at no rate for a role that may not enter one', async () => {
    const { plan, written } = await importFile(
      file(relayRow({ loadId: `NOMONEY-${nonce}` })),
      { maySeeMoney: false },
    )
    expect(plan.create[0]!.costCents).toBeNull()

    const load = await inOrg((tx) =>
      tx.load.findFirstOrThrow({ where: { id: written[0]!.id } }),
    )
    expect(load.linehaulCents).toBe(0)
    expect(load.totalRevenueCents).toBe(0)
  })

  it('numbers imported loads from the authority’s own series', async () => {
    const { written } = await importFile(
      file(
        relayRow({ loadId: `SEQ-A-${nonce}` }),
        relayRow({ loadId: `SEQ-B-${nonce}` }),
      ),
    )
    const numbers = written.map((load) => Number(load.loadNumber))
    expect(numbers[1]).toBe(numbers[0]! + 1)
  })
})

describe('which zone a stop’s clocks are read in (flag 14)', () => {
  // SOURCE 2: the offset column names a zone FAMILY even though it cannot
  // convert a clock. −5 is Eastern, and in August Eastern is EDT.
  it('reads a −5 facility as Eastern, DST and all', async () => {
    const { written } = await importFile(
      file(
        relayRow({
          loadId: `TZE-${nonce}`,
          s1: `EAST-${nonce}`,
          s1offset: '-5',
          s1planArrDate: '08/11/2026',
          s1planArrTime: '23:30',
          s1planDepDate: '08/11/2026',
          s1planDepTime: '23:45',
        }),
      ),
    )
    const load = await inOrg((tx) =>
      tx.load.findFirstOrThrow({
        where: { id: written[0]!.id },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      }),
    )
    // 23:30 EDT is 03:30Z. Reading the column literally would give 04:30Z.
    expect(load.stops[0]!.windowStart!.toISOString()).toBe(
      '2026-08-12T03:30:00.000Z',
    )
  })

  // SOURCE 1: a dispatcher who has recorded where the dock actually is has
  // said something the file cannot, and it wins.
  it('lets a recorded facility timezone beat the offset column', async () => {
    await inOrg((tx) =>
      tx.location.create({
        data: {
          organizationId,
          name: `WEST-${nonce}`,
          timezone: 'America/Los_Angeles',
        },
      }),
    )

    const { plan, written } = await importFile(
      file(
        relayRow({
          loadId: `TZW-${nonce}`,
          s1: `WEST-${nonce}`,
          // The file still claims Eastern. The recorded facility says Pacific.
          s1offset: '-5',
          s1planArrDate: '08/11/2026',
          s1planArrTime: '09:00',
          s1planDepDate: '08/11/2026',
          s1planDepTime: '10:00',
        }),
      ),
    )

    const load = await inOrg((tx) =>
      tx.load.findFirstOrThrow({
        where: { id: written[0]!.id },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      }),
    )
    // 09:00 PDT is 16:00Z, not 13:00Z.
    expect(load.stops[0]!.windowStart!.toISOString()).toBe(
      '2026-08-11T16:00:00.000Z',
    )

    // AND THE CROSS-CHECK SAYS SO. Pacific was UTC−7 that day and the column
    // says −5: two hours apart, which DST cannot explain. The stop is being
    // read somewhere the file did not describe, and somebody is told.
    const warning = plan.create[0]!.warnings.find(
      (entry) => entry.kind === 'offset_disagrees',
    )
    expect(warning).toBeDefined()
    expect(warning!.values['facility']).toBe(`WEST-${nonce}`)
    expect(warning!.values['zone']).toBe('America/Los_Angeles')
    expect(warning!.values['column']).toBe('-5')
    expect(warning!.values['actual']).toBe('-7')
  })

  // The ordinary summer case: the column is standard time and the zone is on
  // DST, exactly one hour apart. That is the expected state of every row in
  // the corpus and must never produce a warning — a warning on every stop of
  // every file is a warning nobody reads.
  it('says nothing when the gap is the hour DST explains', async () => {
    const { plan } = await importFile(
      file(relayRow({ loadId: `TZQ-${nonce}` })),
    )
    expect(
      plan.create[0]!.warnings.filter(
        (entry) => entry.kind === 'offset_disagrees',
      ),
    ).toHaveLength(0)
  })

  // THE PORTAL'S OWN CLOCKS, which is what settled flag 14: the first stop
  // reads 23:30 CDT going in and the last reads 01:51 CDT two days later.
  // Round-tripping the stored instants back through the stop's zone must
  // reproduce those faces exactly.
  it('round-trips to the clock faces the Relay portal shows', async () => {
    const trips = parseRelayCsv(
      file(
        relayRow({
          loadId: `PORTAL-${nonce}`,
          // FACILITIES OF ITS OWN. The default row's `BBB2` is registered as
          // Eastern by an earlier test in this file, and a recorded zone beats
          // the offset column — which is source 1 working exactly as intended
          // and would quietly make this assertion about the wrong thing.
          s1: `PFOE-${nonce}`,
          s2: `PJAN-${nonce}`,
          s1offset: '-6',
          s1planArrDate: '08/11/2026',
          s1planArrTime: '23:30',
          s1planDepDate: '08/12/2026',
          s1planDepTime: '00:01',
          s2offset: '-6',
          s2planArrDate: '08/13/2026',
          s2planArrTime: '01:51',
          s2planDepDate: '08/13/2026',
          s2planDepTime: '02:22',
        }),
      ),
    )
    const plan = await inOrg((tx) =>
      planRelayImport(tx, { trips, maySeeMoney: true }),
    )
    const [first, last] = plan.create[0]!.stops
    expect(previewMoment(first!.scheduledAt, first!.zone)).toBe(
      'Aug 11, 23:30 CDT',
    )
    expect(previewMoment(last!.scheduledAt, last!.zone)).toBe(
      'Aug 13, 01:51 CDT',
    )
  })
})
