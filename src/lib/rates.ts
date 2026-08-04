import type { AccessorialType } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { MoneyFormatError, loadRevenueCents, parseMoneyToCents } from './money'

// ---------------------------------------------------------------------------
// WHAT A LOAD IS WORTH (Phase 3 §5 step 1).
//
// Rates are entered by OWNER or ACCOUNTING, never by a dispatcher — §1, and
// enforced by `load.financials:update` at the route rather than here.
//
// THREE STORED INTEGERS AND ONE DERIVED. `linehaulCents` and
// `fuelSurchargeCents` are typed; `accessorialsCents` is the sum of the load's
// BILLABLE, non-denied accessorial rows; `totalRevenueCents` is the three
// added. The total is stored because a broker's invoice, a settlement and the
// profitability line all read it, and recomputing it in three places is how
// three places disagree — but it is never the source of anything, so a reader
// can always check it against the columns beside it (rule 9-money).
//
// A DENIED accessorial stops counting the moment it is denied. A PENDING one
// still counts: the load is worth what you intend to bill, and pretending
// otherwise understates revenue on every load awaiting approval.
// ---------------------------------------------------------------------------

export interface RateInput {
  /** Decimal strings as typed. Parsed here, never by the caller. */
  linehaul: string
  fuelSurcharge: string
}

export type RateFailure = 'not_found' | 'bad_amount' | 'negative'

export type RateOutcome =
  | { ok: true; totalRevenueCents: number }
  | { ok: false; reason: RateFailure; field?: 'linehaul' | 'fuelSurcharge' }

/** The billable accessorial total for a load, from its rows. */
export async function accessorialsTotalCents(
  tx: TxClient,
  loadId: string,
): Promise<number> {
  const rows = await tx.loadAccessorial.findMany({
    where: { loadId, isBillable: true, status: { not: 'DENIED' } },
    select: { amountCents: true },
  })
  return rows.reduce((total, row) => total + row.amountCents, 0)
}

export async function setLoadRate(
  tx: TxClient,
  loadId: string,
  input: RateInput,
): Promise<RateOutcome> {
  let linehaulCents: number
  let fuelSurchargeCents: number
  try {
    linehaulCents = parseMoneyToCents(input.linehaul)
  } catch (error) {
    if (error instanceof MoneyFormatError) {
      return { ok: false, reason: 'bad_amount', field: 'linehaul' }
    }
    throw error
  }
  try {
    fuelSurchargeCents = parseMoneyToCents(input.fuelSurcharge)
  } catch (error) {
    if (error instanceof MoneyFormatError) {
      return { ok: false, reason: 'bad_amount', field: 'fuelSurcharge' }
    }
    throw error
  }

  // A negative rate is not a discount, it is a typo. Credits belong on an
  // invoice line where they can be described.
  if (linehaulCents < 0) {
    return { ok: false, reason: 'negative', field: 'linehaul' }
  }
  if (fuelSurchargeCents < 0) {
    return { ok: false, reason: 'negative', field: 'fuelSurcharge' }
  }

  const load = await tx.load.findUnique({
    where: { id: loadId },
    select: { id: true },
  })
  if (!load) return { ok: false, reason: 'not_found' }

  const accessorialsCents = await accessorialsTotalCents(tx, loadId)
  const totalRevenueCents = loadRevenueCents({
    linehaulCents,
    fuelSurchargeCents,
    accessorialsCents,
  })

  await tx.load.update({
    where: { id: loadId },
    data: {
      linehaulCents,
      fuelSurchargeCents,
      accessorialsCents,
      totalRevenueCents,
    },
  })

  return { ok: true, totalRevenueCents }
}

export interface AccessorialInput {
  type: AccessorialType
  amount: string
  isBillable: boolean
  notes?: string | null
}

export type AccessorialOutcome =
  | { ok: true; accessorialsCents: number; totalRevenueCents: number }
  | { ok: false; reason: 'not_found' | 'bad_amount' }

export async function addAccessorial(
  tx: TxClient,
  organizationId: string,
  loadId: string,
  input: AccessorialInput,
): Promise<AccessorialOutcome> {
  let amountCents: number
  try {
    amountCents = parseMoneyToCents(input.amount)
  } catch (error) {
    if (error instanceof MoneyFormatError) {
      return { ok: false, reason: 'bad_amount' }
    }
    throw error
  }

  const load = await tx.load.findUnique({
    where: { id: loadId },
    select: { linehaulCents: true, fuelSurchargeCents: true },
  })
  if (!load) return { ok: false, reason: 'not_found' }

  await tx.loadAccessorial.create({
    data: {
      loadId,
      organizationId,
      type: input.type,
      amountCents,
      isBillable: input.isBillable,
      notes: input.notes ?? null,
    },
  })

  return recomputeFromAccessorials(tx, loadId, load)
}

export async function removeAccessorial(
  tx: TxClient,
  loadId: string,
  accessorialId: string,
): Promise<AccessorialOutcome> {
  const load = await tx.load.findUnique({
    where: { id: loadId },
    select: { linehaulCents: true, fuelSurchargeCents: true },
  })
  if (!load) return { ok: false, reason: 'not_found' }

  // Scoped by loadId as well as id: an accessorial from another load is a
  // 404, not a deletion.
  const { count } = await tx.loadAccessorial.deleteMany({
    where: { id: accessorialId, loadId },
  })
  if (count === 0) return { ok: false, reason: 'not_found' }

  return recomputeFromAccessorials(tx, loadId, load)
}

async function recomputeFromAccessorials(
  tx: TxClient,
  loadId: string,
  load: { linehaulCents: number; fuelSurchargeCents: number },
): Promise<AccessorialOutcome> {
  const accessorialsCents = await accessorialsTotalCents(tx, loadId)
  const totalRevenueCents = loadRevenueCents({
    linehaulCents: load.linehaulCents,
    fuelSurchargeCents: load.fuelSurchargeCents,
    accessorialsCents,
  })

  await tx.load.update({
    where: { id: loadId },
    data: { accessorialsCents, totalRevenueCents },
  })

  return { ok: true, accessorialsCents, totalRevenueCents }
}
