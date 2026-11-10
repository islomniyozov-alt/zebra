import type { Prisma } from '@/generated/prisma/client'
import { retireAsset } from './fleet'
import type { TxClient } from './tenancy'
import { truckViewWhere } from './truck-list'

// ---------------------------------------------------------------------------
// THE SEED'S PLACEHOLDER TRUCKS BECOME REMOVED (TMS-DESIGN-SYSTEM.md §6.5
// part 1, owner's ruling (b) of 2026-11-10; GAPS data row).
//
// `scripts/seed-datatruck-all-trucks.ts` filed the all-trucks export's extra
// units OUT_OF_SERVICE because `TruckStatus` has no INACTIVE — 66 of dev's 119
// live trucks, every one a placeholder and not a yard's note. The ruling: they
// left the fleet, so they are REMOVED, with the reason "inactive in Datatruck
// export 2026-09-09". The six named by an open load keep the link, and the
// load says "truck inactive" (`warnings.ts`).
//
// ── IDENTIFIED BY THE SEED'S OWN SIGNATURE, NEVER BY A LIST TYPED BY HAND ──
//
// The seed wrote these rows with NO asset-history period at all — every other
// writer opens one (`openFirstPeriod`), and `findAuthorityDrift` skips exactly
// these for that reason — and nobody has touched them since. So the signature
// is: live, OUT_OF_SERVICE, no `AssetAssignment` row, and no audit UPDATE. A
// truck a person has edited since the seed is NOT the seed's, whatever its
// status says: it is left alone and named under "touched".
//
// ── THE APPLICATION'S OWN WRITE, NOT A BARE UPDATE ──────────────────────────
//
// `retireAsset`, inside `runInOrg`, so `deletedAt` is set the way the record's
// Remove button sets it, any open period is closed (there is none) and the
// audit row is written with the batch's attribution as its reason. The reason
// is also appended to the truck's notes, so the record itself says why.
//
// The script is thin — target, tenancy, print — and this is where the rule
// lives, because the integration test exercises it against real rows.
// ---------------------------------------------------------------------------

export const SEED_EXPORT_DAY = '2026-09-09'

export const SEED_INACTIVE_REASON = `inactive in Datatruck export ${SEED_EXPORT_DAY}`

/** The Prisma half of the signature; the audit half is `touchedSince`. */
export function seedPlaceholderTruckWhere(): Prisma.TruckWhereInput {
  return {
    deletedAt: null,
    status: 'OUT_OF_SERVICE',
    assetHistory: { none: {} },
  }
}

export interface PlaceholderTruck {
  id: string
  unitNumber: string
  companyName: string
  /** Open loads (not finished, not cancelled) that name this truck. */
  openLoads: string[]
}

export interface ViewCounts {
  active: number
  inactive: number
}

export interface RetirementPlan {
  candidates: PlaceholderTruck[]
  /** Matched the signature but carry an audit UPDATE: a person's, left alone. */
  touched: { id: string; unitNumber: string; companyName: string }[]
  before: ViewCounts
  /** Null in preview: nothing was written, so there is no after. */
  after: ViewCounts | null
  written: number
}

/** Active and Inactive by the trucks list's own predicates (§6.5 part 1). */
export async function countTruckViews(tx: TxClient): Promise<ViewCounts> {
  const [active, inactive] = await Promise.all([
    tx.truck.count({ where: truckViewWhere('active') }),
    tx.truck.count({ where: truckViewWhere('inactive') }),
  ])
  return { active, inactive }
}

/** Which of these trucks carry an audit UPDATE — somebody's hand since the seed. */
async function touchedSince(
  tx: TxClient,
  truckIds: readonly string[],
): Promise<Set<string>> {
  if (truckIds.length === 0) return new Set()
  const rows = await tx.auditLog.findMany({
    where: {
      entityType: 'Truck',
      action: 'UPDATE',
      entityId: { in: [...truckIds] },
    },
    select: { entityId: true },
    distinct: ['entityId'],
  })
  return new Set(rows.map((row) => row.entityId))
}

/** The plan: who would be removed, who is left alone, and the counts now. */
export async function planSeedPlaceholderRetirement(
  tx: TxClient,
): Promise<Omit<RetirementPlan, 'after' | 'written'>> {
  const before = await countTruckViews(tx)
  const matched = await tx.truck.findMany({
    where: seedPlaceholderTruckWhere(),
    orderBy: [{ company: { name: 'asc' } }, { unitNumber: 'asc' }],
    select: { id: true, unitNumber: true, company: { select: { name: true } } },
  })
  const touched = await touchedSince(
    tx,
    matched.map((truck) => truck.id),
  )
  const candidateIds = matched
    .filter((truck) => !touched.has(truck.id))
    .map((truck) => truck.id)
  const openLoads = await tx.load.findMany({
    where: {
      truckId: { in: candidateIds },
      deletedAt: null,
      isCancelled: false,
      operationalStatus: { notIn: ['DELIVERED', 'POD_RECEIVED'] },
    },
    select: { truckId: true, loadNumber: true },
    orderBy: { loadNumber: 'asc' },
  })
  const loadsByTruck = new Map<string, string[]>()
  for (const load of openLoads) {
    if (!load.truckId) continue
    loadsByTruck.set(load.truckId, [
      ...(loadsByTruck.get(load.truckId) ?? []),
      load.loadNumber,
    ])
  }
  return {
    before,
    candidates: matched
      .filter((truck) => !touched.has(truck.id))
      .map((truck) => ({
        id: truck.id,
        unitNumber: truck.unitNumber,
        companyName: truck.company.name,
        openLoads: loadsByTruck.get(truck.id) ?? [],
      })),
    touched: matched
      .filter((truck) => touched.has(truck.id))
      .map((truck) => ({
        id: truck.id,
        unitNumber: truck.unitNumber,
        companyName: truck.company.name,
      })),
  }
}

/** The line appended to a removed truck's notes. */
export function retirementNote(now: Date): string {
  return `Removed ${now.toISOString().slice(0, 10)}: ${SEED_INACTIVE_REASON} (owner's ruling 2026-11-10)`
}

/**
 * Remove the seed's placeholders — or only say what would be removed.
 *
 * PREVIEW BY DEFAULT: `write: false` reads and returns the plan with `after`
 * null. `write: true` retires each candidate through `retireAsset` and appends
 * the reason to its notes, in the caller's transaction, and counts again. A
 * second run finds no candidates and writes nothing.
 */
export async function retireSeedPlaceholderTrucks(
  tx: TxClient,
  options: { write: boolean; now: Date },
): Promise<RetirementPlan> {
  const plan = await planSeedPlaceholderRetirement(tx)
  if (!options.write) return { ...plan, after: null, written: 0 }

  for (const truck of plan.candidates) {
    const current = await tx.truck.findUnique({
      where: { id: truck.id },
      select: { notes: true },
    })
    await tx.truck.update({
      where: { id: truck.id },
      data: {
        notes: [current?.notes?.trim(), retirementNote(options.now)]
          .filter((part) => part && part !== '')
          .join('\n'),
      },
    })
    await retireAsset(tx, 'truck', truck.id)
  }

  return {
    ...plan,
    after: await countTruckViews(tx),
    written: plan.candidates.length,
  }
}
