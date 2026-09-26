import { describe, expect, it } from 'vitest'
import { previewRemittance } from '@/lib/amazon/remittance-preview'
import type { FreightRef } from '@/lib/amazon/remittance-preview'
import type { RemittanceReading, RemittanceRow } from '@/lib/amazon/remittance'

// ---------------------------------------------------------------------------
// A TRIP'S TOTAL AGAINST THE SUM OF ITS LEGS, NOT AGAINST ONE OF THEM.
//
// Owner's ruling, 2026-09-25. `PreviewLine` carried ONE load, and for a trip
// with several legs the freight map handed back whichever leg was written last
// — so a trip's whole remitted total was compared against one leg's rate.
//
// On the first real settlement week that produced seven loads reported `over`
// by four to eight times: $749.57 against $94.60, $413.67 against $57.40,
// $1,181.74 against $175.45, $2,885.54 against $868.38. None of them was over.
// The engine's per-load comparison was right; the denominator was wrong, and
// the write had put the wrong denominator into the data.
// ---------------------------------------------------------------------------

const TRIP = 'T-112LMCG48'

/** A completed load row under a trip, carrying `gross` as its money. */
const rowUnderTrip = (loadId: string, gross: number): RemittanceRow =>
  ({
    tripId: TRIP,
    loadId,
    itemType: 'LOAD - COMPLETED',
    item: { scope: 'LOAD', outcome: 'COMPLETED' },
    grossCents: gross,
    money: { 'Base Rate': gross },
    at: `${TRIP}/${loadId}`,
  }) as unknown as RemittanceRow

const readingOf = (rows: RemittanceRow[]): RemittanceReading =>
  ({
    rows,
    summary: { invoiceNumber: 'AZNG-TEST' },
    totals: { headerCents: rows.reduce((s, r) => s + r.grossCents, 0) },
  }) as unknown as RemittanceReading

const leg = (id: string, rate: number, closedHistory = false): FreightRef => ({
  id,
  loadNumber: id,
  reference: TRIP,
  totalRevenueCents: rate,
  closedHistory,
})

describe('a trip with three legs', () => {
  // Three legs, rates summing to 30000, and Amazon remits exactly that.
  const legs = [leg('A', 9460), leg('B', 12400), leg('C', 8140)]
  const freight = new Map([[TRIP, legs]])

  it('is MATCHED when the remitted total equals the sum of the rates', () => {
    // Before the ruling this compared 30000 against ONE leg — 9460, say — and
    // called the trip over by $205.40.
    const preview = previewRemittance(
      readingOf([
        rowUnderTrip('v1', 10000),
        rowUnderTrip('v2', 12000),
        rowUnderTrip('v3', 8000),
      ]),
      freight,
    )
    expect(preview.counts.matched_exact).toBe(1)
    expect(preview.counts.over).toBe(0)
    const line = preview.lines[0]!
    expect(line.ratedCents).toBe(30000)
    expect(line.remittedCents).toBe(30000)
    expect(line.deltaCents).toBe(0)
  })

  it('gives EACH LEG ITS OWN RATE when the group matches', () => {
    // The ruling's words. `apportionCents` with weights that sum to the total
    // returns the weights, so this is exact rather than approximately fair.
    const preview = previewRemittance(
      readingOf([rowUnderTrip('v1', 30000)]),
      freight,
    )
    expect([...preview.lines[0]!.appliedCents]).toEqual([9460, 12400, 8140])
  })

  it('names EVERY leg, not one of them', () => {
    const preview = previewRemittance(
      readingOf([rowUnderTrip('v1', 30000)]),
      freight,
    )
    expect(preview.lines[0]!.loads.map((l) => l.id)).toEqual(['A', 'B', 'C'])
  })

  it('counts the trip ONCE and touches all three loads', () => {
    const preview = previewRemittance(
      readingOf([rowUnderTrip('v1', 30000)]),
      freight,
    )
    expect(preview.lines).toHaveLength(1)
    expect(preview.loadsTouched).toBe(3)
  })

  // ── SHORT AND OVER ARE STILL SHORT AND OVER ───────────────────────────
  it('is SHORT on the group when the total falls below the sum', () => {
    const preview = previewRemittance(
      readingOf([rowUnderTrip('v1', 29000)]),
      freight,
    )
    expect(preview.counts.short).toBe(1)
    expect(preview.lines[0]!.deltaCents).toBe(-1000)
  })

  it('is OVER on the group when the total exceeds the sum', () => {
    const preview = previewRemittance(
      readingOf([rowUnderTrip('v1', 31000)]),
      freight,
    )
    expect(preview.counts.over).toBe(1)
    expect(preview.lines[0]!.deltaCents).toBe(1000)
  })

  it('apportions a SHORT total so the parts still sum to the cash', () => {
    // NO CENT BELONGS TO NOBODY. 29999 across 9460/12400/8140 cannot divide
    // evenly, and three roundings that each look right lose one.
    const preview = previewRemittance(
      readingOf([rowUnderTrip('v1', 29999)]),
      freight,
    )
    const applied = preview.lines[0]!.appliedCents
    expect(applied.reduce((a, b) => a + b, 0)).toBe(29999)
    expect(applied).toHaveLength(3)
  })

  it('apportions an OVER total so the parts still sum to the cash', () => {
    const preview = previewRemittance(
      readingOf([rowUnderTrip('v1', 30001)]),
      freight,
    )
    const applied = preview.lines[0]!.appliedCents
    expect(applied.reduce((a, b) => a + b, 0)).toBe(30001)
  })

  // ── CLOSED HISTORY STILL WINS, AND TAKES THE WHOLE GROUP ──────────────
  it('treats the whole group as closed history if ANY leg is closed', () => {
    // A trip should not straddle the books cutover. If one ever does, applying
    // part of its payment while excluding the rest produces a payment nobody
    // can reconcile — so nothing is applied and the cash stays visibly
    // unapplied.
    const mixed = new Map([
      [TRIP, [leg('A', 9460), leg('B', 12400, true), leg('C', 8140)]],
    ])
    const preview = previewRemittance(
      readingOf([rowUnderTrip('v1', 30000)]),
      mixed,
    )
    expect(preview.counts.matched_closed_history).toBe(1)
    expect([...preview.lines[0]!.appliedCents]).toEqual([0, 0, 0])
  })
})

describe('a single-leg trip, which is most of them', () => {
  const freight = new Map([[TRIP, [leg('A', 45000)]]])

  it('behaves exactly as it did before the ruling', () => {
    // THE REGRESSION GUARD. The ruling must not change the ordinary case: a
    // group of one compares its own rate and takes the whole amount.
    const matched = previewRemittance(
      readingOf([rowUnderTrip('v1', 45000)]),
      freight,
    )
    expect(matched.counts.matched_exact).toBe(1)
    expect([...matched.lines[0]!.appliedCents]).toEqual([45000])

    const short = previewRemittance(
      readingOf([rowUnderTrip('v1', 44000)]),
      freight,
    )
    expect(short.counts.short).toBe(1)
    expect(short.lines[0]!.deltaCents).toBe(-1000)
    expect([...short.lines[0]!.appliedCents]).toEqual([44000])
  })
})
