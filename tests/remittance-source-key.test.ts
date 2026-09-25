import { describe, expect, it } from 'vitest'
import { sourceKeyFor } from '@/lib/amazon/remittance-write'
import type { RowKey } from '@/lib/amazon/remittance-preview'

// ---------------------------------------------------------------------------
// TWO LOADS UNDER ONE TRIP, EACH WITH A FUEL SURCHARGE.
//
// `LoadAccessorial` is unique on (loadId, sourceKey). The key used to be built
// from the row's REFERENCE — and for a load under a trip the reference IS the
// trip, so every load under one trip produced the same key.
//
// On the 2026-09-13..19 remittance that is 38 collisions, nearly all of them
// `T-<tripId>:LOAD - COMPLETED:Fuel Surcharge`. The unique index refused the
// second one and the whole import threw, which is the right failure — but the
// week could not be imported at all, and an upsert or a skipDuplicates in that
// spot would have dropped real charges without a word.
// ---------------------------------------------------------------------------

const INVOICE = 'AZNG4464389DE99C487FB425AC77433D22DF'

describe('the source key of an Amazon charge', () => {
  const underTripA: RowKey = {
    branch: 'load_under_trip',
    tripId: 'T-112LMCG48',
    loadId: '114Y9BZK2',
  }
  const underTripB: RowKey = {
    branch: 'load_under_trip',
    tripId: 'T-112LMCG48',
    loadId: '115ZJPFTG',
  }

  // ── THE COLLISION, AS A TEST ──────────────────────────────────────────
  it('differs for two loads under the SAME trip carrying the same charge', () => {
    expect(
      sourceKeyFor(INVOICE, underTripA, 'LOAD - COMPLETED', 'Fuel Surcharge'),
    ).not.toBe(
      sourceKeyFor(INVOICE, underTripB, 'LOAD - COMPLETED', 'Fuel Surcharge'),
    )
  })

  it('keeps the trip in the key, so a trip can still be grepped', () => {
    // The load alone would be unique and would lose the reconciliation handle
    // somebody reading a trip actually wants.
    const key = sourceKeyFor(INVOICE, underTripA, 'LOAD - COMPLETED', 'Tolls')
    expect(key).toContain('T-112LMCG48')
    expect(key).toContain('114Y9BZK2')
  })

  it('still differs per money column on one row', () => {
    // The original fix, kept: without the column a row's fuel surcharge and its
    // tolls shared a key and one was silently lost.
    expect(
      sourceKeyFor(INVOICE, underTripA, 'LOAD - COMPLETED', 'Tolls'),
    ).not.toBe(
      sourceKeyFor(INVOICE, underTripA, 'LOAD - COMPLETED', 'Fuel Surcharge'),
    )
  })

  it('still differs per item type', () => {
    expect(
      sourceKeyFor(INVOICE, underTripA, 'LOAD - COMPLETED', 'Tolls'),
    ).not.toBe(sourceKeyFor(INVOICE, underTripA, 'LOAD - CANCELLED', 'Tolls'))
  })

  it('still differs per invoice, so a re-send is not a duplicate of last week', () => {
    expect(
      sourceKeyFor('AZNG-OTHER', underTripA, 'LOAD - COMPLETED', 'Tolls'),
    ).not.toBe(sourceKeyFor(INVOICE, underTripA, 'LOAD - COMPLETED', 'Tolls'))
  })

  it('is stable for the same row asked twice', () => {
    // Idempotency rests on this: a re-import must produce the key the first run
    // wrote, or the unique index stops being a guard at all.
    expect(sourceKeyFor(INVOICE, underTripA, 'LOAD - COMPLETED', 'Tolls')).toBe(
      sourceKeyFor(INVOICE, { ...underTripA }, 'LOAD - COMPLETED', 'Tolls'),
    )
  })

  it('keys a tour on its trip and a single load on its load', () => {
    expect(
      sourceKeyFor(
        INVOICE,
        { branch: 'tour', tripId: 'T-1' },
        'TOUR - COMPLETED',
        'Tolls',
      ),
    ).toContain('T-1')
    expect(
      sourceKeyFor(
        INVOICE,
        { branch: 'single_load', loadId: 'L-9' },
        'LOAD - COMPLETED',
        'Tolls',
      ),
    ).toContain('L-9')
  })

  it('REFUSES an unkeyable row rather than giving every one the same key', () => {
    // A constant would make every unkeyable row collide with every other, which
    // is the bug this whole file is about, one level down.
    expect(() =>
      sourceKeyFor(
        INVOICE,
        { branch: 'unkeyable' },
        'LOAD - COMPLETED',
        'Tolls',
      ),
    ).toThrow(/no identity/)
  })
})
