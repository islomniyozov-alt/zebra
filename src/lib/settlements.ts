import type {
  Prisma,
  SettlementLineType,
  SettlementStatus,
  PaymentMethod,
} from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { lastFullWeekEnding } from './settings'
import { allocateNumber } from './counters'
import { sheetDates, type SheetDates, type SheetStop } from './stop-actuals'
import { NOT_CLOSED_HISTORY } from './billing-status'
import {
  amountFromSnapshot,
  payFor,
  readSnapshot,
  ruleInForce,
  type PayFailure,
  type PayRule,
  type PayableLoad,
  type PaySnapshot,
} from './driver-pay'

// ---------------------------------------------------------------------------
// WEEKLY DRIVER SETTLEMENTS (Phase 3 §5 step 6).
//
// A settlement is a DOCUMENT a driver is handed on Friday. It says what they
// hauled, what each load paid and why, what was taken off and what was paid
// back, and what lands in their account. Once approved it is evidence, and
// evidence that changes when somebody edits a percentage is not evidence.
//
// SO EVERY LINE CARRIES ITS OWN SNAPSHOT. `SettlementLine.payRuleSnapshot`
// holds the rule, the basis and the result — enough to recompute the figure by
// hand with no lookup at all. `findSettlementDrift` recomputes every line from
// its own snapshot and `npm run check` fails on a mismatch, which is what makes
// "a regenerated settlement reproduces exactly" a checkable claim rather than
// an intention.
//
// SIGNED AMOUNTS, ONE SUM. Earnings positive, deductions negative, net is a
// plain total (the schema says so and it is right). A deductions column that
// stores positives and subtracts them elsewhere is how a settlement ends up
// $200 out in the driver's favour and nobody notices for a quarter.
//
// GENERATION IS SHORT READ, COMPUTE, SHORT WRITE (counters.ts, brief §6). The
// counter row is locked from `allocateNumber` to commit, so everything that can
// happen before it does: the loads and the rules are read, every figure is
// computed in memory, and only then is one write opened.
// ---------------------------------------------------------------------------

/** Line types that are money OFF. Everything else is money on. */
const DEDUCTION_TYPES: readonly SettlementLineType[] = [
  'DEDUCTION_ADVANCE',
  'DEDUCTION_FUEL',
  'DEDUCTION_INSURANCE',
  'DEDUCTION_ESCROW',
  'DEDUCTION_EQUIPMENT',
  'DEDUCTION_VIOLATION',
  'DEDUCTION_OTHER',
]

export function isDeduction(type: SettlementLineType): boolean {
  return DEDUCTION_TYPES.includes(type)
}

/**
 * Loads a settlement would cover: POD received in the period, not yet settled.
 *
 * WHICH WEEK A LOAD BELONGS TO is decided by the POD, and the date comes from
 * the STATUS EVENT that recorded it rather than from a column on Load. There
 * is no `Load.deliveredAt` — and rather than add one, which would be a fourth
 * cached column needing a fourth drift check, this asks the event that
 * actually happened. `LoadStatusEvent` is indexed on `[loadId, occurredAt]`.
 *
 * POD RECEIVED, not delivered, for two reasons. A driver is paid for freight
 * that is FINISHED, and finished here means the paperwork landed — the same
 * bar `readyToInvoiceWhere` uses. And the POD event is the one that always
 * exists: a Delivered click arriving after the POD is refused as stale (see
 * load-status.ts), so a load can reach POD_RECEIVED with no applied DELIVERED
 * event at all, and a period keyed on delivery would silently lose it.
 *
 * `outcome: 'APPLIED'` because a refused transition is recorded too, and a
 * refusal is not a delivery.
 *
 * `settlementLines: { none: {} }` is the RELATION, not a status column — the
 * same argument as `invoiceLines: { none: {} }` in invoices.ts. The honest
 * question is "is this load already on a settlement", and only the relation
 * answers it.
 */
