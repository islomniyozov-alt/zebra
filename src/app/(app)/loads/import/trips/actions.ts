'use server'

import { revalidatePath } from 'next/cache'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { ensureRelayCustomer } from '@/lib/relay-import'
import { parseTripsCsv } from '@/lib/trips-csv'
import { filesAsDelivered, tripRowView } from '@/lib/trips-preview'
import {
  nearMissWarnings,
  planSignature,
  planTrips,
  type TripGrouping,
} from '@/lib/trips-import'
import {
  createTripLoad,
  enrichLoad,
  planTripWrite,
  resolveFacilities,
  resolveTripCrew,
  facilitiesMissingAddress,
  tripChunks,
  tripFacilityCodes,
  TRIPS_IMPORT_TIMEOUT_MS,
  type TripCrew,
} from '@/lib/trips-writer'
import { crewSeatFor, type CrewSeat } from '@/lib/trips-crew'
import { INTEGRATION_USER_AGENT } from '@/lib/load-activity'
import { EMPTY_TRIPS_IMPORT, type TripsImportState } from './state'

// Loads → Import → Amazon Relay TRIPS (Phase 6 §3a's sibling).
//
// PREVIEW THEN CONFIRM, like the load-board import beside it, and for the same
// reason: this writes freight in bulk and a dispatcher must see what it will do
// before it does it.
//
// THE PREVIEW AND THE WRITE USE THE SAME FUNCTIONS. `planTripWrite` decides
// create-versus-enrich in both passes, so the sentence someone confirms is
// produced by the code that later acts rather than by a description of it.
//
// NO MODEL CALL ANYWHERE ON THIS PATH. The trips export is a table; reading it
// is parsing, not extraction, and nothing here spends a cent.

/**
 * The ids a seat decision yields, or null when it yielded none.
 *
 * A REFUSAL AND AN EMPTY COLUMN COLLAPSE TO THE SAME THING HERE, and only here:
 * the write does not care WHY there is nobody to seat, and the preview has
 * already told the dispatcher which of the two it was. Flattening earlier would
 * have lost the distinction the report is made of.
 */
function seatOrNothing(seat: CrewSeat): TripCrew | null {
  if (seat.kind !== 'seated') return null
  if (seat.driverId === null && seat.truckId === null) return null
  return { driverId: seat.driverId, truckId: seat.truckId }
}

