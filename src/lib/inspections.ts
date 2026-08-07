import type {
  InspectionLevel,
  Prisma,
  ViolationUnit,
} from '@/generated/prisma/client'
import type { CompanyScopeFilter, TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// ROADSIDE INSPECTIONS (Phase 4 §3 step 4).
//
// An inspection is an EVENT. It happened on a date, in a state, to some
// combination of a truck, a trailer and a driver, and it either wrote
// violations or it did not.
//
// TWO FACTS ARE DERIVED, NEVER STORED, for the reason §2.2 gives about
// compliance status: a stored flag is a cache of something the children already
// say, and it goes stale the moment a violation is added or corrected.
//
//   * OUT OF SERVICE — true when any violation on the inspection carries the
//     OOS flag. Per violation, because that is where the officer writes it and
//     because "which one grounded the truck" is the question a DataQs challenge
//     has to answer (step 5).
//   * CLEAN — no violations at all. Worth its own word rather than "0
//     violations": a clean inspection is a CSA asset a carrier keeps for two
//     years, and it is the thing a safety manager looks for on a screen.
//
// THE SUBJECT FLOOR. All three subject columns are nullable because no single
// one is always present — Level III is driver-only, Level V is vehicle-only
// with the driver absent — and a CHECK constraint in the migration refuses a
// row that names none of them. The service refuses it first, in words.
// ---------------------------------------------------------------------------

/** The three things an inspection can be written against, in report order. */
export type InspectionSubject = 'truck' | 'trailer' | 'driver'

export const INSPECTION_SUBJECTS: readonly InspectionSubject[] = [
  'truck',
  'trailer',
  'driver',
]

/**
 * The six DOT levels, in their own order.
 *
 * Not filtered down the way `TRACKED_TYPES` filters compliance: a carrier does
 * not choose which level it gets, and levels IV and VI are rare rather than
 * unused. All six are offered.
 */
export const INSPECTION_LEVELS: readonly InspectionLevel[] = [
  'LEVEL_1',
  'LEVEL_2',
  'LEVEL_3',
  'LEVEL_4',
  'LEVEL_5',
  'LEVEL_6',
]

export const VIOLATION_UNITS: readonly ViolationUnit[] = [
  'DRIVER',
  'VEHICLE',
  'HAZMAT',
  'OTHER',
]

export interface ViolationRow {
  id: string
  code: string
  description: string | null
  unit: ViolationUnit
  outOfService: boolean
  severityWeight: number | null
}

export interface InspectionRow {
  id: string
  companyId: string
  companyName: string
  inspectedAt: Date
  level: InspectionLevel
  state: string
  reportNumber: string | null
  location: string | null
  inspectorName: string | null
  notes: string | null
  truck: { id: string; unitNumber: string } | null
  trailer: { id: string; unitNumber: string } | null
  driver: { id: string; name: string } | null
  violations: ViolationRow[]
  /** Derived: any violation put something out of service. */
  outOfService: boolean
  /** Derived: no violations at all. */
  isClean: boolean
  documentCount: number
}

const SELECT = {
  id: true,
  companyId: true,
  inspectedAt: true,
  level: true,
  state: true,
  reportNumber: true,
  location: true,
  inspectorName: true,
  notes: true,
  company: { select: { name: true } },
  truck: { select: { id: true, unitNumber: true } },
  trailer: { select: { id: true, unitNumber: true } },
  driver: { select: { id: true, firstName: true, lastName: true } },
  violations: {
    where: { deletedAt: null },
    // Out of service first: the violation that grounded the truck is the one a
    // reader is looking for, and it is not always the one written first.
    orderBy: [{ outOfService: 'desc' }, { code: 'asc' }],
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
      outOfService: true,
      severityWeight: true,
    },
  },
  _count: { select: { documents: true } },
} satisfies Prisma.RoadsideInspectionSelect

type Stored = Prisma.RoadsideInspectionGetPayload<{ select: typeof SELECT }>

/** Stored rows to read rows, with the two derived facts computed once. */
export function shapeInspections(rows: readonly Stored[]): InspectionRow[] {
  return rows.map((row) => {
    const violations: ViolationRow[] = row.violations.map((violation) => ({
      id: violation.id,
      code: violation.code,
      description: violation.description,
      unit: violation.unit,
      outOfService: violation.outOfService,
      severityWeight: violation.severityWeight,
    }))

    return {
      id: row.id,
      companyId: row.companyId,
      companyName: row.company.name,
      inspectedAt: row.inspectedAt,
      level: row.level,
      state: row.state,
      reportNumber: row.reportNumber,
      location: row.location,
      inspectorName: row.inspectorName,
      notes: row.notes,
      truck: row.truck,
      trailer: row.trailer,
      driver: row.driver
        ? {
            id: row.driver.id,
            name: `${row.driver.firstName} ${row.driver.lastName}`.trim(),
          }
        : null,
      violations,
      outOfService: violations.some((violation) => violation.outOfService),
      // Read off the violations, not off a column. A soft-deleted violation is
      // already excluded by the select, so correcting a mistyped code back out
      // of existence makes the inspection clean again — which is the truth.
      isClean: violations.length === 0,
      documentCount: row._count.documents,
    }
  })
}

