'use server'

import { revalidatePath } from 'next/cache'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { resolveBroker } from '@/lib/locations'
import { parseTripsCsv } from '@/lib/trips-csv'
import {
  nearMissWarnings,
  planSignature,
  planTrips,
  type PlannedTrip,
} from '@/lib/trips-import'
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

/** The customer every Relay trip belongs to. */
const RELAY_CUSTOMER_NAME = 'Amazon Relay'

const lane = (trip: PlannedTrip) =>
  trip.stops.map((stop) => stop.facilityCode).join(' → ')

export async function tripsImportAction(
  _previous: TripsImportState,
  formData: FormData,
): Promise<TripsImportState> {
  const { t } = await getLocaleContext()

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
    rows: decided.rows.map(({ trip, write, unresolved }) => ({
      tripId: trip.tripId,
      lane: lane(trip),
      stops: trip.stops.length,
      miles: trip.totalMiles === null ? '—' : String(trip.totalMiles),
      action:
        write.action === 'create'
          ? ('create' as const)
          : write.hasStops && write.hasMiles
            ? ('unchanged' as const)
            : ('enrich' as const),
      actionDetail:
        write.action === 'create'
          ? t('trips.action.create')
          : write.hasStops && write.hasMiles
            ? t('trips.action.unchanged')
            : [
                write.hasStops ? null : t('trips.action.addsStops'),
                write.hasMiles ? null : t('trips.action.addsMiles'),
              ]
                .filter(Boolean)
                .join(', '),
      skippedLegs: trip.cancelledLegs,
      unresolved,
      driver: trip.driverNames.join(', ') || '—',
      equipment: [...trip.trailerIds, ...trip.tractorIds].join(' / ') || '—',
    })),
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
    skippedLegTotal: plan.trips.reduce(
      (sum, trip) => sum + trip.cancelledLegs,
      0,
    ),
    unresolvedCodes: [
      ...new Set(decided.rows.flatMap((row) => row.unresolved)),
    ],
  }

  view.createCount = view.rows.filter((row) => row.action === 'create').length
  view.enrichCount = view.rows.filter((row) => row.action === 'enrich').length
  view.unchangedCount = view.rows.filter(
    (row) => row.action === 'unchanged',
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
      const customerId = await resolveBroker(
        tx,
        session.organizationId,
        RELAY_CUSTOMER_NAME,
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
            },
            maySeeMoney ? trip.rateCents : null,
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
        )
        created++
      }
    },
    { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
  )

  revalidatePath('/loads')
  return { ...EMPTY_TRIPS_IMPORT, created, enriched }
}
