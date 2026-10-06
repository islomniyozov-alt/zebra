// ---------------------------------------------------------------------------
// STANDING CHARGES — THE ORGANIZATION'S DEDUCTIONS, NOT A DRIVER'S.
//
// §6.2.4, migration 61. `Ifta` and `Admin Fee` are the cases: every driver pays
// them, nobody signs up for them individually, and a driver hired on Tuesday
// pays one on Friday without anybody adding a row.
//
// ── THE ENGINE IS NOT CHANGED, ONLY FED ──────────────────────────────────
//
// `computeDeductions` already turns a `RecurringRule` into a line, prices a
// cadence, writes the description template and signs the total. A standing
// charge IS that shape with a different owner, so this file's whole job is
// SELECTION — which charges reach which driver — and then handing them over as
// rules.
//
// That is deliberate and it is the reason this is a separate file rather than a
// branch inside `deductions.ts`: a second copy of "how a MONTHLY_SPLIT_WEEKLY
// instalment is priced" is a second place for it to be priced differently, and
// the difference would show up as two drivers charged unequally for the same
// org-wide rule. Nothing below computes money.
//
// ── THE CHARGE FOLLOWS THE WORK ──────────────────────────────────────────
//
// A driver with no freight in the week gets NO LINE (§6.2.4). This is the one
// rule here that is not arithmetic and it is the one that costs real money to
// get wrong: billing somebody an admin fee for a week they did not drive is a
// deduction against zero earnings, which lands as a negative net on a statement
// handed to a person. `hasFreight` is an argument rather than something derived
// here, because the caller already knows which loads are whose.
//
// ── PURE, AND SEPARATELY TESTABLE FROM THE READS ─────────────────────────
//
// Same posture as `deductions.ts`: no database, no clock. The reads are at the
// bottom and they return the pure function's arguments.
// ---------------------------------------------------------------------------

import type { Prisma } from '@/generated/prisma/client'
import type { DeductionCadence, RecurringRule } from '@/lib/deductions'

type TxClient = Prisma.TransactionClient

/**
 * Which drivers a standing charge reaches.
 *
 * ── FOUR VALUES, AND §6.2.4 NAMES TWO ───────────────────────────────────
 *
 * The design system says "company drivers / owner-operators / all". The schema
 * says `Driver.driverType` is a `DriverType` (migration 70; it was an
 * `OwnershipType`), which has THREE values: `COMPANY_DRIVER`, `LEASE_OPERATOR`
 * and `OWNER_OPERATOR`. A lease operator is neither a
 * company driver nor an owner-operator, so under a two-choice scope they would
 * be reachable by `ALL` and by nothing else — a charge aimed at company drivers
 * would silently skip them.
 *
 * The schema wins and the contradiction is flagged rather than resolved here
 * (AGENTS.md). See `PHASE-5-BRIEF.md` §7.
 */
export const STANDING_SCOPES = [
  'ALL',
  'COMPANY_DRIVER',
  'LEASE_OPERATOR',
  'OWNER_OPERATOR',
] as const

export type StandingScope = (typeof STANDING_SCOPES)[number]

export function isStandingScope(value: string): value is StandingScope {
  return (STANDING_SCOPES as readonly string[]).includes(value)
}

/** A stored standing charge, as the selection needs it. */
export interface StandingChargeRule {
  id: string
  type: string
  description: string | null
  amountCents: number
  cadence: DeductionCadence
  /** `ALL` or one `DriverType` value. A string — see `STANDING_SCOPES`. */
  appliesTo: string
  effectiveFrom: Date
  effectiveTo: Date | null
}

/** One driver this charge does not reach, and why. */
export interface StandingExemption {
  standingChargeId: string
  driverId: string
  reason: string
}

export interface StandingSubject {
  id: string
  /** `Driver.driverType`. */
  driverType: string
  /**
   * Whether this driver pulled anything in the period.
   *
   * THE CALLER DECIDES THIS, from the loads it already read. See the header.
   */
  hasFreight: boolean
}