/**
 * What makes a load settleable AT ALL, before any driver or period is named.
 *
 * ── THE OWNER'S RULING OF 2026-09-10, AND WHY IT IS A DEFINITION ─────────
 *
 * "Refuse if any settleable load picks up before effectiveFrom — imported
 * closed-in-Datatruck history is excluded."
 *
 * That could have been a clause in the seed's guard. It is here instead,
 * because the guard and the settlement engine have to mean the SAME THING by
 * "settleable" or the guard is checking a population the engine does not use.
 * One rule, two callers — the argument this codebase keeps making about a rule
 * living in one place.
 *
 * ── EXCLUDING CLOSED HISTORY IS A FIX, NOT ONLY A NARROWING ──────────────
 *
 * `settleableWhere` did not carry `NOT_CLOSED_HISTORY` before today, and the
 * import's own ruling was "no historical driver pay, no historical
 * settlements". So a load that Datatruck already settled — POD_RECEIVED,
 * unsettled HERE because no settlement of ours has ever touched it — would
 * have been picked up by the next settlement run and paid a second time.
 * Production carries two of those on truck 7072 today (1015 and 1016).
 *
 * Nothing had gone wrong yet only because no settlement has been run against
 * imported freight. That is a coincidence, not a rule, and a coincidence is
 * not a thing to leave holding wages up.
 *
 * IT IS THE BILLING AXIS THAT SAYS SO, not a date and not an `externalId` —
 * the reasoning `NOT_CLOSED_HISTORY` records in full. A load somebody
 * legitimately reopens stops being closed and becomes settleable again, which
 * is the correct behaviour and falls out of asking the status.
 */
export const SETTLEABLE_LOAD: Prisma.LoadWhereInput = {
  deletedAt: null,
  isCancelled: false,
  ...NOT_CLOSED_HISTORY,
}

export function settleableWhere(
  driverId: string,
  periodStart: Date,
  periodEnd: Date,
): Prisma.LoadWhereInput {
  return {
    ...SETTLEABLE_LOAD,
    driverId,
    operationalStatus: 'POD_RECEIVED',
    statusEvents: {
      some: {
        axis: 'OPERATIONAL',
        toStatus: 'POD_RECEIVED',
        outcome: 'APPLIED',
        occurredAt: { gte: periodStart, lte: periodEnd },
      },
    },
    settlementLines: { none: {} },
  }
}

export interface SettleableLoad extends PayableLoad {
  /** When the POD landed. From the status event, not a column. */
  podReceivedAt: Date | null
  /** The stops the sheet's PU and DEL dates are taken from. */
  stops: SheetStop[]
}

