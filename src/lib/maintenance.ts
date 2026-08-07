import type { MaintenanceCategory, Prisma } from '@/generated/prisma/client'
import type { CompanyScopeFilter, TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// MAINTENANCE (Phase 4 §5 step 3).
//
// Work orders per asset: what was done, when, at what odometer, by whom, and
// what it cost. §1 is explicit that this is full-depth — "costs and receipts,
// not just dates" — because a carrier deciding whether to keep a tractor
// another year needs the number, not a list of service dates.
//
// THE MODEL ALREADY EXISTED, again. `MaintenanceRecord` has carried
// `servicedAt`, `odometer`, `vendorName`, `category`, `costCents` and a
// `Document[]` since the init migration, plus `nextServiceDate` and
// `nextServiceOdometer` the brief does not ask for. No migration — flagged in
// PHASE-4-BRIEF.md §6, same finding as `ComplianceItem` one step earlier.
//
// COST IS MONEY AND IS GATED SEPARATELY. A DISPATCHER sees that truck 104 had
// its brakes done on the 3rd and does not see that it cost $1,840 — §2.5, and
// the same rule that keeps margin off the load screen. The gate is
// `truck.financials`, which permissions.ts introduced for exactly this shape:
// money that appears on a FLEET screen rather than a money screen. The service
// never returns a cost it was not asked for, so a role that cannot see one
// gets no payload to hide.
//
// Money is integer cents end to end and is formatted only at the edge, by
// `money.ts` (rule 9-money). Nothing in this file divides by 100.
// ---------------------------------------------------------------------------

/** The two things a work order can hang off. Drivers do not get serviced. */
export type MaintenanceSubject = 'truck' | 'trailer'

export const MAINTENANCE_SUBJECTS: readonly MaintenanceSubject[] = [
  'truck',
  'trailer',
]

/**
 * Every category, in the order a shop thinks in rather than alphabetically.
 *
 * All twelve, unlike compliance's seven-of-fourteen: the enum was written for
 * exactly this screen and there is no long tail to hide. `OTHER` stays last so
 * the specific ones are picked before the catch-all.
 */
export const MAINTENANCE_CATEGORIES: readonly MaintenanceCategory[] = [
  'PREVENTIVE',
  'OIL_CHANGE',
  'TIRES',
  'BRAKES',
  'ENGINE',
  'TRANSMISSION',
  'SUSPENSION',
  'ELECTRICAL',
  'AFTERTREATMENT',
  'DOT_INSPECTION',
  'TRAILER_SERVICE',
  'OTHER',
]

export interface WorkOrderRow {
  id: string
  companyId: string
  companyName: string
  subject: MaintenanceSubject
  subjectId: string
  subjectLabel: string
  servicedAt: Date
  category: MaintenanceCategory
  description: string | null
  vendorName: string | null
  odometer: number | null
  /**
   * Absent — not zero — for a role that cannot see money.
   *
   * `undefined` rather than `null` on purpose: null reads as "no cost was
   * recorded", which is a different fact and one a dispatcher might act on.
   */
  costCents?: number
  documentCount: number
  nextServiceAt: Date | null
  nextServiceOdometer: number | null
}

export interface MaintenanceHistory {
  rows: WorkOrderRow[]
  /** Running totals, omitted entirely where costs are not visible. */
  totals?: {
    costCents: number
    /** Cost per mile over the odometer span these orders cover. */
    perMileCents: number | null
    fromOdometer: number | null
    toOdometer: number | null
  }
}

const SELECT = {
  id: true,
  companyId: true,
  servicedAt: true,
  odometer: true,
  category: true,
  description: true,
  vendorName: true,
  costCents: true,
  nextServiceDate: true,
  nextServiceOdometer: true,
  company: { select: { name: true } },
  truck: { select: { id: true, unitNumber: true } },
  trailer: { select: { id: true, unitNumber: true } },
  _count: { select: { documents: true } },
} satisfies Prisma.MaintenanceRecordSelect

interface Stored {
  id: string
  companyId: string
  servicedAt: Date
  odometer: number | null
  category: MaintenanceCategory
  description: string | null
  vendorName: string | null
  costCents: number
  nextServiceDate: Date | null
  nextServiceOdometer: number | null
  company: { name: string }
  truck: { id: string; unitNumber: string } | null
  trailer: { id: string; unitNumber: string } | null
  _count: { documents: number }
}

/**
 * Stored rows to read rows, with the cost included only if allowed.
 *
 * `maySeeCost` is passed in rather than read here, because permission is
 * decided in permissions.ts and nowhere else.
 */
export function shapeWorkOrders(
  rows: readonly Stored[],
  maySeeCost: boolean,
): WorkOrderRow[] {
  return rows.flatMap((row) => {
    const subject: MaintenanceSubject | null = row.truck
      ? 'truck'
      : row.trailer
        ? 'trailer'
        : null

    // Both subject columns are nullable, so a row can exist against nothing.
    // It cannot be shown against an asset, so it is dropped rather than
    // rendered as a dash — the same call `shapeRecords` makes.
    if (!subject) return []

    const asset = (row.truck ?? row.trailer)!

    return [
      {
        id: row.id,
        companyId: row.companyId,
        companyName: row.company.name,
        subject,
        subjectId: asset.id,
        subjectLabel: asset.unitNumber,
        servicedAt: row.servicedAt,
        category: row.category,
        description: row.description,
        vendorName: row.vendorName,
        odometer: row.odometer,
        // THE FIELD IS ABSENT, not blanked. Rule: never send a value the role
        // cannot see, and hiding it in CSS is the same bug as not checking.
        ...(maySeeCost ? { costCents: row.costCents } : {}),
        documentCount: row._count.documents,
        nextServiceAt: row.nextServiceDate,
        nextServiceOdometer: row.nextServiceOdometer,
      },
    ]
  })
}

/**
 * Running totals over a set of work orders.
 *
 * COST PER MILE is the number an owner actually steers by, and it is only
 * honest over an odometer span the orders themselves cover — so it is null
 * unless at least two of them recorded a reading. Dividing by a guessed
 * mileage would produce a figure nobody could reproduce, which rule 9-money
 * forbids.
 */
export function runningTotals(rows: readonly WorkOrderRow[]): {
  costCents: number
  perMileCents: number | null
  fromOdometer: number | null
  toOdometer: number | null
} {
  const costCents = rows.reduce((sum, row) => sum + (row.costCents ?? 0), 0)

  const readings = rows
    .map((row) => row.odometer)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)

  const fromOdometer = readings[0] ?? null
  const toOdometer = readings[readings.length - 1] ?? null
  const span =
    fromOdometer !== null && toOdometer !== null ? toOdometer - fromOdometer : 0

  return {
    costCents,
    // Integer division on cents, floored — a cost per mile is a comparison
    // figure and a fraction of a cent in it means nothing.
    perMileCents: span > 0 ? Math.round(costCents / span) : null,
    fromOdometer,
    toOdometer,
  }
}

