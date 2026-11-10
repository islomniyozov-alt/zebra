import type { Prisma, TruckStatus } from '@/generated/prisma/client'
import { headingToForTrucks } from './dispatch-fields'
import { agingDaysFrom, fleetStatusChangedForTrucks } from './fleet-codes'
import { crewOfTrucks } from './team'
import type { TxClient } from './tenancy'
import {
  derivedTruckStatus,
  openLoadStatesForTrucks,
  truckOverrideOf,
  type TruckOverride,
} from './truck-list'
import { truckWarningFacts, truckWarnings, type Warning } from './warnings'

// ---------------------------------------------------------------------------
// THE TRUCKS LIST'S ROWS, READ ONCE FOR THE PAGE AND THE EXPORT
// (TMS-DESIGN-SYSTEM.md §6.5 part 1).
//
// The page formats these for a person and the export writes them as codes, but
// both read the SAME rows through this function, so a unit can never be
// described one way on screen and another way in the file that claims to be
// that screen (§7.1.5).
//
// FIVE STATEMENTS FOR THE WHOLE LIST, never one per row: the trucks, their
// compliance facts, their crews, where each is heading, and when its fleet
// status last changed. Each loader takes every id at once.
// ---------------------------------------------------------------------------

export interface TruckListRow {
  id: string
  unitNumber: string
  companyName: string
  make: string | null
  model: string | null
  year: number | null
  plate: string | null
  plateState: string | null
  vin: string | null
  /** Null means the carrier owns it (the schema's own rule). */
  ownerName: string | null
  odometer: number | null
  /** DERIVED from the override and the open loads (round two), never stored. */
  status: TruckStatus
  /** The stored manual override — In maintenance, Out of service, Sold — or null. */
  override: TruckOverride | null
  isRetired: boolean
  fleetStatus: string | null
  /** Derived from the audit log; null when nothing has ever changed it. */
  agingDays: number | null
  /** The last stop of the load this truck is on; null when idle. */
  headingTo: string | null
  /** Both seats of a team truck, first seat first. Empty when nobody holds it. */
  crew: { id: string; name: string }[]
  warnings: Warning[]
}

export interface ReadTruckRowsOptions {
  now: Date
  /** The page's cap; the export passes none and takes every row. */
  take?: number
  /**
   * `?attention=1` — keep only rows with a warning. Applied AFTER the read,
   * because warnings are computed; the page and the export both pass it, so
   * the file is the screen.
   */
  attention?: boolean
}

/** The rows under `where`, by authority then unit. */
export async function readTruckRows(
  tx: TxClient,
  where: Prisma.TruckWhereInput,
  options: ReadTruckRowsOptions,
): Promise<TruckListRow[]> {
  const trucks = await tx.truck.findMany({
    where,
    orderBy: [{ company: { name: 'asc' } }, { unitNumber: 'asc' }],
    ...(options.take !== undefined ? { take: options.take } : {}),
    select: {
      id: true,
      unitNumber: true,
      make: true,
      model: true,
      year: true,
      plate: true,
      plateState: true,
      vin: true,
      ownerName: true,
      currentOdometer: true,
      status: true,
      fleetStatus: true,
      deletedAt: true,
      company: { select: { name: true } },
      // NOT selected: purchasePriceCents. It is money, and no role in this
      // phase has a resource that grants it on a list.
    },
  })

  const ids = trucks.map((truck) => truck.id)
  const [facts, crews, headingTo, statusChanged, loadStates] =
    await Promise.all([
      truckWarningFacts(tx, ids),
      crewOfTrucks(tx, ids),
      headingToForTrucks(tx, ids),
      fleetStatusChangedForTrucks(tx, ids),
      // THE SIXTH STATEMENT (round two): the open loads, for the derived
      // status. Not folded into heading-to, which keeps closed history by
      // design.
      openLoadStatesForTrucks(tx, ids),
    ])

  const rows = trucks.map(
    (truck): TruckListRow => ({
      id: truck.id,
      unitNumber: truck.unitNumber,
      companyName: truck.company.name,
      make: truck.make,
      model: truck.model,
      year: truck.year,
      plate: truck.plate,
      plateState: truck.plateState,
      vin: truck.vin,
      ownerName: truck.ownerName,
      odometer: truck.currentOdometer,
      // DERIVED (§6.5 part 1 round two): the override if there is one, else
      // what the open loads say. The stored word is never shown as such.
      status: derivedTruckStatus(
        truck.status,
        loadStates.get(truck.id) ?? null,
      ),
      override: truckOverrideOf(truck.status),
      isRetired: truck.deletedAt !== null,
      fleetStatus: truck.fleetStatus,
      agingDays: agingDaysFrom(
        statusChanged.get(truck.id) ?? null,
        options.now,
      ),
      headingTo: headingTo.get(truck.id) ?? null,
      crew: (crews.get(truck.id) ?? []).map((member) => ({
        id: member.id,
        name: `${member.firstName} ${member.lastName}`.trim(),
      })),
      warnings: truckWarnings(
        facts.get(truck.id) ?? { compliance: [] },
        options.now,
      ),
    }),
  )

  return options.attention
    ? rows.filter((row) => row.warnings.length > 0)
    : rows
}
