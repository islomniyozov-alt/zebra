import type { Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { WORKING_STATUSES } from './driver-list'

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
// PER SUBJECT. Trucks first (part 0); drivers by the owner's five of the same
// day (part 0b): no CDL on file, no medical card, no phone, no pay rule, no
// truck — ACTIVE drivers only. Measured on dev before the code: of 59 active
// person drivers, 13 no CDL record, 59 no medical-card record (none exists on
// dev), 6 no phone, 2 no pay rule in force, 26 no truck.
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

/**
 * THE SCOPE, AS THE REST OF THE APP MEANS IT. `companyScopeFilter` treats an
 * EMPTY list as "every company" — the unscoped owner's scope is `[]` — and the
 * first version of these counts treated `[]` as "no company", so the footer
 * read 0 for exactly the people who look at it. Production walk 2026-10-07,
 * queue item 20 (3): "data-health counts read 0 on both lists while the grid
 * shows gaps". Null here means unscoped; a non-empty list narrows.
 */
function scopeIds(
  companyIds: readonly string[] | null | undefined,
): readonly string[] | null {
  return companyIds && companyIds.length > 0 ? companyIds : null
}

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
  const ids = scopeIds(scope.companyIds)
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

// ── DRIVERS (part 0b) ───────────────────────────────────────────────────────

export const DRIVER_HEALTH_CHECKS = [
  'cdl',
  'medical',
  'phone',
  'payRule',
  'truck',
] as const

export type DriverHealthCheck = (typeof DRIVER_HEALTH_CHECKS)[number]

export function driverHealthCheckFor(raw: unknown): DriverHealthCheck | null {
  return typeof raw === 'string' &&
    (DRIVER_HEALTH_CHECKS as readonly string[]).includes(raw)
    ? (raw as DriverHealthCheck)
    : null
}

/**
 * ACTIVE DRIVERS ONLY, by the owner's words: the Active tab's population —
 * live, on a working roster value — and PEOPLE. A referral payee has no CDL,
 * card or truck by its nature (`driver-kind.ts` excludes it from the DQF and
 * the compliance warnings for the same reason), so counting it would make a
 * gap of a row that is right as it is.
 */
export function driverHealthBase(): Prisma.DriverWhereInput {
  return {
    deletedAt: null,
    status: { in: [...WORKING_STATUSES] },
    kind: { not: 'PAYEE' },
  }
}

/**
 * The one definition per check, as the filter the link applies.
 *
 * "On file" is a live `ComplianceItem` of the type — the licence record with
 * its expiry, the medical certificate with its expiry. The DQF's CDL item is a
 * COPY of the licence (a document) and is a different fact, watched by the
 * DQF. "No pay rule" is no rule IN FORCE TODAY by `ruleInForce`'s own test,
 * because a driver whose only rule has closed generates an empty settlement
 * exactly like one who never had one.
 */
export function driverHealthWhere(
  check: DriverHealthCheck,
  now: Date,
): Prisma.DriverWhereInput {
  switch (check) {
    case 'cdl':
      return { complianceItems: { none: { type: 'CDL', deletedAt: null } } }
    case 'medical':
      return {
        complianceItems: { none: { type: 'MEDICAL_CARD', deletedAt: null } },
      }
    case 'phone':
      return { OR: BLANK.map((phone) => ({ phone })) }
    case 'payRule':
      return {
        payRules: {
          none: {
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          },
        },
      }
    case 'truck':
      return { assignedTruckId: null }
  }
}

export type DriverHealthCounts = Record<DriverHealthCheck, number>

/** The five driver counts over the active people the caller may see, in ONE statement. */
export async function countDriverHealth(
  tx: TxClient,
  scope: { companyIds?: readonly string[] | null },
  now: Date,
): Promise<DriverHealthCounts> {
  const ids = scopeIds(scope.companyIds)
  const rows = await tx.$queryRaw<
    {
      cdl: number
      medical: number
      phone: number
      payRule: number
      truck: number
    }[]
  >`
    SELECT COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM "ComplianceItem" ci
              WHERE ci."driverId" = d.id AND ci."deletedAt" IS NULL AND ci.type = 'CDL'))::int AS cdl,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM "ComplianceItem" ci
              WHERE ci."driverId" = d.id AND ci."deletedAt" IS NULL AND ci.type = 'MEDICAL_CARD'))::int AS medical,
           COUNT(*) FILTER (WHERE d.phone IS NULL OR btrim(d.phone) = '')::int AS phone,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM "DriverPayRule" r
              WHERE r."driverId" = d.id
                AND r."effectiveFrom" <= ${now}
                AND (r."effectiveTo" IS NULL OR r."effectiveTo" >= ${now})))::int AS "payRule",
           COUNT(*) FILTER (WHERE d."assignedTruckId" IS NULL)::int AS truck
      FROM "Driver" d
     WHERE d."deletedAt" IS NULL
       AND d.status IN ('AVAILABLE', 'DISPATCHED', 'ON_ROUTE', 'OFF_DUTY')
       AND d.kind <> 'PAYEE'
       AND (${ids === null} OR d."companyId" = ANY(${ids ?? []}::text[]))
  `
  const row = rows[0]
  return {
    cdl: Number(row?.cdl ?? 0),
    medical: Number(row?.medical ?? 0),
    phone: Number(row?.phone ?? 0),
    payRule: Number(row?.payRule ?? 0),
    truck: Number(row?.truck ?? 0),
  }
}