/**
 * Does this charge's scope cover this driver?
 *
 * `ALL` covers everybody; anything else is an exact match against
 * `driverType`. An UNRECOGNISED scope matches NOTHING rather than
 * everything — a typo in a column that decides who gets charged should under-
 * charge and be noticed, not over-charge and be discovered on a statement.
 */
export function scopeCovers(appliesTo: string, driverType: string): boolean {
  if (appliesTo === 'ALL') return true
  if (!isStandingScope(appliesTo)) return false
  return appliesTo === driverType
}

/**
 * The standing charges that reach one driver in one period, AS RULES.
 *
 * Returned in the stored order and handed straight to `computeDeductions`,
 * which decides in-force, cadence, description and sign. Note what is NOT set:
 *
 *   monthlyTotalCents  null — a standing charge has no monthly/weekly split.
 *                      `MONTHLY_SPLIT_WEEKLY` on one would fall back to
 *                      `amountCents` in the engine, which is the right
 *                      instalment, so the cadence stays honest either way.
 *   targetCents        null — a target is a per-driver balance ("$2500 escrow,
 *                      $500 left"). An org-wide ceiling is not a thing anybody
 *                      has asked for and a shared one would race.
 */
export function standingRulesFor(input: {
  charges: readonly StandingChargeRule[]
  exemptions: readonly StandingExemption[]
  driver: StandingSubject
}): RecurringRule[] {
  // THE CHARGE FOLLOWS THE WORK. §6.2.4, and the header says why.
  if (!input.driver.hasFreight) return []

  const exempt = new Set(
    input.exemptions
      .filter((row) => row.driverId === input.driver.id)
      .map((row) => row.standingChargeId),
  )

  return input.charges
    .filter(
      (charge) =>
        !exempt.has(charge.id) &&
        scopeCovers(charge.appliesTo, input.driver.driverType),
    )
    .map((charge) => ({
      id: charge.id,
      type: charge.type,
      description: charge.description,
      amountCents: charge.amountCents,
      cadence: charge.cadence,
      monthlyTotalCents: null,
      targetCents: null,
      effectiveFrom: charge.effectiveFrom,
      effectiveTo: charge.effectiveTo,
    }))
}

// ---------------------------------------------------------------------------
// WRITES
// ---------------------------------------------------------------------------

export type SaveStandingFailure =
  | 'bad_type'
  | 'bad_amount'
  | 'bad_scope'
  | 'bad_dates'
  | 'overlaps'

export type SaveStandingResult =
  | { ok: true; standingChargeId: string }
  | { ok: false; reason: SaveStandingFailure }

export interface SaveStandingInput {
  type: string
  description?: string | null
  amountCents: number
  cadence: DeductionCadence
  appliesTo: string
  effectiveFrom: Date
  effectiveTo?: Date | null
  notes?: string | null
}

/**
 * Open a standing charge, or refuse and say which field.
 *
 * ── THE OVERLAP TEST IS PER TYPE AND PER SCOPE ──────────────────────────
 *
 * Two live `Admin Fee` rows both aimed at `ALL` charge every driver twice, and
 * the driver finds out on Friday — the same failure `saveRecurringDeduction`
 * refuses, one level up.
 *
 * `ALL` CLASHES WITH EVERYTHING OF ITS TYPE, not only with another `ALL`. An
 * `Ifta` for all drivers beside an `Ifta` for owner-operators charges the
 * owner-operators twice, which is exactly the shape somebody reaches for when
 * they mean "all drivers pay $20, owner-operators pay $35". That is two rules
 * with a precedence nobody has specified, so it is refused rather than
 * silently summed.
 */
