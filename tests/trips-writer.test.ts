import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  facilitiesMissingAddress,
  stopRowsForTrip,
  tripFacilityCodes,
} from '@/lib/trips-writer'
import type { PlannedTrip } from '@/lib/trips-import'

// ---------------------------------------------------------------------------
// A TRIP THAT ARRIVES TWICE MUST NOT BECOME TWO LOADS.
//
// The booking email creates the load; the trips export knows where the truck
// actually went. Same freight, two routes in, one `Load.referenceNumber` —
// so the second arrival ENRICHES rather than books it again.
//
// And enrichment ADDS WHAT IS MISSING, REPLACES NOTHING. That is the only
// posture under which running an import twice is safe, and running it twice is
// what will happen: these files are swept from a downloads folder.
// ---------------------------------------------------------------------------

const trip = (over: Partial<PlannedTrip> = {}): PlannedTrip => ({
  tripId: 'T-115HXB4HH',
  stops: [
    {
      sequence: 1,
      facilityCode: 'DEN7',
      legMiles: null,
      legEmpty: null,
      referenceNumber: null,
      plannedArrival: null,
      plannedDeparture: null,
      actualArrival: null,
      actualDeparture: null,
    },
    {
      sequence: 2,
      facilityCode: 'MKC6',
      legMiles: 583,
      legEmpty: false,
      referenceNumber: '115HXB4HH',
      plannedArrival: null,
      plannedDeparture: null,
      actualArrival: null,
      actualDeparture: null,
    },
  ],
  totalMiles: 583,
  emptyMiles: 0,
  driverNames: ['Belal Sultani'],
  trailerIds: ['HV2504452'],
  tractorIds: ['ZP33494'],
  cancelledLegs: 0,
  stage: 'upcoming' as const,
  rateCents: null,
  ...over,
})

/** Facilities as `resolveFacilities` returns them, zone included. */
const facilityMap = (
  byCode: Record<string, string>,
  timezone: string | null = 'America/Chicago',
) =>
  new Map(
    Object.entries(byCode).map(([code, id]) => [
      code,
      { id, city: null, state: null, timezone, addressLine1: null },
    ]),
  )

const book = facilityMap({ DEN7: 'loc-den7', MKC6: 'loc-mkc6' })

describe('the stops a trip writes', () => {
  it('resolves each facility code to the seeded location', () => {
    const rows = stopRowsForTrip(trip(), book)
    expect(rows.map((row) => row.locationId)).toEqual(['loc-den7', 'loc-mkc6'])
  })

  // A CODE WE HAVE NEVER SEEN IS A FACT, NOT AN ERROR. The stop is written
  // with the code as its name and no address, rather than minting a location
  // out of a string — which is how a facility book fills with half-known docks.
  it('writes an unknown code as a name with no location', () => {
    const rows = stopRowsForTrip(trip(), facilityMap({ DEN7: 'loc-den7' }))
    expect(rows[1]?.locationId).toBeNull()
    expect(rows[1]?.name).toBe('MKC6')
  })

  it('numbers the stops by position, because position IS the sequence', () => {
    expect(stopRowsForTrip(trip(), book).map((row) => row.sequence)).toEqual([
      1, 2,
    ])
  })

  it('carries the leg onto the stop it arrived at', () => {
    const rows = stopRowsForTrip(trip(), book)
    expect(rows[0]?.legMiles).toBeNull()
    expect(rows[1]?.legMiles).toBe(583)
    // The Datatruck convention: a stop's reference is its leg's Load ID.
    expect(rows[1]?.referenceNumber).toBe('115HXB4HH')
  })

  it('lists each facility once for resolution, in visit order', () => {
    expect(tripFacilityCodes(trip())).toEqual(['DEN7', 'MKC6'])
  })

  it('does not collapse a facility visited twice into one lookup entry', () => {
    const there = trip({
      stops: [
        ...trip().stops,
        { ...trip().stops[0]!, sequence: 3, legMiles: 583 },
      ],
    })
    // Three stops, two distinct codes — the chain keeps both visits and the
    // lookup asks about each code once.
    expect(stopRowsForTrip(there, book)).toHaveLength(3)
    expect(tripFacilityCodes(there)).toEqual(['DEN7', 'MKC6'])
  })
})

