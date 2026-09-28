import type { Prisma } from '@/generated/prisma/client'
import { computeBatch, isSettlementWeek, weekOf } from './settlement-week'
import { batchInputForOrg } from './settlement-batch'
import type { Week } from './settlement-week'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// ONE WEEK OF PAYROLL, WHICHEVER WEEK IS ASKED FOR.
//
// ── WHAT THIS REPLACES ────────────────────────────────────────────────────
//
// `/money/this-week` answered "the week that is due" and could answer no other.
// `/settlements/batches` listed batches. `/settlements` listed per-driver
// settlements. Three screens, one question between them — what does a week cost
// per driver, and what state is it in — and the week was a ROUTE on two of them
// and not addressable on the third.
//
// HERE THE WEEK IS A PARAMETER. §6.2's Payroll page selects it, and every past
// week is reachable without knowing a batch id. That is the whole of why the
// three collapse into one.
//
// ── PER-DRIVER STATUS IS DERIVED, NEVER STORED ────────────────────────────
//
// `blocked` and `held` are facts about what is MISSING — a driver with no pay
// rule, a load whose remittance has not arrived — and a stored absence goes
// stale the moment somebody supplies the thing. The batch detail screen has
// recomputed them for display since MONEY-DESIGN item 3; this is the same call,
// moved somewhere both the list and the detail can reach it.
// ---------------------------------------------------------------------------

/** A driver's line in the week, in the four columns the ruling names. */
export interface PayrollRow {
  settlementId: string
  settlementNumber: string | null
  driverId: string
  driverName: string
  unitNumber: string | null
  grossCents: number
  deductionsCents: number
  otherPayCents: number
  netCents: number
  loadCount: number
  /**
   * Why this driver's line needs attention, most severe first.
   *
   * `blocked` BEATS `held` BEATS the batch's own state. A driver who cannot be
   * paid at all is not "draft" — the batch may well be draft, and saying so on
   * their row would bury the one fact that stops the week finalising.
   */
  state: PayrollRowState
  /** Set only when `state` is blocked or held. The sentence, by key. */
  reason: string | null
}

export type PayrollRowState =
  | 'blocked'
  | 'held'
  | 'draft'
  | 'final'
  | 'paid'
  | 'negative'

export interface PayrollWeek {
  period: Week
  /** Null when no batch covers this week yet. */
  batch: {
    id: string
    batchNumber: string | null
    status: string
    statementDate: Date
    checkDate: Date
  } | null
  rows: PayrollRow[]
  /** Named, so the screen can list them even where no settlement row exists. */
  blockers: { driverId: string; driverName: string; reason: string }[]
  heldCount: number
  heldSumCents: number
}

/**
 * The week a `?week=` parameter names, or null if it does not name one.
 *
 * SNAPPED TO ITS SUNDAY, like the batch form does: "the week of the 22nd" is a
 * thing somebody means, and a typed Monday would otherwise select a period that
 * settles the same loads under a different name.
 *
 * REFUSED RATHER THAN GUESSED for anything that is not a day — a mangled URL
 * opens the default week rather than a week nobody chose.
 */
export function weekFromParam(value: string | null): Week | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const day = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(day.getTime())) return null
  if (day.toISOString().slice(0, 10) !== value) return null
  const week = weekOf(day)
  return isSettlementWeek(week) ? week : null
}

/** `count` consecutive settlement weeks ending with the one given, newest first. */
export function recentWeeks(latest: Week, count: number): Week[] {
  const weeks: Week[] = []
  for (let back = 0; back < count; back++) {
    const shift = back * 7 * 86_400_000
    weeks.push({
      start: new Date(latest.start.getTime() - shift),
      end: new Date(latest.end.getTime() - shift),
    })
  }
  return weeks
}

const HELD_REASON: Record<string, string> = {
  no_remittance: 'batch.held.noRemittance',
  over: 'batch.held.over',
  short: 'batch.held.short',
}

const BLOCKER_REASON: Record<string, string> = {
  no_pay_rule: 'batch.blocker.noPayRule',
  pay_rule_unusable: 'batch.blocker.ruleUnusable',
}

/**
 * Read one week: its batch if there is one, its driver rows, and what is wrong.
 *
 * WHERE THERE IS NO BATCH the rows are empty and `blockers` is still populated,
 * because "who could not be paid" is answerable before anybody opens anything —
 * and it is the answer somebody needs BEFORE they press Open, not after.
 */
