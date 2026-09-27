// ---------------------------------------------------------------------------
// WHO THE RELAY FILE PUTS IN THE SEATS, AND WHEN IT REFUSES TO SAY.
//
// Owner's ruling, 2026-09-27: a bulk completed Relay file seats the driver and
// the truck from its own columns, by unique name and unique unit.
//
// ── THIS SUPERSEDES RULE 7, WHICH SAID SO ITSELF ──────────────────────────
//
// `trips-writer.ts` carried "driver or truck. Rule 7: the CSV's names are
// informational until name-matching is its own ruled feature." The names were
// parsed, shown in the preview, and never written. This ruling is that feature,
// which is the condition Rule 7 named for its own replacement — so the rule is
// superseded rather than broken, and the note there now points here.
//
// ── THE SAME THREE REFUSALS AS `crewFillFor` ──────────────────────────────
//
// The Datatruck importer's crew rule refuses a name matching nobody, a name
// matching two people, and a person already in the other seat. This does the
// same for the same reason: a seat filled by a guess is money paid to somebody
// who did not drive, and the driver finds out on Friday. Two importers, one
// posture, and the posture is stated in both places rather than inferred.
//
// ── A TRIP CARRYING TWO NAMES IS NOT A TEAM ───────────────────────────────
//
// `PlannedTrip.driverNames` is the DISTINCT set across the trip's usable legs,
// so two names means the legs disagree about who drove — a relay handoff, or a
// file covering a driver change mid-trip. That is not the same fact as a team
// run, which the Datatruck export states per load in its own `Co-Driver`
// column. Seating either of them would be a guess about which, so the trip is
// refused and both names are reported.
//
// MEASURED on `Trips - 2026-09-24T090710.426.csv`: 200 rows, 152 trips, and the
// file's own `Transit Operator Type` calls 198 rows Single Driver and 2 Team
// Driver — so the ambiguous case is rare and real, and worth naming rather than
// resolving.
// ---------------------------------------------------------------------------

/**
 * WHETHER A TRIP AT THIS STAGE GETS ITS CREW FROM THE FILE.
 *
 * ── ONLY A FINISHED TRIP, AND THE REASON IS THE DISPATCH GUARD ────────────
 *
 * The ruling is about bulk COMPLETED files, and the restriction is not mere
 * literalism. Writing a seat onto live freight is a dispatch, and a dispatch
 * runs `assertAssignable`: no INACTIVE driver, no SOLD truck, no asset whose
 * open assignment period is at another company, no overlapping load. Those
 * rules are correct about a plan.
 *
 * A COMPLETED ROW IS NOT A PLAN. It says who drove, past tense, and every one
 * of those four guards would refuse a true statement about it:
 *
 *   * roster-INACTIVE is admitted by ruling (2026-09-25) — "who drove it drove
 *     it", and the exclusion lives on new dispatch only;
 *   * a month's export names drivers across six companies while the import form
 *     picks one, so `other_authority` would refuse most of the file;
 *   * two of a driver's finished trips in one week overlap on paper, because
 *     their clocks came from two different exports.
 *
 * A bulk import is one transaction, so one refusal loses the file. So finished
 * trips get their seats written directly and live ones keep Rule 7's posture:
 * the names are shown and a human dispatches. The preview says which.
 */
export function stageSeatsCrew(stage: string): boolean {
  return stage === 'finished'
}

/** What the file's columns resolve to for one trip. */
export type CrewSeat =
  | { kind: 'seated'; driverId: string | null; truckId: string | null }
  | { kind: 'refused'; reasons: CrewRefusal[] }

export interface CrewRefusal {
  /** `driver` or `truck`, so a report can group them. */
  column: 'driver' | 'truck'
  /** Exactly what the file said, for a report that names it. */
  value: string
  why: 'matches_nobody' | 'matches_two' | 'file_disagrees'
}

export interface CrewResolvers {
  /** Every driver id this name resolves to. Empty, one, or several. */
  driverIdsFor: (name: string) => readonly string[]
  /** Every truck id this unit number resolves to. */
  truckIdsFor: (unit: string) => readonly string[]
}

/**
 * Seat the driver and the truck a Relay trip names, or refuse and say why.
 *
 * BOTH SEATS ARE DECIDED INDEPENDENTLY and a refusal on one does not lose the
 * other: a trip whose truck is ambiguous still seats its driver, because the
 * driver is who gets paid and the truck is a link. The refusals accumulate so
 * the preview can name every one.
 *
 * AN EMPTY COLUMN IS NOT A REFUSAL. 7 of the fixture's 200 rows carry no driver
 * name and 9 no tractor; a file that simply does not say is not a file saying
 * something wrong, and counting it as a refusal would bury the nine that are.
 */
export function crewSeatFor(
  trip: { driverNames: readonly string[]; tractorIds: readonly string[] },
  resolve: CrewResolvers,
): CrewSeat {
  const reasons: CrewRefusal[] = []

  const driverId = pick(
    trip.driverNames,
    'driver',
    resolve.driverIdsFor,
    reasons,
  )
  const truckId = pick(trip.tractorIds, 'truck', resolve.truckIdsFor, reasons)

  if (reasons.length > 0) return { kind: 'refused', reasons }
  return { kind: 'seated', driverId, truckId }
}

function pick(
  values: readonly string[],
  column: 'driver' | 'truck',
  idsFor: (value: string) => readonly string[],
  reasons: CrewRefusal[],
): string | null {
  const named = values.map((value) => value.trim()).filter((v) => v !== '')
  if (named.length === 0) return null

  // THE FILE DISAGREEING WITH ITSELF IS ITS OWN REFUSAL, distinct from a name
  // that cannot be found. One is a data question for the fleet and the other is
  // a roster question for the office.
  if (named.length > 1) {
    reasons.push({ column, value: named.join(' / '), why: 'file_disagrees' })
    return null
  }

  const only = named[0]!
  const hits = idsFor(only)
  if (hits.length === 0) {
    reasons.push({ column, value: only, why: 'matches_nobody' })
    return null
  }
  if (hits.length > 1) {
    reasons.push({ column, value: only, why: 'matches_two' })
    return null
  }
  return hits[0]!
}

/**
 * The key both sides of a name match are compared on.
 *
 * RE-EXPORTED, NOT REWRITTEN. This was a local copy that upper-cased while the
 * Datatruck seed's lower-cased, under a comment claiming the two were the same
 * normalisation — which is exactly the thing `name-key.ts` now exists to make
 * unrepeatable. The name stays so the call sites here read in this module's
 * vocabulary; the behaviour is the shared function's.
 */
export { nameKey as crewNameKey } from './name-key'