/** Every work order for one asset, newest service first, with totals. */
export async function historyForSubject(
  tx: TxClient,
  subject: MaintenanceSubject,
  subjectId: string,
  maySeeCost: boolean,
): Promise<MaintenanceHistory> {
  const rows = await tx.maintenanceRecord.findMany({
    where: {
      deletedAt: null,
      ...(subject === 'truck' ? { truckId: subjectId } : {}),
      ...(subject === 'trailer' ? { trailerId: subjectId } : {}),
    },
    orderBy: { servicedAt: 'desc' },
    take: 300,
    select: SELECT,
  })

  const shaped = shapeWorkOrders(rows, maySeeCost)
  return {
    rows: shaped,
    ...(maySeeCost ? { totals: runningTotals(shaped) } : {}),
  }
}

export interface MaintenanceQuery {
  subject?: MaintenanceSubject
  category?: MaintenanceCategory
}

/** The fleet-wide list, newest service first. */
export async function maintenanceList(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
  query: MaintenanceQuery = {},
  maySeeCost = false,
): Promise<MaintenanceHistory> {
  const rows = await tx.maintenanceRecord.findMany({
    where: {
      ...scope,
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.subject === 'truck' ? { truckId: { not: null } } : {}),
      ...(query.subject === 'trailer' ? { trailerId: { not: null } } : {}),
    },
    orderBy: { servicedAt: 'desc' },
    take: 300,
    select: SELECT,
  })

  const shaped = shapeWorkOrders(rows, maySeeCost)
  return {
    rows: shaped,
    // Fleet-wide, cost per mile would divide one asset's spend by another
    // asset's odometer span, so only the money total is offered here. The
    // per-mile figure belongs on an asset and lives there.
    ...(maySeeCost
      ? {
          totals: {
            costCents: shaped.reduce(
              (sum, row) => sum + (row.costCents ?? 0),
              0,
            ),
            perMileCents: null,
            fromOdometer: null,
            toOdometer: null,
          },
        }
      : {}),
  }
}

