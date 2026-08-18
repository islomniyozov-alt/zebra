import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stopRowsForTrip, tripFacilityCodes } from '@/lib/trips-writer'
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
  ...over,
})

const book = new Map([
  ['DEN7', { id: 'loc-den7' }],
  ['MKC6', { id: 'loc-mkc6' }],
])

describe('the stops a trip writes', () => {
  it('resolves each facility code to the seeded location', () => {
    const rows = stopRowsForTrip(trip(), book)
    expect(rows.map((row) => row.locationId)).toEqual(['loc-den7', 'loc-mkc6'])
  })

  // A CODE WE HAVE NEVER SEEN IS A FACT, NOT AN ERROR. The stop is written
  // with the code as its name and no address, rather than minting a location
  // out of a string — which is how a facility book fills with half-known docks.
  it('writes an unknown code as a name with no location', () => {
    const rows = stopRowsForTrip(
      trip(),
      new Map([['DEN7', { id: 'loc-den7' }]]),
    )
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

  // RULE 6. Estimated Cost was never parsed, and nothing downstream may
  // reintroduce it — a rate on this path comes from the email or is absent.
  it('never touches money', () => {
    for (const field of [
      'linehaulCents',
      'totalRevenueCents',
      'fuelSurchargeCents',
      'accessorialsCents',
      'Cost',
    ]) {
      expect(code, `the writer uses ${field}`).not.toContain(field)
    }
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
