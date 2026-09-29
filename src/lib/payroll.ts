import type { Prisma } from '@/generated/prisma/client'
import { computeBatch, isSettlementWeek, weekOf } from './settlement-week'
import { batchInputForOrg, settleableForBatch } from './settlement-batch'
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
/**
 * The batch covering one week, and nothing that costs the engine.
 *
 * ── SPLIT OUT OF `payrollWeek` BECAUSE THE STRIP COST 8.5 SECONDS ────────
 *
 * Measured on dev, 2026-09-29: `readBatches` 408ms and 2 statements,
 * `payrollWeek` 8,493ms and 9 — so the Batches page was 95% one call, and
 * every load of it recomputed every driver's settlement to find out who was
 * blocked. On a cold worker that is also the likeliest explanation for the one
 * 500 nothing could reproduce.
 *
 * THIS IS THE PART THE HEADER AND THE GRID NEED, and it is one query. Whether
 * a batch exists, what state it is in, its two dates: enough to render the page
 * and decide which action button to show. The blockers stream in behind it.
 */
export async function weekBatch(
  tx: TxClient,
  input: { organizationId: string; period: Week },
): Promise<PayrollWeek['batch']> {
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
    },
  })
  return batch
}

export interface WeekTrouble {
  blockers: { driverId: string; driverName: string; reason: string }[]
  heldCount: number
  heldSumCents: number
  /** True where the blockers were derived from stored rows (see below). */
  fromStored: boolean
}

/**
 * Who cannot be paid for this week, and what is held.
 *
 * ── STORED WHERE A BATCH EXISTS, COMPUTED ONLY WHERE ONE DOES NOT ────────
 *
 * Owner's ruling, 2026-09-29. A batch that exists has already had the engine
 * run over it — that is what `refreshDraft` does, and it WRITES the answer: a
 * settlement row per driver it could price. So "who is blocked" is answerable
 * from rows rather than by running the engine again: a driver with settleable
 * freight in the period and no settlement in the batch is a driver the last
 * refresh could not pay.
 *
 * TWO QUERIES INSTEAD OF NINE, and no `computeBatch`. What it gives up is the
 * REASON — stored rows say a driver is missing, not whether it was a missing
 * pay rule or an unusable one — so the stored path reports one reason and says
 * so. The precise reason is a click away on the batch itself, which is where
 * somebody goes to fix it.
 *
 * AND IT IS AS FRESH AS THE DRAFT IS. A rule added since the last refresh will
 * not show until somebody refreshes, which is exactly what the Refresh button
 * is for and exactly what the figures beside it already mean. The alternative —
 * recomputing on every page load — is the 8.5 seconds this replaces.
 *
 * WITH NO BATCH THERE IS NOTHING STORED, so the engine runs. That is the
 * expensive path and it is the one where the answer cannot come from anywhere
 * else: "who could not be paid if I opened this week" is a question about a
 * batch that does not exist. It streams in behind the grid.
 */
export async function weekTrouble(
  tx: TxClient,
  input: {
    organizationId: string
    period: Week
    batchId: string | null
    batchStatus: string | null
  },
): Promise<WeekTrouble> {
  // A FINAL OR PAID BATCH HAS NEITHER, BY DEFINITION. It could not have been
  // finalised with a blocker, and its held lines are loads still waiting, which
  // belong to a later week's draft.
  if (input.batchId !== null && input.batchStatus !== 'DRAFT') {
    return { blockers: [], heldCount: 0, heldSumCents: 0, fromStored: true }
  }

  if (input.batchId !== null) {
    const [seated, settled] = await Promise.all([
      // Everyone with settleable freight in the week, by name. `distinct` keeps
      // this one row per driver rather than one per load.
      tx.load.findMany({
        where: settleableForBatch(null, input.period),
        select: {
          driverId: true,
          driver: { select: { firstName: true, lastName: true } },
        },
        distinct: ['driverId'],
      }),
      tx.settlement.findMany({
        where: { batchId: input.batchId, deletedAt: null },
        select: { driverId: true },
      }),
    ])

    const paid = new Set(settled.map((row) => row.driverId))
    const blockers = seated
      .filter((row) => row.driverId !== null && !paid.has(row.driverId))
      .map((row) => ({
        driverId: row.driverId!,
        driverName: row.driver
          ? `${row.driver.firstName} ${row.driver.lastName}`
          : row.driverId!,
        // ONE REASON, AND IT SAYS IT IS THE STORED ONE. The engine distinguishes
        // a missing pay rule from an unusable one; rows cannot, and claiming the
        // more specific of the two would be inventing a diagnosis.
        reason: 'batch.blocker.notInBatch',
      }))

    return {
      blockers,
      // HELD LINES ARE NOT DERIVABLE FROM ROWS. A held line is a load the engine
      // declined to price; nothing is written for it, so the absence looks
      // exactly like a load nobody has. Reported as unknown rather than zero —
      // §8's rule that empty and zero are different facts.
      heldCount: -1,
      heldSumCents: 0,
      fromStored: true,
    }
  }

  const computed = computeBatch({
    period: input.period,
    statementDate: input.period.end,
    checkDate: input.period.end,
    drivers: await batchInputForOrg(tx, {
      organizationId: input.organizationId,
      period: input.period,
      statementDate: input.period.end,
      checkDate: input.period.end,
    }),
  })

  return {
    blockers: computed.blockers.map((row) => ({
      driverId: row.driverId,
      driverName: row.driverName,
      reason: BLOCKER_REASON[row.blocker.kind] ?? 'batch.blocker.ruleUnusable',
    })),
    heldCount: computed.held.length,
    heldSumCents: computed.held.reduce(
      (sum, row) => sum + row.line.rateCents,
      0,
    ),
    fromStored: false,
  }
}
