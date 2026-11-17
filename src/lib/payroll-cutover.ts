import { Prisma } from '@/generated/prisma/client'
import { dayFromParam } from './settlement-week'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// THE CARRY-OVER FLOOR — the payroll cutover (MONEY-DESIGN §6, owner's ruling
// 2026-11-17, migration 74).
//
// The catch-up drafts every earlier Delivered trip on no statement into the
// next batch of its authority. Without a floor that reaches back to the first
// freight the organization ever recorded — on production, every trip since
// the books cutover that Datatruck, not Zebra, paid. The floor is the date
// payroll moved to Zebra: "Delivered earlier, not yet paid" reaches back to it
// and no further, and a trip delivered before it never carries over.
//
//   floor = Organization.payrollCutoverDate          (set on Settings)
//        ?? the start of the authority's earliest live Zebra batch
//        ?? today
//
// "The authority's earliest batch" counts a batch for that authority and an
// org-wide one (it settled every authority); for an org-wide scope, any batch.
// A batch being opened counts itself, so an authority's FIRST batch carries
// nothing over by default — its range only.
//
// THE FLOOR BOUNDS THE CARRY-OVER, NOT THE RANGE. A batch whose range starts
// before the floor still drafts its range; the engine's lower bound is the
// earlier of the two (`batchLowerBound`).
// ---------------------------------------------------------------------------

const DAY = 86_400_000

/** Midnight UTC of the day `at` falls on. */
const startOfDay = (at: Date) => new Date(Math.floor(at.getTime() / DAY) * DAY)

/** The floor, pure: the setting, else the earliest batch, else today. */
export function carryOverFloor(input: {
  stored: Date | null
  earliestBatchStart: Date | null
  today: Date
}): Date {
  return input.stored ?? input.earliestBatchStart ?? startOfDay(input.today)
}

/** The engine's lower bound: the range, and the carry-over back to the floor. */
export function batchLowerBound(periodStart: Date, floor: Date): Date {
  return floor.getTime() < periodStart.getTime() ? floor : periodStart
}

/**
 * The floor's two facts as ONE SQL text: the organization's setting and the
 * start of the earliest live batch for the scope — a batch for that authority
 * or an org-wide one; for an org-wide scope (`companyId` NULL), any batch.
 * `readCarryOverFloor` sends it; the batch screen's one-statement head names it
 * as a CTE, so the two cannot read the floor two ways. Both tables are behind
 * row-level security, so the current organization is the only one in reach.
 */
export function carryOverFloorSql(companyId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      (SELECT o."payrollCutoverDate" FROM "Organization" o LIMIT 1) AS stored,
      (SELECT MIN(x."periodStart") FROM "SettlementBatch" x
        WHERE x."deletedAt" IS NULL
          AND (${companyId} IS NULL
               OR x."companyId" = ${companyId}
               OR x."companyId" IS NULL)) AS earliest`
}

export interface CarryOverFloorRow {
  stored: Date | string | null
  earliest: Date | string | null
}

/** `carryOverFloorSql`'s row, from either transport, as the floor. */
export function carryOverFloorFrom(
  row: CarryOverFloorRow | null | undefined,
  today: Date,
): Date {
  const at = (value: Date | string | null | undefined) =>
    value === null || value === undefined ? null : new Date(value)
  return carryOverFloor({
    stored: at(row?.stored),
    earliestBatchStart: at(row?.earliest),
    today,
  })
}

/**
 * The floor for one scope, in ONE statement inside the caller's tenant
 * transaction — the engine's reader pays one round trip for it, no more.
 */
export async function readCarryOverFloor(
  tx: TxClient,
  companyId: string | null,
  today: Date = new Date(),
): Promise<Date> {
  const rows = await tx.$queryRaw<CarryOverFloorRow[]>(
    carryOverFloorSql(Prisma.sql`${companyId}::text`),
  )
  return carryOverFloorFrom(rows[0], today)
}

export type CutoverRefusal = 'bad_date'

/**
 * Parse the Settings field: a `YYYY-MM-DD`, or empty for "the default".
 * `undefined` is a refusal; `null` clears the setting.
 */
export function parseCutover(value: unknown): Date | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  return (
    dayFromParam(typeof value === 'string' ? value.trim() : value) ?? undefined
  )
}

/**
 * Set or clear the organization's payroll cutover. ONE update, so the audit
 * extension writes one row with `payrollCutoverDate: { from, to }` — that row
 * is the audit trail the ruling asks for (`audit.ts` audits every write to
 * every model but four).
 */
export async function savePayrollCutover(
  tx: TxClient,
  organizationId: string,
  value: unknown,
): Promise<
  { ok: true; value: Date | null } | { ok: false; reason: CutoverRefusal }
> {
  const parsed = parseCutover(value)
  if (parsed === undefined) return { ok: false, reason: 'bad_date' }
  await tx.organization.update({
    where: { id: organizationId },
    data: { payrollCutoverDate: parsed },
  })
  return { ok: true, value: parsed }
}
