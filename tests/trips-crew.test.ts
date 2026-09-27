import { describe, expect, it } from 'vitest'
import { nameKey } from '@/lib/name-key'
import { crewNameKey, crewSeatFor, stageSeatsCrew } from '@/lib/trips-crew'

// ---------------------------------------------------------------------------
// SEATING A RELAY TRIP'S CREW, AND REFUSING TO GUESS.
//
// Owner's ruling, 2026-09-27. This supersedes Rule 7, which said the CSV's names
// were informational "until name-matching is its own ruled feature" — so the
// rule named the condition for its own replacement and this is it.
//
// Every refusal here is a seat that would otherwise be filled by a guess, and a
// guessed seat is money paid to somebody who did not drive.
// ---------------------------------------------------------------------------

const resolver = (
  drivers: Record<string, string[]>,
  trucks: Record<string, string[]>,
) => ({
  driverIdsFor: (name: string) => drivers[crewNameKey(name)] ?? [],
  truckIdsFor: (unit: string) => trucks[crewNameKey(unit)] ?? [],
})

describe('a trip the file is clear about', () => {
  it('seats the driver and the truck', () => {
    const seat = crewSeatFor(
      { driverNames: ['HAIDAR NIYOZOV'], tractorIds: ['2146'] },
      resolver({ 'haidar niyozov': ['drv_1'] }, { '2146': ['trk_1'] }),
    )
    expect(seat).toEqual({
      kind: 'seated',
      driverId: 'drv_1',
      truckId: 'trk_1',
    })
  })

  it('matches on the same key the Datatruck seed uses', () => {
    // Two importers normalising differently would seat the same person on one
    // path and refuse them on the other. THE SEED'S KEY IS LOWER-CASE, and this
    // module's used to be upper — under a comment asserting they were the same.
    // They are one function now; this is the assertion that says which one.
    expect(crewNameKey('  HAIDAR   Niyozov ')).toBe(nameKey('haidar niyozov'))
    expect(crewNameKey('  HAIDAR   Niyozov ')).toBe('haidar niyozov')
    const seat = crewSeatFor(
      { driverNames: ['  HAIDAR   Niyozov '], tractorIds: [] },
      resolver({ 'haidar niyozov': ['drv_1'] }, {}),
    )
    expect(seat).toEqual({ kind: 'seated', driverId: 'drv_1', truckId: null })
  })
})

describe('an empty column is not a refusal', () => {
  it('seats nothing and refuses nothing', () => {
    // 7 of the fixture's 200 rows carry no driver name and 9 no tractor.
    // Counting silence as a refusal would bury the ones that are wrong.
    expect(
      crewSeatFor({ driverNames: [], tractorIds: [] }, resolver({}, {})),
    ).toEqual({ kind: 'seated', driverId: null, truckId: null })
    expect(
      crewSeatFor({ driverNames: ['  '], tractorIds: [''] }, resolver({}, {})),
    ).toEqual({ kind: 'seated', driverId: null, truckId: null })
  })
})

