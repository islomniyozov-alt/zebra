import { apportionCents } from '../money'
import type { RemittanceReading, RemittanceRow } from './remittance'

// ---------------------------------------------------------------------------
// WHAT A REMITTANCE WOULD DO, COUNTED, BEFORE ANYTHING IS WRITTEN.
//
// ── THREE KEYS, THREE BRANCHES ───────────────────────────────────────────
//
// The detail sheet holds three shapes of row and they are keyed differently.
// Measured across six weeks, every row is exactly one of them and none is
// neither:
//
//   TOUR-*            Trip ID, no Load ID     — the tour's own base pay, and
//                                               a cancelled tour's TONU
//   LOAD under a trip Trip ID AND Load ID     — accessorials beneath a tour
//   LOAD, single      Load ID, no Trip ID     — freight with no tour
//
// `TOUR - CANCELLED` is the branch a four-value model loses: it carries a Trip
// ID and no Load ID, so a rule reading "rows with no Trip ID are single loads,
// keyed by Load ID" leaves it with no key at all. It is absent from two of the
// six weeks, which is how a reader comes to be written without it.
//
// ── THE NAMESPACES DO NOT MIX, AND THAT IS CHECKED RATHER THAN ASSUMED ───
//
// All 51 Trip IDs in the first week start `T-`; none of the 183 Load IDs does;
// the exact intersection is empty and so is the near-miss set under
// `isPrefixNearMiss`. The law from `trips-import.ts` holds: `T-115M68R2H` and
// `115M68R2H` are DIFFERENT references until a human says otherwise. So a trip
// key is matched against trip references and a load key against load
// references, and nothing is stripped to make a match.
// ---------------------------------------------------------------------------

/** How a remittance row is keyed against freight. */
export type RowKey =
  | { branch: 'tour'; tripId: string }
  | { branch: 'load_under_trip'; tripId: string; loadId: string }
  | { branch: 'single_load'; loadId: string }
  | { branch: 'unkeyable' }

export function keyFor(row: RemittanceRow): RowKey {
  if (row.item?.scope === 'TOUR') {
    // A TOUR IS KEYED ON ITS TRIP, whatever its outcome. Completed or
    // cancelled, the Trip ID is the only reference it carries.
    return row.tripId
      ? { branch: 'tour', tripId: row.tripId }
      : { branch: 'unkeyable' }
  }
  if (row.tripId && row.loadId) {
    return { branch: 'load_under_trip', tripId: row.tripId, loadId: row.loadId }
  }
  if (row.loadId) return { branch: 'single_load', loadId: row.loadId }
  return { branch: 'unkeyable' }
}

/**
 * The outcomes a preview counts.
 *
 * FIVE, NOT FOUR. The design named matched / short / over / unmatched. The
 * database says a fifth dominates: of the loads a remittance can be matched
 * to, nearly all are already `CLOSED_IN_DATATRUCK` — freight imported from the
 * system that ran it, which this one has ruled is not its to settle.
 *
 * Folding those into `matched` would report a week as fully reconciled and
 * then apply payments to loads the settlement engine deliberately cannot see.
 * Folding them into `unmatched` would say Amazon paid for freight Zebra never
 * saw, which is false and would invite somebody to create it. It is its own
 * row because it is its own decision, and it is the biggest number on the
 * page.
 */
export type MatchOutcome =
  | 'matched_exact'
  | 'short'
  | 'over'
  | 'matched_closed_history'
  | 'unmatched'
  | 'unkeyable'

export interface FreightRef {
  id: string
  loadNumber: string
  reference: string
  totalRevenueCents: number
  closedHistory: boolean
}

export interface PreviewLine {
  outcome: MatchOutcome
  key: RowKey
  remittedCents: number
  /**
   * EVERY load sharing this reference, not one of them.
   *
   * Owner's ruling, 2026-09-25: remittance matching aggregates by trip. This
   * was `load: FreightRef | null`, a single row, and for a trip with several
   * legs the map handed back whichever leg happened to be written last — so a
   * trip's whole remitted total was compared against ONE leg's rate. On the
   * 2026-09-13..19 week that produced seven loads reported `over` by four to
   * eight times, $749.57 against $94.60 among them.
   *
   * Empty for `unmatched` and `unkeyable`, which have no freight at all.
   */
  loads: readonly FreightRef[]
  /**
   * THE DENOMINATOR: the sum of the group's rates.
   *
   * The whole of the 2026-09-25 ruling is that this is what `remittedCents` is
   * compared against. Zero when nothing matched.
   */
  ratedCents: number
  /**
   * What each load in `loads` takes of `remittedCents`, in the same order.
   *
   * COMPUTED HERE SO THE WRITE CANNOT INVENT IT. For a matched group this is
   * each load's own rate exactly — `apportionCents` with weights that sum to
   * the total returns the weights — which is the ruling's "each at its own
   * rate". For a short or over group it is the remitted total apportioned by
   * rate, largest-remainder, so the parts sum to the cash that actually
   * arrived and no cent belongs to nobody.
   */
  appliedCents: readonly number[]
  /** `remittedCents - ratedCents`. Negative is short, positive is over. */
  deltaCents: number
}