export interface InspectionQuery {
  subject?: InspectionSubject
  level?: InspectionLevel
  /** Only the ones that put something out of service. */
  outOfService?: boolean
}

/** Every inspection in scope, newest first. */
export async function inspectionList(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
  query: InspectionQuery = {},
): Promise<InspectionRow[]> {
  const rows = await tx.roadsideInspection.findMany({
    where: {
      ...scope,
      deletedAt: null,
      ...(query.subject === 'truck' ? { truckId: { not: null } } : {}),
      ...(query.subject === 'trailer' ? { trailerId: { not: null } } : {}),
      ...(query.subject === 'driver' ? { driverId: { not: null } } : {}),
      ...(query.level ? { level: query.level } : {}),
      // FILTERED IN SQL, on the children — not by shaping everything and
      // throwing rows away, which would make the chip count and the page size
      // disagree the moment the list is longer than one page.
      ...(query.outOfService
        ? { violations: { some: { deletedAt: null, outOfService: true } } }
        : {}),
    },
    orderBy: { inspectedAt: 'desc' },
    take: 300,
    select: SELECT,
  })

  return shapeInspections(rows)
}

/** One inspection, or null if it is not in this tenant. */
export async function inspectionById(
  tx: TxClient,
  id: string,
): Promise<InspectionRow | null> {
  const row = await tx.roadsideInspection.findFirst({
    where: { id, deletedAt: null },
    select: SELECT,
  })
  return row ? (shapeInspections([row])[0] ?? null) : null
}

/**
 * The inspection history for one asset or driver, newest first.
 *
 * The panel on a truck screen asks this, and so does the one on a driver
 * screen, and they must answer identically — the same argument that gave
 * compliance and maintenance one view builder each.
 */
export async function inspectionsForSubject(
  tx: TxClient,
  subject: InspectionSubject,
  subjectId: string,
): Promise<InspectionRow[]> {
  const rows = await tx.roadsideInspection.findMany({
    where: {
      deletedAt: null,
      ...(subject === 'truck' ? { truckId: subjectId } : {}),
      ...(subject === 'trailer' ? { trailerId: subjectId } : {}),
      ...(subject === 'driver' ? { driverId: subjectId } : {}),
    },
    orderBy: { inspectedAt: 'desc' },
    take: 200,
    select: SELECT,
  })

  return shapeInspections(rows)
}

// --- recording ---------------------------------------------------------------

export type InspectionFailure =
  | 'no_subject'
  | 'subject_not_found'
  | 'mixed_authority'
  | 'no_date'
  | 'bad_state'

export type InspectionResult =
  | { ok: true; inspectionId: string }
  | { ok: false; reason: InspectionFailure }

export interface InspectionInput {
  truckId?: string | null
  trailerId?: string | null
  driverId?: string | null
  inspectedAt: Date
  level: InspectionLevel
  state: string
  reportNumber?: string
  location?: string
  inspectorName?: string
  notes?: string
}

/** A two-letter jurisdiction, uppercased. Refuses anything else. */
export function normalizeState(input: string): string | null {
  const cleaned = input.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(cleaned) ? cleaned : null
}