/** Money arithmetic, in the two shapes it would realistically take. */
const SUMS_MONEY = /Cents\s*\+/
const REDUCES_MONEY = /reduce\([\s\S]{0,160}?Cents/

describe('what the writer is forbidden to do', () => {
  const source = readFileSync('src/lib/trips-writer.ts', 'utf8')

  /**
   * The file with its comments removed.
   *
   * The first version of the test below searched the whole source and failed
   * on the word "rate" inside a comment EXPLAINING that rates are never
   * touched here. A rule about what code does must be asserted against code;
   * asserting it against prose punishes the documentation that makes the rule
   * findable.
   */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  // RULE 6 AS IT NOW STANDS. This file DOES write `linehaulCents` — that is
  // the 2026-08-20 ruling, verified against trip 1165YNVHN at $5,089.07 — so
  // the old "never touches money" assertion would now be asserting a bug.
  //
  // WHAT REPLACED IT IS NARROWER AND STRICTER: the writer may only write the
  // figure it was HANDED, and must be unable to reach a per-leg cost. It never
  // names `costCents`, never names the export's column, and never derives a
  // number by adding legs up. Everything a rate could wrongly come from is
  // absent; the one thing it may come from arrives as an argument.
  it('writes only the rate it was handed, and can reach no other money', () => {
    for (const field of [
      'costCents',
      'Estimated Cost',
      'Cost',
      'totalRevenueCents',
      'fuelSurchargeCents',
      'accessorialsCents',
    ]) {
      expect(code, `the writer reaches ${field}`).not.toContain(field)
    }
    // The only money it writes, and it comes straight off its own input.
    expect(code).toContain('linehaulCents: rateCents')
    expect(code).toContain('linehaulCents: input.rateCents')
  })

  // The sum of the legs is what `Estimated Cost` means on a multi-leg trip.
  // No arithmetic on money may exist here at all.
  it('does not add money up', () => {
    // BOTH PATTERNS PROVEN TO FIRE, below. The first version of the reduce
    // pattern was /reduce\([^)]*Cents/, which cannot match
    // `legs.reduce((n, l) => n + l.costCents, 0)` at all — the character class
    // stops dead at the `)` of the parameter list. It would have sat here
    // passing forever on exactly the code it was written to catch.
    expect(code).not.toMatch(SUMS_MONEY)
    expect(code).not.toMatch(REDUCES_MONEY)
  })

  it('has money-arithmetic patterns that can actually fail', () => {
    expect(SUMS_MONEY.test('load.linehaulCents + fuelSurchargeCents')).toBe(
      true,
    )
    expect(
      REDUCES_MONEY.test('legs.reduce((n, l) => n + l.costCents, 0)'),
    ).toBe(true)
    expect(SUMS_MONEY.test('linehaulCents: rateCents')).toBe(false)
    expect(REDUCES_MONEY.test('linehaulCents: rateCents')).toBe(false)
  })

  // RULE 7. Name-matching a CSV string to a Driver record is a separate ruled
  // feature; until then these are informational.
  it('never assigns a driver or a truck', () => {
    expect(code).not.toContain('driverId')
    expect(code).not.toContain('truckId')
  })

  it('matches the reference exactly, with no normalising', () => {
    const lookup = source.slice(
      source.indexOf('export async function planTripWrite'),
      source.indexOf('export async function enrichLoad'),
    )
    expect(lookup).toContain('referenceNumber: trip.tripId')
    expect(lookup).not.toContain('withoutTripPrefix')
    expect(lookup).not.toMatch(/toLowerCase|toUpperCase|startsWith/)
  })

  // THE PROPERTY THAT MAKES A SECOND RUN SAFE. A dispatcher who fixed an
  // address must not find it replaced by an import an hour later.
  it('adds stops only when the load has none', () => {
    const enrich = source.slice(
      source.indexOf('export async function enrichLoad'),
    )
    expect(enrich).toContain('if (!existing.hasStops')
    expect(enrich).toContain('if (!existing.hasMiles')
    // Nothing here deletes or overwrites an existing chain.
    expect(enrich).not.toMatch(/deleteMany|updateMany/)
  })

  it('says what it changed rather than that it "enriched"', () => {
    const enrich = source.slice(
      source.indexOf('export async function enrichLoad'),
    )
    expect(enrich).toContain('added.push(`${rows.length} stops`)')
    expect(enrich).toContain("kind: 'unchanged'")
  })
})

// ---------------------------------------------------------------------------
// THE FACILITY THE BOOK HAS AND HAS NO STREET FOR.
//
// The quieter of two problems, and the one that was invisible. A code with no
// row at all is already surfaced — the stop takes the code as its name and the
// preview lists it as unresolved. A code the book HAS, with no address, resolves
// cleanly: the stop links to a real facility, the load looks complete on every
// screen, and a driver is sent to a code nobody has a street for. MEM4-DRAY on
// load 1013 was exactly that.
// ---------------------------------------------------------------------------

describe('facilities the book cannot address', () => {
  const withAddresses = (byCode: Record<string, string | null>) =>
    new Map(
      Object.entries(byCode).map(([code, addressLine1]) => [
        code,
        {
          id: `loc-${code}`,
          city: null,
          state: null,
          timezone: null,
          addressLine1,
        },
      ]),
    )

  it('names a facility that resolved but carries no street', () => {
    const book = withAddresses({ MEM4: '4000 Nucor Rd', 'MEM4-DRAY': null })
    expect(facilitiesMissingAddress(['MEM4', 'MEM4-DRAY'], book)).toEqual([
      'MEM4-DRAY',
    ])
  })

  // THE LINE BETWEEN THE TWO CONDITIONS. A code with no row is the OTHER
  // problem and is already reported as unresolved; listing it here as well
  // would count one stop under two headings and imply two fixes.
  it('says nothing about a code the book does not have at all', () => {
    const book = withAddresses({ MEM4: '4000 Nucor Rd' })
    expect(facilitiesMissingAddress(['MEM4', 'NOWHERE'], book)).toEqual([])
  })

  it('is quiet when every facility has a street', () => {
    const book = withAddresses({ MEM4: '4000 Nucor Rd', HME9: '5155 Citation' })
    expect(facilitiesMissingAddress(['MEM4', 'HME9'], book)).toEqual([])
  })
})
