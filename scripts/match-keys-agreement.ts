// ---------------------------------------------------------------------------
// BEFORE → AFTER, THE TRUCK SEAT'S PLATE KEY, ON THE REAL RELAY FILES
// (MONEY-DESIGN §2, amended 2026-11-17).
//
// READ-ONLY, DEV ONLY. Every corpus Relay trips export is parsed and planned
// exactly as the upload does (`parseTripsCsv` → `planTrips`), the crew is
// resolved against dev's roster through the upload's own resolver
// (`resolveTripCrew`), and each trip's truck seat is decided twice through the
// one matcher (`crewSeatFor`): BEFORE with the unit key alone (the plate
// resolver removed), AFTER with unit then plate. The new seats are listed by
// trip, tractor value and unit; a plate that lands on two trucks is listed by
// both units.
//
// The transaction is READ ONLY — Postgres refuses any write inside it — and the
// organization must be dev's by id; production's id is refused by name.
//
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/match-keys-agreement.ts
//
// Run from the live tree, where `corpus/` is. Never `source .env`.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'node:fs'
import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import { parseTripsCsv } from '@/lib/trips-csv'
import { planTrips, type PlannedTrip } from '@/lib/trips-import'
import { crewSeatFor } from '@/lib/trips-crew'
import { resolveTripCrew } from '@/lib/trips-writer'

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const DEV_ORGANIZATION_ID = 'cms5d2etl0000ncvsjz5bgdh9'
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'
const DIR = 'corpus/relay-trips'

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set (zebra_app on dev).')
  const orgId = process.env.MATCH_KEYS_ORG ?? DEV_ORGANIZATION_ID
  if (orgId === PRODUCTION_ORGANIZATION_ID)
    throw new Error('REFUSING: that is production’s organization.')

  const files = readdirSync(DIR).filter((name) => name.endsWith('.csv'))
  const trips = new Map<string, PlannedTrip>()
  for (const name of files) {
    const parsed = parseTripsCsv(readFileSync(`${DIR}/${name}`, 'utf8'))
    for (const trip of planTrips(parsed.legs).trips)
      if (!trips.has(trip.tripId)) trips.set(trip.tripId, trip)
  }
  const all = [...trips.values()]

  const db = createPrismaClient(url)
  try {
    const report = await runInOrg(
      db,
      orgId,
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`
        const resolve = await resolveTripCrew(tx, all)
        const unitOnly = {
          driverIdsFor: resolve.driverIdsFor,
          truckIdsFor: resolve.truckIdsFor,
        }
        let named = 0
        let before = 0
        let after = 0
        const added: string[] = []
        const lost: string[] = []
        const ambiguous: string[] = []
        for (const trip of all) {
          const tractors = trip.tractorIds.filter((t) => t.trim() !== '')
          if (tractors.length !== 1) continue
          named += 1
          const truckOnly = { driverNames: [], tractorIds: trip.tractorIds }
          const b = crewSeatFor(truckOnly, unitOnly)
          const a = crewSeatFor(truckOnly, resolve)
          const bTruck = b.kind === 'seated' ? b.truckId : null
          const aTruck = a.kind === 'seated' ? a.truckId : null
          if (bTruck) before += 1
          if (aTruck) after += 1
          if (aTruck && !bTruck)
            added.push(
              `${trip.tripId}  ${tractors[0]}  → unit ${resolve.truckUnitOf?.(aTruck) ?? aTruck}`,
            )
          if (bTruck && aTruck !== bTruck)
            lost.push(`${trip.tripId}  ${tractors[0]}`)
          if (a.kind === 'refused')
            for (const reason of a.reasons)
              if (reason.key === 'plate')
                ambiguous.push(
                  `${trip.tripId}  ${reason.value}  → units ${(reason.candidates ?? []).join(', ')}`,
                )
        }
        return { named, before, after, added, lost, ambiguous }
      },
      { attribution: unattributed('match-keys-agreement: read-only probe') },
    )

    console.log(
      `files ${files.length}, trips ${all.length}, trips naming one tractor ${report.named}`,
    )
    console.log(
      `TRUCK SEATED  before (unit) ${report.before}  →  after (unit, plate) ${report.after}`,
    )
    console.log(`NEW SEATS BY PLATE (${report.added.length}):`)
    for (const line of report.added) console.log(`  ${line}`)
    console.log(`AMBIGUOUS BY PLATE (${report.ambiguous.length}):`)
    for (const line of report.ambiguous) console.log(`  ${line}`)
    console.log(`LOST (${report.lost.length}) — must be 0:`)
    for (const line of report.lost) console.log(`  ${line}`)
    if (report.lost.length > 0) process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