export async function settleableLoads(
  tx: TxClient,
  driverId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<SettleableLoad[]> {
  const loads = await tx.load.findMany({
    where: settleableWhere(driverId, periodStart, periodEnd),
    orderBy: { loadNumber: 'asc' },
    select: {
      id: true,
      loadNumber: true,
      linehaulCents: true,
      fuelSurchargeCents: true,
      accessorialsCents: true,
      totalRevenueCents: true,
      actualMiles: true,
      dispatchedMiles: true,
      // THE SHEET DATES' SOURCE. Sequence and type decide which stop is the
      // pickup and which the delivery; the three time columns decide whether
      // each date is a record or a plan.
      stops: {
        select: {
          sequence: true,
          type: true,
          scheduledAt: true,
          arrivedAt: true,
          departedAt: true,
        },
      },
      statusEvents: {
        where: {
          axis: 'OPERATIONAL',
          toStatus: 'POD_RECEIVED',
          outcome: 'APPLIED',
        },
        orderBy: { occurredAt: 'asc' },
        take: 1,
        select: { occurredAt: true },
      },
    },
  })

  return loads.map((load) => ({
    stops: load.stops,
    id: load.id,
    loadNumber: load.loadNumber,
    linehaulCents: load.linehaulCents,
    fuelSurchargeCents: load.fuelSurchargeCents,
    accessorialsCents: load.accessorialsCents,
    totalRevenueCents: load.totalRevenueCents,
    actualMiles: load.actualMiles,
    dispatchedMiles: load.dispatchedMiles,
    podReceivedAt: load.statusEvents[0]?.occurredAt ?? null,
  }))
}

/**
 * The last full Monday-to-Sunday week, as ISO dates.
 *
 * The default the generate panel offers. Computed on the SERVER so it does not
 * depend on the browser's clock or timezone — two people opening the screen at
 * the same moment in different places must be offered the same week.
 *
 * Sunday is a special case worth stating: on a Sunday the week that ends today
 * is not finished, so the answer is the week before it.
 */
export function lastFullWeek(today: Date): { start: string; end: string } {
  // Sunday, which is what this function hard-coded before Phase 4 step 6 gave
  // the boundary a column. One computation, in settings.ts — two would be two
  // answers to "which week is being settled" the first time somebody moved the
  // boundary and only one of them noticed.
  return lastFullWeekEnding(today, 0)
}

// --- generation --------------------------------------------------------------

export type GenerateFailure =
  | 'driver_not_found'
  | 'no_loads'
  | 'bad_period'
  | 'no_rule'
  | 'custom_unsupported'
  | 'rule_incomplete'
  | 'no_miles'

export interface GenerateOutcome {
  ok: true
  settlementId: string
  settlementNumber: string
  grossCents: number
  netCents: number
  loadCount: number
}

export type GenerateResult =
  | GenerateOutcome
  | { ok: false; reason: GenerateFailure; loadNumbers?: string[] }

export interface GenerateInput {
  driverId: string
  periodStart: Date
  periodEnd: Date
  /** Line descriptions are written in the generating user's locale and frozen. */
  labels: {
    loadPay: (loadNumber: string) => string
  }
}

export async function generateSettlement(
  tx: TxClient,
  organizationId: string,
  input: GenerateInput,
): Promise<GenerateResult> {
  const { driverId, periodStart, periodEnd } = input

  if (
    Number.isNaN(periodStart.getTime()) ||
    Number.isNaN(periodEnd.getTime()) ||
    periodEnd.getTime() < periodStart.getTime()
  ) {
    return { ok: false, reason: 'bad_period' }
  }

  // --- short read -----------------------------------------------------------
  const driver = await tx.driver.findFirst({
    where: { id: driverId, deletedAt: null },
    select: { id: true, companyId: true, firstName: true, lastName: true },
  })
  if (!driver) return { ok: false, reason: 'driver_not_found' }

  const loads = await settleableLoads(tx, driverId, periodStart, periodEnd)
  if (loads.length === 0) return { ok: false, reason: 'no_loads' }

  const rules: PayRule[] = await tx.driverPayRule.findMany({
    where: { driverId },
    select: {
      id: true,
      type: true,
      percentBps: true,
      perMileCents: true,
      flatCents: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  })

  // --- compute, in memory ---------------------------------------------------
  const lines: ({
    loadId: string
    description: string
    amountCents: number
    snapshot: PaySnapshot
  } & SheetDates)[] = []
  const refused: { reason: PayFailure; loadNumber: string }[] = []

  for (const load of loads) {
    // The rule in force WHEN THE LOAD RAN, not today's. A driver who got a
    // raise on Wednesday is paid the old rate for Monday's freight, which is
    // what both parties agreed and what a regeneration has to reproduce.
    const rule = ruleInForce(rules, load.podReceivedAt ?? periodEnd)
    const result = payFor(load, rule)

    if (!result.ok) {
      refused.push({ reason: result.reason, loadNumber: load.loadNumber })
      continue
    }

    lines.push({
      loadId: load.id,
      description: input.labels.loadPay(load.loadNumber),
      amountCents: result.amountCents,
      snapshot: result.snapshot,
      // FROZEN HERE, beside the pay rule and for the same reason: a later
      // import that enriches this load with actuals must not rewrite a cheque
      // already handed over.
      ...sheetDates(load.stops),
    })
  }

  // ANY refusal stops the whole settlement. A settlement that quietly omits
  // the one load whose rule was missing is a short cheque with no explanation
  // on it, and the driver finds the gap before the office does.
  if (refused.length > 0) {
    const first = refused[0]!.reason
    return {
      ok: false,
      reason: first,
      loadNumbers: refused
        .filter((row) => row.reason === first)
        .map((row) => row.loadNumber),
    }
  }

  const grossCents = lines.reduce((sum, line) => sum + line.amountCents, 0)

  // --- short write ----------------------------------------------------------
  // From here to commit the counter row is held. Nothing above happens inside
  // this window, which is what keeps concurrent generation from timing out on
  // the row lock (counters.ts).
  const number = await allocateNumber(tx, driver.companyId, 'SETTLEMENT_NUMBER')
  const settlementNumber = `STL-${number}`

  const settlement = await tx.settlement.create({
    data: {
      organizationId,
      companyId: driver.companyId,
      settlementNumber,
      driverId: driver.id,
      periodStart,
      periodEnd,
      status: 'DRAFT',
      grossCents,
      deductionsCents: 0,
      reimbursementsCents: 0,
      netCents: grossCents,
      lines: {
        create: lines.map((line, index) => ({
          organizationId,
          loadId: line.loadId,
          type: 'LOAD_PAY' as const,
          description: line.description,
          amountCents: line.amountCents,
          payRuleSnapshot: line.snapshot as unknown as Prisma.InputJsonValue,
          sortOrder: index,
          puAt: line.puAt,
          puActual: line.puActual,
          delAt: line.delAt,
          delActual: line.delActual,
        })),
      },
    },
    select: { id: true, settlementNumber: true },
  })

  return {
    ok: true,
    settlementId: settlement.id,
    settlementNumber: settlement.settlementNumber,
    grossCents,
    netCents: grossCents,
    loadCount: lines.length,
  }
}

// --- deductions and reimbursements -------------------------------------------

export type LineFailure =
  | 'not_found'
  | 'not_draft'
  | 'bad_amount'
  | 'no_description'
  | 'wrong_sign'

export type LineResult =
  | { ok: true; lineId: string; netCents: number }
  | { ok: false; reason: LineFailure }

export interface AddLineInput {
  type: SettlementLineType
  description: string
  /** POSITIVE as typed. The sign is decided by the type, not by the typist. */
  amountCents: number
}

/**
 * Add a deduction or a reimbursement to a draft settlement.
 *
 * The amount is typed POSITIVE and signed here from the type. Asking a person
 * to type "-150.00" for a fuel advance is asking for the day somebody types
 * "150.00" instead and the driver is paid $300 more than they should be.
 */
export async function addSettlementLine(
  tx: TxClient,
  settlementId: string,
  input: AddLineInput,
): Promise<LineResult> {
  const description = input.description.trim()
  if (description === '') return { ok: false, reason: 'no_description' }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, reason: 'bad_amount' }
  }

  const settlement = await tx.settlement.findFirst({
    where: { id: settlementId, deletedAt: null },
    select: { id: true, organizationId: true, status: true },
  })
  if (!settlement) return { ok: false, reason: 'not_found' }

  // APPROVED IS FROZEN. A settlement a driver has been shown does not gain a
  // deduction afterwards; the way to change it is to void it and generate
  // another, which leaves both in the record.
  if (settlement.status !== 'DRAFT') return { ok: false, reason: 'not_draft' }

  const amountCents = isDeduction(input.type)
    ? -input.amountCents
    : input.amountCents

  const last = await tx.settlementLine.findFirst({
    where: { settlementId: settlement.id },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })

  const line = await tx.settlementLine.create({
    data: {
      settlementId: settlement.id,
      organizationId: settlement.organizationId,
      type: input.type,
      description,
      amountCents,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
    select: { id: true },
  })

  const totals = await refreshTotals(tx, settlement.id)
  return { ok: true, lineId: line.id, netCents: totals.netCents }
}

export async function removeSettlementLine(
  tx: TxClient,
  lineId: string,
): Promise<LineResult> {
  const line = await tx.settlementLine.findFirst({
    where: { id: lineId },
    select: {
      id: true,
      type: true,
      settlement: { select: { id: true, status: true } },
    },
  })
  if (!line) return { ok: false, reason: 'not_found' }
  if (line.settlement.status !== 'DRAFT') {
    return { ok: false, reason: 'not_draft' }
  }
  // Load pay is not removable by hand. Taking a load off a settlement is done
  // by voiding and regenerating, so the settlement always says what the period
  // actually contained.
  if (line.type === 'LOAD_PAY') return { ok: false, reason: 'wrong_sign' }

  await tx.settlementLine.delete({ where: { id: line.id } })
  const totals = await refreshTotals(tx, line.settlement.id)
  return { ok: true, lineId: line.id, netCents: totals.netCents }
}

export interface SettlementTotals {
  grossCents: number
  deductionsCents: number
  reimbursementsCents: number
  netCents: number
}

/**
 * Recompute the four stored totals from the lines.
 *
 * Derived on every write, never adjusted incrementally — the same argument as
 * `refreshUnapplied` in payments.ts. `deductionsCents` is stored POSITIVE
 * (it is a column called "deductions", and a negative deductions figure reads
 * as a refund), while the lines themselves stay signed and net is their sum.
 */
export async function refreshTotals(
  tx: TxClient,
  settlementId: string,
): Promise<SettlementTotals> {
  const lines = await tx.settlementLine.findMany({
    where: { settlementId },
    select: { type: true, amountCents: true },
  })

  let grossCents = 0
  let deductionsCents = 0
  let reimbursementsCents = 0

  for (const line of lines) {
    if (isDeduction(line.type)) {
      deductionsCents += -line.amountCents
    } else if (line.type === 'REIMBURSEMENT') {
      reimbursementsCents += line.amountCents
    } else {
      grossCents += line.amountCents
    }
  }

  // The signed sum, which is the whole reason the lines are signed.
  const netCents = lines.reduce((sum, line) => sum + line.amountCents, 0)

  await tx.settlement.update({
    where: { id: settlementId },
    data: { grossCents, deductionsCents, reimbursementsCents, netCents },
  })

  return { grossCents, deductionsCents, reimbursementsCents, netCents }
}

// --- approve, pay, void -------------------------------------------------------

export type TransitionFailure =
  | 'not_found'
  | 'not_draft'
  | 'not_approved'
  | 'already_paid'
  | 'negative_net'
  | 'no_reference'

export type TransitionResult =
  | { ok: true; status: SettlementStatus }
  | { ok: false; reason: TransitionFailure }

export async function approveSettlement(
  tx: TxClient,
  settlementId: string,
  userId: string | null,
): Promise<TransitionResult> {
  const settlement = await tx.settlement.findFirst({
    where: { id: settlementId, deletedAt: null },
    select: { id: true, status: true, netCents: true },
  })
  if (!settlement) return { ok: false, reason: 'not_found' }
  if (settlement.status !== 'DRAFT') return { ok: false, reason: 'not_draft' }

  // A settlement whose deductions exceed the pay is a debt, not a cheque.
  // Refused here because approving it would produce a PDF asking the driver
  // for money, which is a conversation and not a document.
  if (settlement.netCents < 0) return { ok: false, reason: 'negative_net' }

  await tx.settlement.update({
    where: { id: settlement.id },
    data: {
      status: 'APPROVED',
      approvedByUserId: userId,
      approvedAt: new Date(),
    },
  })
  return { ok: true, status: 'APPROVED' }
}

export interface MarkPaidInput {
  method: PaymentMethod
  reference: string
  paidAt?: Date
}

export async function markSettlementPaid(
  tx: TxClient,
  settlementId: string,
  input: MarkPaidInput,
): Promise<TransitionResult> {
  const reference = input.reference.trim()
  // "Did we pay them?" and "how, and which transfer?" are different questions
  // during a payroll argument, and the second is the one answered wrong from
  // memory a month later. Same reasoning as the invoice channel in §6.
  if (reference === '') return { ok: false, reason: 'no_reference' }

  const settlement = await tx.settlement.findFirst({
    where: { id: settlementId, deletedAt: null },
    select: { id: true, status: true },
  })
  if (!settlement) return { ok: false, reason: 'not_found' }
  if (settlement.status === 'PAID') return { ok: false, reason: 'already_paid' }
  if (settlement.status !== 'APPROVED') {
    return { ok: false, reason: 'not_approved' }
  }

  await tx.settlement.update({
    where: { id: settlement.id },
    data: {
      status: 'PAID',
      paidAt: input.paidAt ?? new Date(),
      paymentMethod: input.method,
      paymentReference: reference,
    },
  })
  return { ok: true, status: 'PAID' }
}

/**
 * Void a settlement, releasing its loads back to the queue.
 *
 * The lines are DELETED rather than kept, because `settleableWhere` asks the
 * relation whether a load is already settled — a kept line would strand the
 * load out of every future settlement. The settlement row itself survives as
 * VOID, so the number is never reused and the record shows it happened.
 */
export async function voidSettlement(
  tx: TxClient,
  settlementId: string,
): Promise<TransitionResult> {
  const settlement = await tx.settlement.findFirst({
    where: { id: settlementId, deletedAt: null },
    select: { id: true, status: true },
  })
  if (!settlement) return { ok: false, reason: 'not_found' }
  if (settlement.status === 'PAID') return { ok: false, reason: 'already_paid' }

  await tx.settlementLine.deleteMany({ where: { settlementId: settlement.id } })
  await tx.settlement.update({
    where: { id: settlement.id },
    data: {
      status: 'VOID',
      grossCents: 0,
      deductionsCents: 0,
      reimbursementsCents: 0,
      netCents: 0,
    },
  })
  return { ok: true, status: 'VOID' }
}

// --- reading ------------------------------------------------------------------

export interface SettlementRow {
  id: string
  settlementNumber: string
  driverName: string
  companyName: string
  periodStart: Date
  periodEnd: Date
  status: SettlementStatus
  grossCents: number
  deductionsCents: number
  netCents: number
  loadCount: number
}

export async function listSettlements(
  tx: TxClient,
  where: Prisma.SettlementWhereInput = {},
): Promise<SettlementRow[]> {
  const settlements = await tx.settlement.findMany({
    where: { deletedAt: null, ...where },
    orderBy: [{ periodEnd: 'desc' }, { settlementNumber: 'desc' }],
    take: 300,
    select: {
      id: true,
      settlementNumber: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      grossCents: true,
      deductionsCents: true,
      netCents: true,
      driver: { select: { firstName: true, lastName: true } },
      company: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  })

  return settlements.map((settlement) => ({
    id: settlement.id,
    settlementNumber: settlement.settlementNumber,
    driverName: `${settlement.driver.firstName} ${settlement.driver.lastName}`,
    companyName: settlement.company.name,
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    status: settlement.status,
    grossCents: settlement.grossCents,
    deductionsCents: settlement.deductionsCents,
    netCents: settlement.netCents,
    loadCount: settlement._count.lines,
  }))
}

export interface SettlementDrift {
  settlementId: string
  settlementNumber: string
  /** What is wrong: a line that does not match its snapshot, or a bad total. */
  problem: 'line_disagrees_with_snapshot' | 'totals_disagree_with_lines'
  detail: string
}

/**
 * Every settlement that no longer reproduces from its own snapshots.
 *
 * Must return nothing. Two ways it can fail, and both are checked:
 *
 *   * a LOAD_PAY line whose amount is not what its own snapshot computes —
 *     which means either the snapshot or the amount was edited, and the
 *     settlement can no longer be reproduced;
 *   * a settlement whose four stored totals do not add up from its lines.
 *
 * This is what makes "approve freezes it" verifiable. A frozen document that
 * nothing checks is a document somebody will eventually edit.
 */
export async function findSettlementDrift(
  tx: TxClient,
): Promise<SettlementDrift[]> {
  const settlements = await tx.settlement.findMany({
    where: { deletedAt: null, status: { not: 'VOID' } },
    select: {
      id: true,
      settlementNumber: true,
      grossCents: true,
      deductionsCents: true,
      reimbursementsCents: true,
      netCents: true,
      lines: {
        select: {
          id: true,
          type: true,
          amountCents: true,
          payRuleSnapshot: true,
        },
      },
    },
  })

  const drift: SettlementDrift[] = []

  for (const settlement of settlements) {
    for (const line of settlement.lines) {
      if (line.type !== 'LOAD_PAY') continue

      const snapshot = readSnapshot(line.payRuleSnapshot)
      if (!snapshot) {
        drift.push({
          settlementId: settlement.id,
          settlementNumber: settlement.settlementNumber,
          problem: 'line_disagrees_with_snapshot',
          detail: `line ${line.id} has no readable snapshot`,
        })
        continue
      }

      const recomputed = amountFromSnapshot(snapshot)
      if (recomputed !== line.amountCents) {
        drift.push({
          settlementId: settlement.id,
          settlementNumber: settlement.settlementNumber,
          problem: 'line_disagrees_with_snapshot',
          detail: `line ${line.id}: stored ${line.amountCents}, snapshot computes ${recomputed}`,
        })
      }
    }

    let gross = 0
    let deductions = 0
    let reimbursements = 0
    for (const line of settlement.lines) {
      if (isDeduction(line.type)) deductions += -line.amountCents
      else if (line.type === 'REIMBURSEMENT') reimbursements += line.amountCents
      else gross += line.amountCents
    }
    const net = settlement.lines.reduce(
      (sum, line) => sum + line.amountCents,
      0,
    )

    if (
      gross !== settlement.grossCents ||
      deductions !== settlement.deductionsCents ||
      reimbursements !== settlement.reimbursementsCents ||
      net !== settlement.netCents
    ) {
      drift.push({
        settlementId: settlement.id,
        settlementNumber: settlement.settlementNumber,
        problem: 'totals_disagree_with_lines',
        detail: `stored ${settlement.grossCents}/${settlement.deductionsCents}/${settlement.reimbursementsCents}/${settlement.netCents}, lines give ${gross}/${deductions}/${reimbursements}/${net}`,
      })
    }
  }

  return drift
}