export async function saveStandingCharge(
  tx: TxClient,
  organizationId: string,
  input: SaveStandingInput,
): Promise<SaveStandingResult> {
  const type = input.type.trim()
  if (type === '') return { ok: false, reason: 'bad_type' }

  // POSITIVE. The engine applies the sign, as it does for every other charge —
  // a negative amount here would pay the driver out of the deduction column,
  // where no screen shows it as earnings.
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, reason: 'bad_amount' }
  }

  if (!isStandingScope(input.appliesTo)) {
    return { ok: false, reason: 'bad_scope' }
  }

  const from = input.effectiveFrom
  const to = input.effectiveTo ?? null
  if (Number.isNaN(from.getTime())) return { ok: false, reason: 'bad_dates' }
  if (to && Number.isNaN(to.getTime()))
    return { ok: false, reason: 'bad_dates' }
  if (to && to.getTime() < from.getTime()) {
    return { ok: false, reason: 'bad_dates' }
  }

  const existing = await tx.standingCharge.findMany({
    where: { type },
    select: {
      id: true,
      appliesTo: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  })
  const clashes = existing.some((row) => {
    const overlaps =
      row.effectiveFrom.getTime() <= (to?.getTime() ?? Infinity) &&
      (row.effectiveTo?.getTime() ?? Infinity) >= from.getTime()
    if (!overlaps) return false
    // See the doc comment: `ALL` on either side reaches the other's drivers.
    return (
      row.appliesTo === 'ALL' ||
      input.appliesTo === 'ALL' ||
      row.appliesTo === input.appliesTo
    )
  })
  if (clashes) return { ok: false, reason: 'overlaps' }

  const created = await tx.standingCharge.create({
    data: {
      organizationId,
      type,
      description: input.description ?? null,
      amountCents: input.amountCents,
      cadence: input.cadence,
      appliesTo: input.appliesTo,
      effectiveFrom: from,
      effectiveTo: to,
      notes: input.notes ?? null,
    },
    select: { id: true },
  })
  return { ok: true, standingChargeId: created.id }
}

export type CloseStandingResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'bad_dates' }

/**
 * Stop a standing charge on a date.
 *
 * SUPERSEDED, NEVER EDITED — the amount and the scope are not touched here, for
 * the reason the schema gives beside the model: these land on statements that
 * have been handed to a person. Changing one means closing this row and opening
 * another, and a FINAL or PAID statement keeps what it printed because its
 * lines are its own rows.
 */
export async function closeStandingCharge(
  tx: TxClient,
  standingChargeId: string,
  effectiveTo: Date,
): Promise<CloseStandingResult> {
  const row = await tx.standingCharge.findFirst({
    where: { id: standingChargeId },
    select: { id: true, effectiveFrom: true },
  })
  if (!row) return { ok: false, reason: 'not_found' }
  if (Number.isNaN(effectiveTo.getTime())) {
    return { ok: false, reason: 'bad_dates' }
  }
  // A CHARGE CANNOT END BEFORE IT STARTED. Stored, that row is in force for no
  // period at all and reads as a mistake nobody can date.
  if (effectiveTo.getTime() < row.effectiveFrom.getTime()) {
    return { ok: false, reason: 'bad_dates' }
  }
  await tx.standingCharge.update({
    where: { id: row.id },
    data: { effectiveTo },
  })
  return { ok: true }
}

export type ExemptResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'no_reason' | 'already_exempt' }

/**
 * Exempt one driver from one standing charge.
 *
 * THE REASON IS REQUIRED, as the schema says: an exemption nobody can explain
 * is one nobody can review, and "this driver does not pay Ifta" is a decision
 * somebody made rather than an absence to be inferred.
 */
