import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { parseRelayCsv } from '@/lib/relay-csv'
import {
  RELAY_CUSTOMER_NAME,
  ensureRelayCustomer,
  importRelayLoad,
  planRelayImport,
  planSignature,
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
    timeoutMs: 30_000,
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
  options: { mode: 'booked' | 'delivered'; maySeeMoney?: boolean },
) {
  const trips = parseRelayCsv(csv)
  const plan = await inOrg((tx) =>
    planRelayImport(tx, {
      trips,
      mode: options.mode,
      maySeeMoney: options.maySeeMoney ?? true,
    }),
  )
  const customer = await inOrg((tx) => ensureRelayCustomer(tx, organizationId))
  const written = []
  for (const planned of plan.create) {
    written.push(
      await inOrg((tx) =>
        importRelayLoad(tx, organizationId, planned, {
          companyId,
          customerId: customer.id,
          mode: options.mode,
          byUserId: userId,
        }),
      ),
    )
  }
  return { plan, written }
}

describe('importing upcoming trips as booked', () => {
  it('books the load, with the window on every stop', async () => {
    const { plan, written } = await importFile(
      file(relayRow({ loadId: `BOOK-${nonce}` })),
      { mode: 'booked' },
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

    // THE WINDOW REACHED ITS COLUMNS, at the stop's own offset. 23:30 at
    // UTC−6 is 05:30Z the next day; the departure is 00:01 the day after
    // that, which is 31 minutes later and NOT 23 hours earlier.
    const [first, second] = load.stops
    expect(first!.type).toBe('PICKUP')
    expect(first!.windowStart!.toISOString()).toBe('2026-08-12T05:30:00.000Z')
    expect(first!.windowEnd!.toISOString()).toBe('2026-08-12T06:01:00.000Z')
    expect(first!.appointmentType).toBe('WINDOW')
    expect(second!.type).toBe('DELIVERY')
    // A different offset on the same load — a cross-zone run.
    expect(second!.windowStart!.toISOString()).toBe('2026-08-12T11:31:00.000Z')

    // Booked, not run: the actual columns are in the file and are NOT written.
    expect(first!.arrivedAt).toBeNull()
    expect(first!.departedAt).toBeNull()
  })

  it('files the trip’s own facts instead of guessing at the fleet', async () => {
    const { written } = await importFile(
      file(relayRow({ loadId: `NOTE-${nonce}`, driver: 'Jane Roe' })),
      { mode: 'booked' },
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
    const { written } = await importFile(csv, { mode: 'booked' })
    expect(written).toHaveLength(2)

    const places = await inOrg((tx) =>
      tx.location.findMany({ where: { name: `ZZ1-${nonce}` } }),
    )
    expect(places).toHaveLength(1)
    // No address, because the export has none. That is the truth rather than
    // a town parsed out of a facility code.
    expect(places[0]!.city).toBeNull()
    expect(places[0]!.state).toBeNull()
  })
})

describe('importing finished trips as delivered', () => {
  it('lands DELIVERED through the status engine, with the actual times', async () => {
    const { written } = await importFile(
      file(relayRow({ loadId: `DONE-${nonce}` })),
      { mode: 'delivered' },
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

    expect(load.operationalStatus).toBe('DELIVERED')

    // THROUGH THE ENGINE, which means the event log records it. A
    // `data: { operationalStatus }` write would leave a load that is
    // delivered with no history of becoming so.
    const delivered = load.statusEvents.find(
      (event) => event.toStatus === 'DELIVERED',
    )
    expect(delivered).toBeDefined()
    expect(delivered!.source).toBe('INTEGRATION')

    // The actuals are on the stops, and the PLAN is still there beside them —
    // a delivered load whose appointment was erased cannot be asked whether
    // it was late, which is the question a Relay scorecard turns on.
    const [first] = load.stops
    expect(first!.arrivedAt!.toISOString()).toBe('2026-08-12T04:16:00.000Z')
    expect(first!.departedAt!.toISOString()).toBe('2026-08-12T04:40:00.000Z')
    expect(first!.windowStart).not.toBeNull()
  })

  it('skips a trip that has not finished, and says which', async () => {
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
    const { plan } = await importFile(csv, { mode: 'delivered' })

    expect(plan.create.map((load) => load.loadId)).toEqual([`MIX-A-${nonce}`])
    expect(plan.skip).toEqual([
      {
        rowNumber: 2,
        loadId: `MIX-B-${nonce}`,
        reason: 'not_completed',
      },
    ])
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
    const { plan } = await importFile(csv, { mode: 'booked' })
    expect(plan.skip).toHaveLength(0)
    expect(plan.create).toHaveLength(1)
  })
})

describe('what the import refuses and what it warns about', () => {
  it('skips a row whose stop has times but no UTC offset', async () => {
    const { plan } = await importFile(
      file(relayRow({ loadId: `NOOFF-${nonce}`, s2offset: '' })),
      { mode: 'booked' },
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
      { mode: 'booked' },
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
      { mode: 'booked' },
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.skip[0]!.reason).toBe('repeated_in_file')
  })

  it('warns by name when the file has already been imported', async () => {
    const csv = file(relayRow({ loadId: `AGAIN-${nonce}` }))
    const first = await importFile(csv, { mode: 'booked' })
    expect(first.plan.create[0]!.warnings).toHaveLength(0)

    const second = await importFile(csv, { mode: 'booked' })
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
      planRelayImport(tx, { trips, mode: 'booked', maySeeMoney: true }),
    )

    await importFile(csv, { mode: 'booked' })

    const after = await inOrg((tx) =>
      planRelayImport(tx, { trips, mode: 'booked', maySeeMoney: true }),
    )
    expect(planSignature(after)).not.toBe(planSignature(before))
  })
})

describe('the money wall and the settlement terms', () => {
  it('creates Amazon Relay settling directly, so its loads never invoice', async () => {
    const { written } = await importFile(
      file(relayRow({ loadId: `DIR-${nonce}` })),
      { mode: 'booked' },
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
      { mode: 'booked', maySeeMoney: false },
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
      { mode: 'booked' },
    )
    const numbers = written.map((load) => Number(load.loadNumber))
    expect(numbers[1]).toBe(numbers[0]! + 1)
  })
})
