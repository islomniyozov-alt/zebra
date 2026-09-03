import { describe, expect, it } from 'vitest'
import { milesSummary } from '@/lib/load-miles'

// ---------------------------------------------------------------------------
// THE THREE ANSWERS A MILES PANEL CAN GIVE, AND THE ONE IT MUST NOT.
//
// It can say "583 total, 470 loaded, 113 empty". It can say "583 total, and we
// never classified this freight". It can say "no distance recorded at all".
//
// What it must not say is "0 empty" about a load nobody measured — which is
// what a subtraction at the call site produces the moment `emptyMiles` is null,
// and null is the state of every broker load in the database.
// ---------------------------------------------------------------------------

const stops = (
  ...legs: [miles: number | null, empty: boolean | null][]
): { legMiles: number | null; legEmpty: boolean | null }[] =>
  legs.map(([legMiles, legEmpty]) => ({ legMiles, legEmpty }))

describe('a trip whose legs were classified', () => {
  const load = {
    dispatchedMiles: 583,
    emptyMiles: 113,
    stops: stops([null, null], [470, false], [113, true]),
  }

  it('splits the total into loaded and empty', () => {
    expect(milesSummary(load)).toEqual({
      totalMiles: 583,
      loadedMiles: 470,
      emptyMiles: 113,
      provisional: false,
    })
  })

  it('does not call a fully classified split provisional', () => {
    expect(milesSummary(load).provisional).toBe(false)
  })
})

describe('freight nobody classified', () => {
  // EVERY BROKER LOAD IN THE DATABASE. Nothing on that path writes
  // `emptyMiles` — a typed-in load has no Shipper Account to classify — so the
  // column is null and has always been.
  it('reports the total and refuses to invent the split', () => {
    expect(
      milesSummary({
        dispatchedMiles: 1_204,
        emptyMiles: null,
        stops: stops([null, null], [1204, null]),
      }),
    ).toEqual({
      totalMiles: 1_204,
      loadedMiles: null,
      emptyMiles: null,
      provisional: true,
    })
  })

  // THE FAILURE THIS FILE EXISTS TO PREVENT, named as itself.
  it('never answers zero empty when it means unknown', () => {
    const summary = milesSummary({
      dispatchedMiles: 1_204,
      emptyMiles: null,
      stops: stops([1204, null]),
    })
    expect(summary.emptyMiles).not.toBe(0)
    expect(summary.emptyMiles).toBeNull()
  })
})

describe('a trip with a leg no rule matched', () => {
  // `TrailerPoolAdjustment` — 112 legs, still with the owner. Its miles land in
  // the LOADED figure by default, and the load has to say so. Flag 91.
  it('is provisional even though the split adds up', () => {
    const summary = milesSummary({
      dispatchedMiles: 500,
      emptyMiles: 100,
      stops: stops([400, null], [100, true]),
    })
    expect(summary.loadedMiles).toBe(400)
    expect(summary.provisional).toBe(true)
  })

  // A stop with no leg is not an unclassified leg. The first stop of every
  // trip carries no mileage, and treating it as unclassified would mark every
  // load provisional and make the note mean nothing.
  it('ignores a stop that carries no leg at all', () => {
    expect(
      milesSummary({
        dispatchedMiles: 500,
        emptyMiles: 0,
        stops: stops([null, null], [500, false]),
      }).provisional,
    ).toBe(false)
  })
})

describe('the arithmetic that should never happen', () => {
  it('says nothing about distance when there is none', () => {
    expect(
      milesSummary({ dispatchedMiles: null, emptyMiles: null, stops: [] }),
    ).toEqual({
      totalMiles: null,
      loadedMiles: null,
      emptyMiles: null,
      provisional: false,
    })
  })

  it('never shows negative loaded miles', () => {
    // Cannot arise from the importer — both figures come from one accumulation
    // — but a negative "loaded" on screen reads as a fact about the freight
    // rather than a fault in the sum.
    const summary = milesSummary({
      dispatchedMiles: 100,
      emptyMiles: 250,
      stops: stops([100, true]),
    })
    expect(summary.loadedMiles).toBe(0)
    expect(summary.emptyMiles).toBe(100)
  })
})