export async function exemptDriver(
  tx: TxClient,
  input: { standingChargeId: string; driverId: string; reason: string },
): Promise<ExemptResult> {
  const reason = input.reason.trim()
  if (reason === '') return { ok: false, reason: 'no_reason' }

  const [charge, driver] = await Promise.all([
    tx.standingCharge.findFirst({
      where: { id: input.standingChargeId },
      select: { id: true, organizationId: true },
    }),
    tx.driver.findFirst({
      where: { id: input.driverId, deletedAt: null },
      select: { id: true },
    }),
  ])
  if (!charge || !driver) return { ok: false, reason: 'not_found' }

  const existing = await tx.standingChargeExemption.findFirst({
    where: { standingChargeId: charge.id, driverId: driver.id },
    select: { id: true },
  })
  if (existing) return { ok: false, reason: 'already_exempt' }

  await tx.standingChargeExemption.create({
    data: {
      organizationId: charge.organizationId,
      standingChargeId: charge.id,
      driverId: driver.id,
      reason,
    },
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// READS
// ---------------------------------------------------------------------------

export interface StandingChargeListRow {
  id: string
  type: string
  description: string | null
  amountCents: number
  cadence: DeductionCadence
  appliesTo: string
  effectiveFrom: Date
  effectiveTo: Date | null
  notes: string | null
  /** How many drivers are exempt. Zero is the normal case. */
  exemptCount: number
  /** In force on the day this was read — same meaning as `ChargeRow`. */
  inForceToday: boolean
}

/**
 * Every standing charge in the organization.
 *
 * ── NO COMPANY SCOPE, AND THAT IS THE MODEL ─────────────────────────────
 *
 * `listCharges` filters through the driver because a recurring deduction
 * belongs to one. A standing charge belongs to the ORGANIZATION and has no
 * company at all, so there is nothing to narrow — row-level security is the
 * whole fence here. A reader scoped to one authority sees the org's standing
 * charges because that is what they are: the group's rules, which is why they
 * are not on the drivers' tab.
 */
export async function listStandingCharges(
  tx: TxClient,
): Promise<StandingChargeListRow[]> {
  const rows = await tx.standingCharge.findMany({
    orderBy: [{ type: 'asc' }, { effectiveFrom: 'desc' }],
    select: {
      id: true,
      type: true,
      description: true,
      amountCents: true,
      cadence: true,
      appliesTo: true,
      effectiveFrom: true,
      effectiveTo: true,
      notes: true,
      _count: { select: { exemptions: true } },
    },
  })

  const today = Date.now()
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    description: row.description,
    amountCents: row.amountCents,
    cadence: row.cadence,
    appliesTo: row.appliesTo,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    notes: row.notes,
    exemptCount: row._count.exemptions,
    inForceToday:
      row.effectiveFrom.getTime() <= today &&
      (row.effectiveTo === null || row.effectiveTo.getTime() >= today),
  }))
}

/**
 * The charges and exemptions a settlement run needs, in two reads.
 *
 * ── EVERY CHARGE, NOT THE ONES IN FORCE ─────────────────────────────────
 *
 * `computeDeductions` decides in-force against the settlement's own period, and
 * it is the only thing that should: a run rebuilding a statement for a week in
 * August must use the rules that were live in August, not the ones live now.
 * Narrowing here with a `where` on today's date would quietly re-date every
 * historical refresh — the same class of error as supplying the baseline you
 * are testing.
 */
export async function readStandingChargesForRun(tx: TxClient): Promise<{
  charges: StandingChargeRule[]
  exemptions: StandingExemption[]
}> {
  const [charges, exemptions] = await Promise.all([
    tx.standingCharge.findMany({
      orderBy: [{ type: 'asc' }, { effectiveFrom: 'asc' }],
      select: {
        id: true,
        type: true,
        description: true,
        amountCents: true,
        cadence: true,
        appliesTo: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    }),
    tx.standingChargeExemption.findMany({
      select: { standingChargeId: true, driverId: true, reason: true },
    }),
  ])
  return { charges, exemptions }
}

/** The exemptions on one charge, with the driver's name, for the detail row. */
export async function listExemptions(
  tx: TxClient,
  standingChargeId: string,
  where: Prisma.DriverWhereInput = {},
): Promise<
  { id: string; driverId: string; driverName: string; reason: string }[]
> {
  const rows = await tx.standingChargeExemption.findMany({
    where: { standingChargeId, driver: { deletedAt: null, ...where } },
    orderBy: [{ driver: { lastName: 'asc' } }],
    select: {
      id: true,
      driverId: true,
      reason: true,
      driver: { select: { firstName: true, lastName: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    driverId: row.driverId,
    driverName: `${row.driver.lastName}, ${row.driver.firstName}`,
    reason: row.reason,
  }))
}
