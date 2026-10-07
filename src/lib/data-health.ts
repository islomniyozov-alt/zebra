import type { Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// DATA HEALTH (§6.5 part 0, queue item 18). "The office fixes data faster when
// the screen counts it." Five counts per subject, ONE DEFINITION EACH, used
// twice: as a filtered count under the grid and as the query filter the count
// links to — the same `where`, so the number and the list cannot disagree.
//
// MISSING, NOT STALE. A column is missing when null or blank; a record
// (registration, annual inspection) is missing when the truck carries no live
// ComplianceItem of that type at all. A record whose expiry has passed is
// present and stale, and the warnings column already says so — counting it
// here too would make one fact two numbers.
//
// MEASURED ON DEV, 2026-10-07, before this was written: of 119 live trucks,
// 26 no VIN, 9 no plate, 119 no odometer, 29 no registration record, 97 no
// annual-inspection record.
//
// PER SUBJECT, so the drivers list adds its own five without a second design.
// Which five is the drivers brief's to say; nothing is defined for drivers yet.
// ---------------------------------------------------------------------------

export const TRUCK_HEALTH_CHECKS = [
  'vin',
  'plate',
  'odometer',
  'registration',
  'inspection',
] as const

export type TruckHealthCheck = (typeof TRUCK_HEALTH_CHECKS)[number]

/** The `?missing=` value, or null; an unrecognised value filters nothing. */
export function truckHealthCheckFor(raw: unknown): TruckHealthCheck | null {
  return typeof raw === 'string' &&
    (TRUCK_HEALTH_CHECKS as readonly string[]).includes(raw)
    ? (raw as TruckHealthCheck)
    : null
}

/** Null or blank: the two ways a text column is empty on an imported row. */
const BLANK: Prisma.StringNullableFilter[] = [{ equals: null }, { equals: '' }]

const noLiveItem = (type: 'REGISTRATION' | 'ANNUAL_INSPECTION') =>
  ({
    complianceItems: { none: { type, deletedAt: null } },
  }) satisfies Prisma.TruckWhereInput

/**
 * The one definition, as a Prisma filter — what the link applies. Removed
 * trucks are the caller's business (`deletedAt: null` on the base `where`).
 */
export function truckHealthWhere(
  check: TruckHealthCheck,
): Prisma.TruckWhereInput {
  switch (check) {
    case 'vin':
      return { OR: BLANK.map((vin) => ({ vin })) }
    case 'plate':
      return { OR: BLANK.map((plate) => ({ plate })) }
    case 'odometer':
      return { currentOdometer: null }
    case 'registration':
      return noLiveItem('REGISTRATION')
    case 'inspection':
      return noLiveItem('ANNUAL_INSPECTION')
  }
}

export type TruckHealthCounts = Record<TruckHealthCheck, number>

/**
 * The five counts over the trucks the caller may see, in ONE statement.
 *
 * `scope` is the tenant/company scope and the authority filter — the base of
 * the list — and never the view's own narrowing (attention, tag, the health
 * filter itself): the row answers "how much of my fleet is incomplete", not
 * "how much of this view". Raw SQL because the five are filtered aggregates
 * over one scan; five `count()` calls would be five scans.
 */
export async function countTruckHealth(
  tx: TxClient,
  scope: { companyIds?: readonly string[] | null },
): Promise<TruckHealthCounts> {
  const ids = scope.companyIds ?? null
  const rows = await tx.$queryRaw<
    {
      vin: number
      plate: number
      odometer: number
      registration: number
      inspection: number
    }[]
  >`
    SELECT COUNT(*) FILTER (WHERE t.vin IS NULL OR btrim(t.vin) = '')::int AS vin,
           COUNT(*) FILTER (WHERE t.plate IS NULL OR btrim(t.plate) = '')::int AS plate,
           COUNT(*) FILTER (WHERE t."currentOdometer" IS NULL)::int AS odometer,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM "ComplianceItem" ci
              WHERE ci."truckId" = t.id AND ci."deletedAt" IS NULL AND ci.type = 'REGISTRATION'))::int AS registration,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM "ComplianceItem" ci
              WHERE ci."truckId" = t.id AND ci."deletedAt" IS NULL AND ci.type = 'ANNUAL_INSPECTION'))::int AS inspection
      FROM "Truck" t
     WHERE t."deletedAt" IS NULL
       AND (${ids === null} OR t."companyId" = ANY(${ids ?? []}::text[]))
  `
  const row = rows[0]
  return {
    vin: Number(row?.vin ?? 0),
    plate: Number(row?.plate ?? 0),
    odometer: Number(row?.odometer ?? 0),
    registration: Number(row?.registration ?? 0),
    inspection: Number(row?.inspection ?? 0),
  }
}
