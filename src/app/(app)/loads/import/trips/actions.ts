'use server'

import { revalidatePath } from 'next/cache'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { ensureRelayCustomer } from '@/lib/relay-import'
import { parseTripsCsv } from '@/lib/trips-csv'
import { tripRowView } from '@/lib/trips-preview'
import { nearMissWarnings, planSignature, planTrips } from '@/lib/trips-import'
import {
  createTripLoad,
  enrichLoad,
  planTripWrite,
  resolveFacilities,
  tripFacilityCodes,
} from '@/lib/trips-writer'
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

  if (csv.trim() === '') {
    return { ...EMPTY_TRIPS_IMPORT, error: t('relay.error.noFile') }
  }

  const { legs, problems } = parseTripsCsv(csv)
  if (legs.length === 0) {
    return { ...EMPTY_TRIPS_IMPORT, error: t('trips.error.noTrips') }
  }

  const plan = planTrips(legs)
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

    const rows = []
    for (const trip of plan.trips) {
      const write = await planTripWrite(tx, trip)
      const unresolved = tripFacilityCodes(trip).filter(
        (code) => !facilities.has(code),
      )
      rows.push({ trip, write, unresolved })
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
    rows: decided.rows.map(({ trip, write, unresolved }) =>
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
        },
        { maySeeMoney, locale },
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
    skippedLegTotal: plan.trips.reduce(
      (sum, trip) => sum + trip.cancelledLegs,
      0,
    ),
    unresolvedCodes: [
      ...new Set(decided.rows.flatMap((row) => row.unresolved)),
    ],
    showsMoney: maySeeMoney,
    // THE NUMBER THAT TELLS THE SCREENS APART. Both importers accept the same
    // Relay export; the difference is the unit of the output. Saying it out
    // loud is the body-level answer to "which screen am I on" that the titles
    // alone could not give.
    tripCount: plan.trips.length,
    rowCount: legs.length,
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
      const codes = [...new Set(plan.trips.flatMap(tripFacilityCodes))]
      const facilities = await resolveFacilities(tx, codes)

      for (const trip of plan.trips) {
        const write = await planTripWrite(tx, trip)

        if (write.action === 'enrich') {
          const outcome = await enrichLoad(
            tx,
            session.organizationId,
            write.loadId,
            trip,
            facilities,
            {
              hasStops: write.hasStops,
              hasMiles: write.hasMiles,
              hasRate: write.hasRate,
              hasActuals: write.hasActuals,
              isDelivered: write.isDelivered,
              isCancelled: write.isCancelled,
            },
            maySeeMoney ? trip.rateCents : null,
            session.userId ?? null,
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
          },
          facilities,
          session.userId ?? null,
        )
        created++
      }
    },
    { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
  )

  revalidatePath('/loads')
  return { ...EMPTY_TRIPS_IMPORT, created, enriched }
}
