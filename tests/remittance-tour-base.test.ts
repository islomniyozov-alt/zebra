import { describe, expect, it } from 'vitest'
import {
  TOUR_BASE_LABEL,
  isTourBase,
  sourceKeyFor,
} from '@/lib/amazon/remittance-write'
import type { RowKey } from '@/lib/amazon/remittance-preview'

// ---------------------------------------------------------------------------
// A TOUR'S BASE IS MONEY ZEBRA HAD NEVER BOOKED.
//
// Owner's ruling, 2026-09-26. The Datatruck export's `Load pay` for a tour-based
// trip carries only the LEG amounts, so the trip's load was short by the whole
// tour base — and the remittance then read `over` by four to eight times.
//
// MEASURED BEFORE THE RULING, exact to the cent on five loads:
//
//   DT-016233  legs $37.87 + $56.73 = $94.60  == the linehaul, and the
//              $654.97 tour base appears nowhere
//   DT-016327  $150.18 + $25.27 = $175.45     tour base $1,006.29 absent
//   DT-016344  $17.18 + $40.22 = $57.40       tour base $356.27 absent
//   DT-016406  $864.95 + $3.43 = $868.38      tour base $2,017.16 absent
//   DT-016586  $54.23 + $172.08 = $226.31     tour base $755.55 absent
//
// $4,790.24 of unbooked revenue on one week. So the base is booked as a
// remittance-sourced accessorial and the load's revenue is recomputed from its
// rows; driver pay is a percent of LINEHAUL and is deliberately untouched.
// ---------------------------------------------------------------------------

describe('which base rate is a charge', () => {
  it('is the one on a COMPLETED TOUR row', () => {
    expect(isTourBase('TOUR - COMPLETED', 'Base Rate')).toBe(true)
  })

  it('is NOT the base rate on a load row, which is the linehaul', () => {
    // The original exclusion, kept. A load row's base rate is already in
    // `linehaulCents`; booking it again would double the load's revenue.
    expect(isTourBase('LOAD - COMPLETED', 'Base Rate')).toBe(false)
    expect(isTourBase('LOAD - CANCELLED', 'Base Rate')).toBe(false)
  })

  it('is NOT the base rate on a CANCELLED tour', () => {
    // A cancelled tour's money arrives as TONU, in its own column, and that is
    // already a charge. Reading its base rate too would pay for it twice.
    expect(isTourBase('TOUR - CANCELLED', 'Base Rate')).toBe(false)
  })

  it('is no other column on a tour row', () => {
    // Fuel Surcharge and Tolls are already charges by the column list. This
    // predicate must not widen to them or they would be written twice.
    for (const column of ['Fuel Surcharge', 'Tolls', 'Detention', 'TONU']) {
      expect(isTourBase('TOUR - COMPLETED', column)).toBe(false)
    }
  })
})

describe('the tour base in the source key', () => {
  const tour: RowKey = { branch: 'tour', tripId: 'T-1125DMVTW' }
  const INVOICE = 'AZNG4464389DE99C487FB425AC77433D22DF'

  it('is named, so the row is greppable as what it is', () => {
    const key = sourceKeyFor(INVOICE, tour, 'TOUR - COMPLETED', TOUR_BASE_LABEL)
    expect(key).toContain(TOUR_BASE_LABEL)
    expect(key).toContain('T-1125DMVTW')
  })

  it('is distinct from a base rate that slipped through under its own name', () => {
    // If the label were dropped the key would read `...:Base Rate`, which is
    // indistinguishable from the exclusion having failed.
    expect(
      sourceKeyFor(INVOICE, tour, 'TOUR - COMPLETED', TOUR_BASE_LABEL),
    ).not.toBe(sourceKeyFor(INVOICE, tour, 'TOUR - COMPLETED', 'Base Rate'))
  })

  it('is called exactly "Tour base"', () => {
    // Pinned because it lands in `notes` and in the key on real money rows, and
    // renaming it silently would orphan every row already written.
    expect(TOUR_BASE_LABEL).toBe('Tour base')
  })
})

// ── AND THE WRITER ACTUALLY DOES ALL THREE THINGS ───────────────────────
describe('what the writer does with it', () => {
  it('books the base, recomputes the revenue and re-derives the outcome', async () => {
    // THE RULING HAS THREE PARTS and two of them are easy to leave out. Booking
    // the accessorial without recomputing leaves `totalRevenueCents` — the very
    // column `remittanceOutcome` compares against — at its old value. Failing to
    // re-derive makes the function REPORT the stale comparison, so a caller
    // reading its counts would conclude the ruling had not worked.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/amazon/remittance-write.ts', 'utf8'),
    )
    expect(source).toContain('isTourBase(row.itemType, column)')
    // Only the tour base adds to revenue; the rest is a breakdown of money the
    // rate already contains, and counting it sent all 139 units short.
    expect(source).toContain('isBillable: tourBase,')
    // The revenue is re-derived with `rates.ts`'s own arithmetic.
    expect(source).toContain('loadRevenueCents({')
    // ONE billing-status refresh over every id. Per-load it was 400+ round
    // trips and the transaction expired at 120,425ms against a 120,000ms
    // ceiling — so this also guards the shape, not just the rule.
    expect(source).toContain('refreshBillingStatus(tx, touchedLoadIds)')
    expect(source).not.toContain('refreshBillingStatus(tx, [loadId])')
    expect(source).toContain('previewRemittance(reading, afterByReference)')
    expect(source).toContain('preview: previewAfter,')
  })
})