export async function tripsImportAction(
  _previous: TripsImportState,
  formData: FormData,
): Promise<TripsImportState> {
  const { t, locale } = await getLocaleContext()

  if (!(await currentUserCan('create', 'load'))) {
    return { ...EMPTY_TRIPS_IMPORT, error: t('ref.error.required') }
  }

  // §1.3'S MONEY WALL, ON THE WRITE SIDE. A role that may not see money does
  // not get to write it either, so a DISPATCHER's import books the freight and
  // leaves the rate for somebody who may enter one. Same posture as the board
  // importer beside it, decided by the same permission.
  const maySeeMoney = await currentUserCan('update', 'load.financials')

  const csv = String(formData.get('csv') ?? '')
  const companyId = String(formData.get('companyId') ?? '')
  const acknowledged = String(formData.get('signature') ?? '')
  // THE ESCAPE HATCH, ARRIVING AS A FIELD ON THE SAME FORM. The preview's
  // second button posts the file it already has with `grouping=row`, so the
  // hatch costs no navigation and no re-choosing of the file — which is what
  // made the old cross-link a trap rather than an option.
  const grouping: TripGrouping =
    formData.get('grouping') === 'row' ? 'row' : 'trip'

  if (csv.trim() === '') {
    return { ...EMPTY_TRIPS_IMPORT, error: t('relay.error.noFile') }
  }

  const { legs, problems } = parseTripsCsv(csv)
  if (legs.length === 0) {
    return { ...EMPTY_TRIPS_IMPORT, error: t('trips.error.noTrips') }
  }

  const plan = planTrips(legs, grouping)
  const signature = planSignature(plan)

  // --- what it would do, decided against the database ----------------------
  const decided = await withCurrentOrg('read', 'load', async (tx) => {
    const references = plan.trips.map((trip) => trip.tripId)
    const existing = await tx.load.findMany({
      where: { deletedAt: null, referenceNumber: { not: null } },
      select: { referenceNumber: true },
      take: 5_000,
    })

    const codes = [...new Set(plan.trips.flatMap(tripFacilityCodes))]
    const facilities = await resolveFacilities(tx, codes)
    // TWO QUERIES FOR THE WHOLE FILE, not two per trip — see `resolveTripCrew`.
    // The preview resolves the crew with the same function the write does, which
    // is the same reason `planTripWrite` is shared: the sentence a dispatcher
    // confirms is produced by the code that later acts.
    const resolveCrew = await resolveTripCrew(tx, plan.trips)

    const rows = []
    for (const trip of plan.trips) {
      const write = await planTripWrite(tx, trip)
      const crew = crewSeatFor(trip, resolveCrew)
      // TWO DIFFERENT PROBLEMS, COUNTED SEPARATELY (item 2, round 2).
      //
      // `unresolved` has always meant "the book has no row for this code" —
      // the import writes the code as the stop name and nothing else. Widening
      // it to cover a facility that HAS a row and no street would change what
      // that number has meant since it was written, and the two need different
      // fixes: one is a missing facility, the other is a facility missing a
      // street. MEM4-DRAY on load 1013 is the second, and was invisible.
      const unresolved = tripFacilityCodes(trip).filter(
        (code) => !facilities.has(code),
      )
      const noAddress = facilitiesMissingAddress(
        tripFacilityCodes(trip),
        facilities,
      )
      rows.push({ trip, write, unresolved, noAddress, crew })
    }

    return {
      rows,
      near: nearMissWarnings(
        plan,
        existing
          .map((load) => load.referenceNumber)
          .filter((value): value is string => value !== null),
      ),
      references,
    }
  })

  const view = {
    // ONE BUILDER FOR THE ROW, in src/lib/trips-preview.ts, where a test can
    // reach it. The money key is added there or not at all — §1.3 wants the
    // field ABSENT from the payload for a role that may not see it, and an
    // action nothing can call is where that promise would go unchecked.
    rows: decided.rows.map(({ trip, write, unresolved, crew }) =>
      tripRowView(
        trip,
        write,
        unresolved,
        {
          create: t('trips.action.create'),
          unchanged: t('trips.action.unchanged'),
          cancelled: t('trips.action.cancelled'),
          addsStops: t('trips.action.addsStops'),
          addsMiles: t('trips.action.addsMiles'),
          addsActuals: t('trips.action.addsActuals'),
          marksDelivered: t('trips.action.marksDelivered'),
          closedHistory: t('trips.action.closedHistory'),
          seatsCrew: t('trips.action.seatsCrew'),
          driver: t('trips.crew.driver'),
          truck: t('trips.crew.truck'),
          matchesNobody: t('trips.crew.matchesNobody'),
          matchesTwo: t('trips.crew.matchesTwo'),
          fileDisagrees: t('trips.crew.fileDisagrees'),
          rateFromRow: t('trips.rate.fromRow'),
          rateFromLegs: t('trips.rate.fromLegs'),
        },
        { maySeeMoney, locale },
        crew,
      ),
    ),
    warnings: [
      ...plan.warnings.map((warning) => `${warning.tripId}: ${warning.detail}`),
      ...decided.near.map((warning) => `${warning.tripId}: ${warning.detail}`),
      ...problems.map(
        (problem) => `${t('trips.row')} ${problem.row}: ${problem.detail}`,
      ),
    ],
    createCount: 0,
    enrichCount: 0,
    unchangedCount: 0,
    cancelledCount: 0,
    closedCount: 0,
    deliveredCount: 0,
    crewSeatedCount: 0,
    skippedLegTotal: plan.trips.reduce(
      (sum, trip) => sum + trip.cancelledLegs,
      0,
    ),
    noAddressCodes: [...new Set(decided.rows.flatMap((row) => row.noAddress))],
    // ── THE COUNTS THE RULING ASKED FOR, BY NAME WHERE THEY HAVE NAMES ──────
    //
    // "preview first with counts (create / update / delivered / crew seated /
    // refusals by name)". Create and update are counted from the rows below;
    // these three are the ruling's other three, and the refusals are LINES
    // rather than a number because a count of refusals is not something a
    // dispatcher can act on. See `crewRefusalLine`.
    crewRefusals: [
      ...new Set(
        decided.rows.flatMap((row) =>
          row.crew.kind === 'refused'
            ? row.crew.reasons.map(
                (reason) =>
                  `${row.trip.tripId}: ${reason.column} “${reason.value}”`,
              )
            : [],
        ),
      ),
    ],
    unresolvedCodes: [
      ...new Set(decided.rows.flatMap((row) => row.unresolved)),
    ],
    showsMoney: maySeeMoney,
    // THERE IS ONE SCREEN NOW, so these two numbers stopped being "which
    // screen am I on" and became the escape hatch's arithmetic: rowCount is
    // what one-load-per-row would produce, tripCount is what this preview
    // holds, and the hatch prints both so choosing it is a decision.
    tripCount: plan.trips.length,
    rowCount: legs.length,
    grouping,
    stageCounts: {
      upcoming: plan.trips.filter((trip) => trip.stage === 'upcoming').length,
      running: plan.trips.filter((trip) => trip.stage === 'running').length,
      finished: plan.trips.filter((trip) => trip.stage === 'finished').length,
    },
  }

  view.createCount = view.rows.filter((row) => row.action === 'create').length
  view.enrichCount = view.rows.filter((row) => row.action === 'enrich').length
  view.unchangedCount = view.rows.filter(
    (row) => row.action === 'unchanged',
  ).length
  // COUNTED SEPARATELY. A cancelled load folded into "already complete" would
  // read as freight that needs nothing, when it is freight somebody stopped.
  view.cancelledCount = view.rows.filter(
    (row) => row.action === 'cancelled',
  ).length
  // CLOSED HISTORY IS ITS OWN NUMBER. Folding it into "already complete" would
  // report settled freight as needing nothing, which is true and beside the
  // point: the import DECLINED to touch it, and that is the fact.
  view.closedCount = view.rows.filter((row) => row.action === 'closed').length
  // COUNTED OFF THE ROWS, not recomputed from the plan. The row is what the
  // dispatcher reads, so a number beside it that came from anywhere else is a
  // second reader free to disagree with the first.
  view.crewSeatedCount = view.rows.filter((row) => row.seatsCrew).length
  // DELIVERED: what the write would FILE as delivered, which is not the same as
  // the file's Completed count — a trip whose load is already POD_RECEIVED moves
  // nothing, and a closed or cancelled one is refused.
  view.deliveredCount = decided.rows.filter(({ trip, write }) =>
    filesAsDelivered(trip, write),
  ).length

  // --- preview ---------------------------------------------------------------
  if (acknowledged === '') {
    return { ...EMPTY_TRIPS_IMPORT, plan: view, signature }
  }

  // THE FILE CHANGED UNDER THE CONFIRM. Refuse and show the new preview rather
  // than writing what nobody looked at.
  if (acknowledged !== signature) {
    return { ...EMPTY_TRIPS_IMPORT, plan: view, signature, stale: true }
  }

  if (companyId === '') {
    return {
      ...EMPTY_TRIPS_IMPORT,
      plan: view,
      signature,
      error: t('ref.error.required'),
    }
  }

  // --- write -----------------------------------------------------------------
  let created = 0
  let enriched = 0

  // ── ONE TRANSACTION PER CHUNK, NOT ONE FOR THE FILE ──────────────────────
  //
  // See `TRIPS_PER_TRANSACTION`: a month's export needs about 300 seconds of
  // round trips and `LOAD_WRITE_TIMEOUT_MS` is 20. The chunking is safe because
  // the import is idempotent by trip id, which is the ruling's own clause —
  // a re-upload finishes what a failed chunk left.
  for (const chunk of tripChunks(plan.trips)) {
    await withCurrentOrg(
      'create',
      'load',
      async (tx, session) => {
        // THE SAME CUSTOMER THE BOARD IMPORTER MAKES, from the same function.
        //
        // This used to call `resolveBroker`, which creates a customer with a
        // name and nothing else — so `settlesDirectly` took its `false` default
        // and every trips-imported load was booked `directSettled: false`. That
        // is not cosmetic: `directSettled` decides the whole load-detail screen
        // AND whether Delivered carries the POD, so those loads got the broker
        // screen and never became payable.
        //
        // WORSE, IT WAS ORDER-DEPENDENT. Both paths look the customer up by name
        // first, so whichever importer ran first in an organisation decided what
        // Amazon Relay was for every load booked after it — and could decide it
        // differently on dev than in production.
        const { id: customerId } = await ensureRelayCustomer(
          tx,
          session.organizationId,
        )
        // THE CHUNK'S CODES AND NAMES, not the file's. A few extra queries per
        // chunk beats holding a map of the whole month in a transaction that only
        // writes twenty trips.
        const codes = [...new Set(chunk.flatMap(tripFacilityCodes))]
        const facilities = await resolveFacilities(tx, codes)
        // THE SAME FUNCTION THE PREVIEW CALLED, against the roster as it is NOW.
        // Resolved again rather than carried over from the preview: a driver added
        // between the two round trips should be seated, and a resolution posted
        // back through a form is a resolution a browser could have edited.
        const resolveCrew = await resolveTripCrew(tx, chunk)

        for (const trip of chunk) {
          const write = await planTripWrite(tx, trip)
          // A REFUSED TRIP IS WRITTEN WITHOUT ITS CREW, not skipped. The freight
          // ran and belongs on the books; the seat is what could not be decided,
          // and the preview named it so somebody can fix the roster and re-upload.
          const crew = seatOrNothing(crewSeatFor(trip, resolveCrew))

          if (write.action === 'enrich') {
            const outcome = await enrichLoad(
              tx,
              session.organizationId,
              write.loadId,
              trip,
              facilities,
              write,
              maySeeMoney ? trip.rateCents : null,
              session.userId ?? null,
              crew,
            )
            if (outcome.kind === 'enriched') enriched++
            continue
          }

          // THE WRITE LIVES IN `trips-writer.ts`, NOT HERE. It used to be inline
          // and mapped the stop rows by hand, with `place` where `createLoad`
          // wanted `name` — a key nothing typechecked and nothing could test,
          // because this file is 'use server' and a test cannot call it. Every
          // stop would have landed nameless.
          await createTripLoad(
            tx,
            session.organizationId,
            {
              trip,
              companyId,
              customerId,
              rateCents: maySeeMoney ? trip.rateCents : null,
              crew,
            },
            facilities,
            session.userId ?? null,
          )
          created++
        }
      },
      // STAMPED AS THE INTEGRATION. A dispatcher clicks confirm; a file does
      // the work. The Activity panel reads this to say "via Integration"
      // instead of naming a person who never typed a stop time. See
      // load-activity.ts.
      {
        timeoutMs: TRIPS_IMPORT_TIMEOUT_MS,
        userAgent: INTEGRATION_USER_AGENT,
      },
    )
  }

  revalidatePath('/loads')
  return { ...EMPTY_TRIPS_IMPORT, created, enriched }
}