export interface Preview {
  lines: PreviewLine[]
  counts: Record<MatchOutcome, number>
  cents: Record<MatchOutcome, number>
  /** Distinct freight rows the week touches, however many lines hit each. */
  loadsTouched: number
}

const ZERO: Record<MatchOutcome, number> = {
  matched_exact: 0,
  short: 0,
  over: 0,
  matched_closed_history: 0,
  unmatched: 0,
  unkeyable: 0,
}

/**
 * Group the rows into payable units, then place each against freight.
 *
 * A TOUR AND THE LOADS BENEATH IT ARE ONE UNIT. The tour row carries the base
 * and the loads beneath carry the accessorials — measured: in week one the 46
 * completed tours hold $53,020.25 of base and the 96 loads under them hold
 * $13,460.71 of everything else. Paying them as separate units would file the
 * same trip's money twice.
 */
export function previewRemittance(
  reading: RemittanceReading,
  /**
   * EVERY load per reference, not one.
   *
   * A trip with three legs has three Zebra loads carrying the same
   * `referenceNumber`, and a `Map<string, FreightRef>` could only hold the last
   * of them — silently, which is how a trip's total came to be compared against
   * one leg's rate.
   */
  freightByReference: ReadonlyMap<string, readonly FreightRef[]>,
): Preview {
  const units = new Map<string, { key: RowKey; cents: number }>()

  for (const row of reading.rows) {
    const key = keyFor(row)
    const reference =
      key.branch === 'tour' || key.branch === 'load_under_trip'
        ? key.tripId
        : key.branch === 'single_load'
          ? key.loadId
          : `unkeyable:${String(row.at)}`

    const existing = units.get(reference)
    if (existing) {
      existing.cents += row.grossCents
      // A tour row and the loads beneath it collapse to the tour's branch, so
      // the unit is described by what it is rather than by whichever row
      // happened to arrive first.
      if (key.branch === 'tour') existing.key = key
    } else {
      units.set(reference, { key, cents: row.grossCents })
    }
  }

  const lines: PreviewLine[] = []
  const touched = new Set<string>()

  for (const [reference, unit] of units) {
    if (unit.key.branch === 'unkeyable') {
      lines.push({
        outcome: 'unkeyable',
        key: unit.key,
        remittedCents: unit.cents,
        loads: [],
        ratedCents: 0,
        appliedCents: [],
        deltaCents: 0,
      })
      continue
    }

    const group = freightByReference.get(reference) ?? []
    if (group.length === 0) {
      lines.push({
        outcome: 'unmatched',
        key: unit.key,
        remittedCents: unit.cents,
        loads: [],
        ratedCents: 0,
        appliedCents: [],
        deltaCents: 0,
      })
      continue
    }

    for (const load of group) touched.add(load.id)

    // ── THE DENOMINATOR IS THE GROUP, BY RULING ─────────────────────────
    //
    // Owner's ruling, 2026-09-25. A trip's remitted total is compared against
    // the SUM of its legs' rates. Compared against one leg it read `over` by
    // four to eight times on the first real week.
    const ratedCents = group.reduce(
      (sum, load) => sum + load.totalRevenueCents,
      0,
    )
    const delta = unit.cents - ratedCents

    // CLOSED HISTORY IS DECIDED BEFORE THE MONEY IS COMPARED. Whether an
    // imported load was paid short is not a question this system is going to
    // act on, and reporting it as `short` would put it in a queue somebody is
    // expected to work.
    //
    // ANY LEG CLOSED MAKES THE WHOLE GROUP CLOSED, and nothing is applied. A
    // trip should not straddle the books cutover — its legs deliver in one
    // week — but if one ever does, applying part of a trip's payment while
    // excluding the rest produces a payment nobody can reconcile. Under-
    // applying is the safe direction and it is VISIBLE: the cash lands in
    // `unappliedCents` rather than disappearing.
    const anyClosed = group.some((load) => load.closedHistory)
    const outcome: MatchOutcome = anyClosed
      ? 'matched_closed_history'
      : delta === 0
        ? 'matched_exact'
        : delta < 0
          ? 'short'
          : 'over'

    lines.push({
      outcome,
      key: unit.key,
      remittedCents: unit.cents,
      loads: group,
      ratedCents,
      // Nothing is applied to closed history, by the rule above.
      appliedCents: anyClosed
        ? group.map(() => 0)
        : apportionCents(
            unit.cents,
            group.map((load) => load.totalRevenueCents),
          ),
      deltaCents: delta,
    })
  }

  const counts = { ...ZERO }
  const cents = { ...ZERO }
  for (const line of lines) {
    counts[line.outcome] += 1
    cents[line.outcome] += line.remittedCents
  }

  return { lines, counts, cents, loadsTouched: touched.size }
}