export async function recordInspection(
  tx: TxClient,
  input: InspectionInput,
): Promise<InspectionResult> {
  if (Number.isNaN(input.inspectedAt.getTime())) {
    return { ok: false, reason: 'no_date' }
  }

  const state = normalizeState(input.state)
  if (!state) return { ok: false, reason: 'bad_state' }

  const truckId = input.truckId || null
  const trailerId = input.trailerId || null
  const driverId = input.driverId || null

  // Refused in words before the CHECK constraint refuses it in Postgres. The
  // constraint is the backstop; this is the sentence a person reads.
  if (!truckId && !trailerId && !driverId) {
    return { ok: false, reason: 'no_subject' }
  }

  // THE AUTHORITY COMES FROM THE SUBJECTS, never from the caller. Each is read
  // through the scoped transaction, so an id belonging to another tenant is
  // simply not there.
  const [truck, trailer, driver] = await Promise.all([
    truckId
      ? tx.truck.findFirst({
          where: { id: truckId, deletedAt: null },
          select: { id: true, organizationId: true, companyId: true },
        })
      : null,
    trailerId
      ? tx.trailer.findFirst({
          where: { id: trailerId, deletedAt: null },
          select: { id: true, organizationId: true, companyId: true },
        })
      : null,
    driverId
      ? tx.driver.findFirst({
          where: { id: driverId, deletedAt: null },
          select: { id: true, organizationId: true, companyId: true },
        })
      : null,
  ])

  if ((truckId && !truck) || (trailerId && !trailer) || (driverId && !driver)) {
    return { ok: false, reason: 'subject_not_found' }
  }

  const found = [truck, trailer, driver].filter((row) => row !== null)

  // A TRUCK FROM ONE AUTHORITY AND A DRIVER FROM ANOTHER is refused rather than
  // silently filed under whichever was read first. The group runs two carriers
  // and the inspection belongs to exactly one of them — the one on the DOT
  // number the officer wrote down. If a real inspection ever spans two, that is
  // a conversation, not a default.
  const companyIds = new Set(found.map((row) => row.companyId))
  if (companyIds.size > 1) return { ok: false, reason: 'mixed_authority' }

  const anchor = found[0]!

  const created = await tx.roadsideInspection.create({
    data: {
      organizationId: anchor.organizationId,
      companyId: anchor.companyId,
      truckId: truck?.id ?? null,
      trailerId: trailer?.id ?? null,
      driverId: driver?.id ?? null,
      inspectedAt: input.inspectedAt,
      level: input.level,
      state,
      reportNumber: input.reportNumber?.trim() || null,
      location: input.location?.trim() || null,
      inspectorName: input.inspectorName?.trim() || null,
      notes: input.notes?.trim() || null,
    },
    select: { id: true },
  })

  return { ok: true, inspectionId: created.id }
}

export type ViolationFailure = 'inspection_not_found' | 'no_code' | 'bad_weight'

export type ViolationResult =
  | { ok: true; violationId: string }
  | { ok: false; reason: ViolationFailure }

export interface ViolationInput {
  inspectionId: string
  code: string
  description?: string
  unit: ViolationUnit
  outOfService: boolean
  severityWeight?: number | null
}

export async function addViolation(
  tx: TxClient,
  input: ViolationInput,
): Promise<ViolationResult> {
  const code = input.code.trim().toUpperCase()
  if (code === '') return { ok: false, reason: 'no_code' }

  if (
    input.severityWeight !== null &&
    input.severityWeight !== undefined &&
    (!Number.isInteger(input.severityWeight) ||
      input.severityWeight < 1 ||
      input.severityWeight > 10)
  ) {
    // The CSA scale is 1–10. A weight outside it is a typo, and a typo here
    // would eventually be summed into a BASIC percentile.
    return { ok: false, reason: 'bad_weight' }
  }

  const inspection = await tx.roadsideInspection.findFirst({
    where: { id: input.inspectionId, deletedAt: null },
    select: { id: true },
  })
  if (!inspection) return { ok: false, reason: 'inspection_not_found' }

  const created = await tx.inspectionViolation.create({
    data: {
      // `organizationId` is written by the set_org trigger from the inspection.
      // It is passed here only because Prisma requires the field; the trigger
      // overwrites whatever arrives, which is the point.
      organizationId: '',
      inspectionId: inspection.id,
      code,
      description: input.description?.trim() || null,
      unit: input.unit,
      outOfService: input.outOfService,
      severityWeight: input.severityWeight ?? null,
    },
    select: { id: true },
  })

  return { ok: true, violationId: created.id }
}

/**
 * Withdraw a violation that was typed in error.
 *
 * SOFT, and deliberately not the path a successful DataQs challenge takes: a
 * challenge that wins is recorded as an outcome on the challenge (step 5), so
 * the history still shows what was written and what happened to it. This is for
 * the case where somebody typed 393.75 against the wrong inspection.
 */
export async function withdrawViolation(
  tx: TxClient,
  violationId: string,
): Promise<boolean> {
  const { count } = await tx.inspectionViolation.updateMany({
    where: { id: violationId, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  return count === 1
}

/** The reports filed against a set of inspections, for their rows. */
export async function documentsForInspections(
  tx: TxClient,
  inspectionIds: readonly string[],
): Promise<Map<string, { id: string; filename: string }[]>> {
  if (inspectionIds.length === 0) return new Map()

  const documents = await tx.document.findMany({
    where: { inspectionId: { in: [...inspectionIds] }, deletedAt: null },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, filename: true, inspectionId: true },
  })

  const byInspection = new Map<string, { id: string; filename: string }[]>()
  for (const document of documents) {
    const key = document.inspectionId
    if (!key) continue
    const list = byInspection.get(key) ?? []
    list.push({ id: document.id, filename: document.filename })
    byInspection.set(key, list)
  }
  return byInspection
}