// --- recording ----------------------------------------------------------------

export type WorkOrderFailure =
  | 'subject_not_found'
  | 'no_date'
  | 'bad_odometer'
  | 'bad_cost'

export type WorkOrderResult =
  | { ok: true; recordId: string }
  | { ok: false; reason: WorkOrderFailure }

export interface WorkOrderInput {
  subject: MaintenanceSubject
  subjectId: string
  servicedAt: Date
  category: MaintenanceCategory
  /** Integer cents, parsed by the caller through `money.ts`. */
  costCents: number
  odometer?: number | null
  vendorName?: string | null
  description?: string | null
  notes?: string | null
  nextServiceAt?: Date | null
  nextServiceOdometer?: number | null
}

export async function recordWorkOrder(
  tx: TxClient,
  input: WorkOrderInput,
): Promise<WorkOrderResult> {
  if (Number.isNaN(input.servicedAt.getTime())) {
    return { ok: false, reason: 'no_date' }
  }
  // A NEGATIVE COST IS REFUSED, and zero is allowed: warranty work really is
  // free, and recording it keeps the service history complete. A credit from a
  // vendor is a different transaction and will get its own path rather than
  // arriving as a work order with a minus sign.
  if (!Number.isInteger(input.costCents) || input.costCents < 0) {
    return { ok: false, reason: 'bad_cost' }
  }
  if (
    input.odometer !== null &&
    input.odometer !== undefined &&
    (!Number.isInteger(input.odometer) || input.odometer < 0)
  ) {
    return { ok: false, reason: 'bad_odometer' }
  }

  // The asset decides the tenant and the authority — read from the row rather
  // than taken from the caller, so a forged id lands on nothing.
  const asset =
    input.subject === 'truck'
      ? await tx.truck.findFirst({
          where: { id: input.subjectId, deletedAt: null },
          select: { id: true, organizationId: true, companyId: true },
        })
      : await tx.trailer.findFirst({
          where: { id: input.subjectId, deletedAt: null },
          select: { id: true, organizationId: true, companyId: true },
        })

  if (!asset) return { ok: false, reason: 'subject_not_found' }

  const created = await tx.maintenanceRecord.create({
    data: {
      organizationId: asset.organizationId,
      companyId: asset.companyId,
      ...(input.subject === 'truck'
        ? { truckId: asset.id }
        : { trailerId: asset.id }),
      servicedAt: input.servicedAt,
      category: input.category,
      costCents: input.costCents,
      odometer: input.odometer ?? null,
      vendorName: input.vendorName?.trim() || null,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
      nextServiceDate: input.nextServiceAt ?? null,
      nextServiceOdometer: input.nextServiceOdometer ?? null,
    },
    select: { id: true },
  })

  return { ok: true, recordId: created.id }
}

/** The receipts filed against a set of work orders, for their rows. */
export async function receiptsFor(
  tx: TxClient,
  recordIds: readonly string[],
): Promise<Map<string, { id: string; filename: string }[]>> {
  if (recordIds.length === 0) return new Map()

  const documents = await tx.document.findMany({
    where: { maintenanceId: { in: [...recordIds] }, deletedAt: null },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, filename: true, maintenanceId: true },
  })

  const byRecord = new Map<string, { id: string; filename: string }[]>()
  for (const document of documents) {
    const key = document.maintenanceId
    if (!key) continue
    const list = byRecord.get(key) ?? []
    list.push({ id: document.id, filename: document.filename })
    byRecord.set(key, list)
  }
  return byRecord
}