describe('the three refusals', () => {
  it('REFUSES a name that matches nobody, and names it', () => {
    const seat = crewSeatFor(
      { driverNames: ['JULIA ROSE HALL'], tractorIds: [] },
      resolver({}, {}),
    )
    expect(seat.kind).toBe('refused')
    if (seat.kind !== 'refused') return
    expect(seat.reasons).toEqual([
      { column: 'driver', value: 'JULIA ROSE HALL', why: 'matches_nobody' },
    ])
  })

  it('REFUSES a name that matches two people', () => {
    const seat = crewSeatFor(
      { driverNames: ['J SMITH'], tractorIds: [] },
      resolver({ 'j smith': ['drv_a', 'drv_b'] }, {}),
    )
    expect(seat.kind).toBe('refused')
    if (seat.kind !== 'refused') return
    expect(seat.reasons[0]!.why).toBe('matches_two')
  })

  it('REFUSES a unit that matches two trucks', () => {
    // Production carried two trucks numbered 1024 for a fortnight. This is the
    // case that made that discoverable rather than silent.
    const seat = crewSeatFor(
      { driverNames: [], tractorIds: ['1024'] },
      resolver({}, { '1024': ['trk_a', 'trk_b'] }),
    )
    expect(seat.kind).toBe('refused')
    if (seat.kind !== 'refused') return
    expect(seat.reasons).toEqual([
      { column: 'truck', value: '1024', why: 'matches_two' },
    ])
  })

  // ── THE FILE DISAGREEING WITH ITSELF IS ITS OWN REASON ─────────────────
  it('REFUSES a trip whose legs name two different drivers', () => {
    // Not a team: `driverNames` is the DISTINCT set across the trip's legs, so
    // two names means the legs disagree about who drove. A team run is stated
    // per load in Datatruck's own Co-Driver column, not inferred from this.
    const seat = crewSeatFor(
      { driverNames: ['ODILJON NIYOZOV', 'HAIDAR NIYOZOV'], tractorIds: [] },
      resolver(
        { 'odiljon niyozov': ['drv_1'], 'haidar niyozov': ['drv_2'] },
        {},
      ),
    )
    expect(seat.kind).toBe('refused')
    if (seat.kind !== 'refused') return
    // BOTH NAMES IN THE REPORT. Naming one would read as that driver being the
    // problem.
    expect(seat.reasons[0]!.why).toBe('file_disagrees')
    expect(seat.reasons[0]!.value).toContain('ODILJON NIYOZOV')
    expect(seat.reasons[0]!.value).toContain('HAIDAR NIYOZOV')
  })

  it('REFUSES a trip whose legs name two different tractors', () => {
    const seat = crewSeatFor(
      { driverNames: [], tractorIds: ['2146', '4588'] },
      resolver({}, { '2146': ['trk_1'], '4588': ['trk_2'] }),
    )
    expect(seat.kind).toBe('refused')
    if (seat.kind !== 'refused') return
    expect(seat.reasons[0]!.why).toBe('file_disagrees')
  })
})

describe('the two seats are decided independently', () => {
  it('reports BOTH refusals when both columns are bad', () => {
    const seat = crewSeatFor(
      { driverNames: ['NOBODY'], tractorIds: ['9999'] },
      resolver({}, {}),
    )
    expect(seat.kind).toBe('refused')
    if (seat.kind !== 'refused') return
    expect(seat.reasons.map((r) => r.column)).toEqual(['driver', 'truck'])
  })

  it('does not lose a good driver to a bad truck — it reports the truck', () => {
    // A refusal is per column, so the report says which one to fix. The trip is
    // still refused as a whole: writing half a crew from a file that is wrong
    // about the other half is the kind of partial success nobody audits.
    const seat = crewSeatFor(
      { driverNames: ['HAIDAR NIYOZOV'], tractorIds: ['9999'] },
      resolver({ 'haidar niyozov': ['drv_1'] }, {}),
    )
    expect(seat.kind).toBe('refused')
    if (seat.kind !== 'refused') return
    expect(seat.reasons).toHaveLength(1)
    expect(seat.reasons[0]!.column).toBe('truck')
  })
})

// ---------------------------------------------------------------------------
// AND WHICH TRIPS GET THEIR SEATS FROM THE FILE AT ALL.
// ---------------------------------------------------------------------------

describe('only a finished trip is seated from the file', () => {
  it('seats a finished trip', () => {
    expect(stageSeatsCrew('finished')).toBe(true)
  })

  // NOT TIMIDITY — THE DISPATCH GUARD. Writing a seat onto live freight runs
  // `assertAssignable`, and each of its four rules refuses a TRUE statement
  // about a completed row: roster-INACTIVE (admitted by the 2026-09-25 ruling),
  // an asset at another authority (a month's file spans six companies while the
  // form picks one), and two finished trips whose paper clocks overlap. A bulk
  // import is one transaction per chunk, so one refusal loses twenty trips.
  it('REFUSES to seat a running or upcoming trip', () => {
    expect(stageSeatsCrew('running')).toBe(false)
    expect(stageSeatsCrew('upcoming')).toBe(false)
  })
})