export async function payrollWeek(
  tx: TxClient,
  input: { organizationId: string; period: Week },
): Promise<PayrollWeek> {
  const batch = await tx.settlementBatch.findFirst({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      periodStart: input.period.start,
    },
    select: {
      id: true,
      batchNumber: true,
      status: true,
      statementDate: true,
      checkDate: true,
      settlements: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          settlementNumber: true,
          unitNumber: true,
          earningsCents: true,
          deductionsCents: true,
          otherPayCents: true,
          netCents: true,
          driverId: true,
          driver: { select: { firstName: true, lastName: true } },
          loadLines: { select: { id: true } },
        },
      },
    },
  })

  // THE ENGINE IS ASKED ONLY WHERE ITS ANSWER IS ABOUT SOMETHING UNSETTLED.
  //
  // A FINAL or PAID batch is frozen: its held lines are simply loads still
  // waiting, which belong to a later week's draft, and it could not have been
  // finalised with a blocker. Recomputing there would print a problem against a
  // week nobody can act on — which is the batch screen's own rule, kept.
  const live = batch === null || batch.status === 'DRAFT'
  const computed = live
    ? computeBatch({
        period: input.period,
        // These two only reach the printed statement, and nothing here prints
        // one. The batch's own dates where there is a batch; the period's end
        // otherwise, so the call is well-formed for a week not yet opened.
        statementDate: batch?.statementDate ?? input.period.end,
        checkDate: batch?.checkDate ?? input.period.end,
        drivers: await batchInputForOrg(tx, {
          organizationId: input.organizationId,
          period: input.period,
          statementDate: batch?.statementDate ?? input.period.end,
          checkDate: batch?.checkDate ?? input.period.end,
        }),
      })
    : { held: [], blockers: [], negative: [] }

  const heldByDriver = new Map<string, string>()
  for (const row of computed.held) {
    if (!heldByDriver.has(row.driverId)) {
      heldByDriver.set(
        row.driverId,
        HELD_REASON[row.line.reason.kind] ?? 'batch.held.short',
      )
    }
  }
  const blockedByDriver = new Map<string, string>()
  for (const row of computed.blockers) {
    blockedByDriver.set(
      row.driverId,
      BLOCKER_REASON[row.blocker.kind] ?? 'batch.blocker.ruleUnusable',
    )
  }
  const negativeIds = new Set(computed.negative.map((row) => row.driverId))

  const statusState: Record<string, PayrollRowState> = {
    DRAFT: 'draft',
    FINAL: 'final',
    PAID: 'paid',
  }

  const rows: PayrollRow[] = (batch?.settlements ?? []).map((settlement) => {
    const blocked = blockedByDriver.get(settlement.driverId) ?? null
    const held = heldByDriver.get(settlement.driverId) ?? null
    // The precedence the interface reads, worst first. See `PayrollRow.state`.
    const state: PayrollRowState = blocked
      ? 'blocked'
      : negativeIds.has(settlement.driverId)
        ? 'negative'
        : held
          ? 'held'
          : (statusState[batch?.status ?? 'DRAFT'] ?? 'draft')
    return {
      settlementId: settlement.id,
      settlementNumber: settlement.settlementNumber,
      driverId: settlement.driverId,
      driverName: `${settlement.driver.firstName} ${settlement.driver.lastName}`,
      unitNumber: settlement.unitNumber,
      grossCents: settlement.earningsCents,
      deductionsCents: settlement.deductionsCents,
      otherPayCents: settlement.otherPayCents,
      netCents: settlement.netCents,
      loadCount: settlement.loadLines.length,
      state,
      reason: blocked ?? held ?? null,
    }
  })

  return {
    period: input.period,
    batch: batch
      ? {
          id: batch.id,
          batchNumber: batch.batchNumber,
          status: batch.status,
          statementDate: batch.statementDate,
          checkDate: batch.checkDate,
        }
      : null,
    rows,
    blockers: computed.blockers.map((row) => ({
      driverId: row.driverId,
      driverName: row.driverName,
      reason: BLOCKER_REASON[row.blocker.kind] ?? 'batch.blocker.ruleUnusable',
    })),
    heldCount: computed.held.length,
    // THE RATE, because that is what a held line is worth — the money that
    // could not be settled. `HeldLine` has no other figure on it.
    heldSumCents: computed.held.reduce(
      (sum, row) => sum + row.line.rateCents,
      0,
    ),
  }
}
