import type { Prisma } from '@/generated/prisma/client'
import { SETTLEABLE_LOAD } from './settlements'
import {
  computeBatch,
  isSettlementWeek,
  type BatchResult,
  type DriverSettlementInput,
  type SettleableLoad,
  type Week,
  type YtdCategory,
  type YtdTotals,
} from './settlement-week'

// ---------------------------------------------------------------------------
// THE HALF THAT TALKS TO THE DATABASE.
//
// `settlement-week.ts` is the arithmetic and is graded against six real
// statements. This reads the rows it needs, hands them over, and writes what
// comes back. The split is what lets the acceptance exist: a function that
// queried Prisma could not be pointed at August.
//
// ── DRAFT IS RECOMPUTED, FINAL IS FROZEN ─────────────────────────────────
//
// A draft holds no truth. Every refresh throws its lines away and recomputes
// from the loads, the rules and the charges as they are NOW — which is what
// makes "add the missing pay rule and refresh" a thing a person can do. At
// FINAL the lines stop being a view and become the document: numbers are
// allocated, the escrow ledger moves, charges are marked taken, and nothing
// may edit it again. A correction is a signed charge in a LATER week naming
// the settlement, never a rewrite.
// ---------------------------------------------------------------------------

type TxClient = Prisma.TransactionClient

/**
 * A batch's transaction budget, and it is longer than a load write's on purpose.
 *
 * `LOAD_WRITE_TIMEOUT_MS` is 20s and covers ONE audited write — four round
 * trips at roughly 200ms to us-east-2. A batch writes a settlement per driver
 * with every load line and deduction line under it, and finalising also
 * allocates a number per statement, moves the escrow ledger and marks the
 * one-off charges taken. Fifteen drivers is hundreds of statements in one
 * transaction, and it has to BE one: a batch half-finalised is a week where
 * some drivers have numbers and others do not.
 *
 * NAMED HERE RATHER THAN TYPED AT EACH CALL, so the dial is one place —
 * `tests/transaction-budget.test.ts` requires exactly that and fails on a
 * literal even when the literal is right.
 */
export const SETTLEMENT_BATCH_TIMEOUT_MS = 60_000

export const BATCH_SERIES = 'SETTLEMENT_BATCH'
export const STATEMENT_SERIES = 'SETTLEMENT_STATEMENT'

/** Where a fresh series starts. Datatruck's was already in the five thousands. */
const SERIES_START = 0

/**
 * Take the next number in an ORGANIZATION-WIDE series.
 *
 * One run across both carriers — the artefact interleaves SB-000436 (RAM),
 * SB-000437 (Dolphins), SB-000438 (RAM). Behind row-level security, so a
 * transaction with no tenant set updates nothing and this throws, which is the
 * correct outcome rather than an inconvenience.
 */
export async function allocateSeries(
  tx: TxClient,
  organizationId: string,
  key: string,
): Promise<number> {
  const incremented = await tx.$queryRaw<{ value: number }[]>`
    UPDATE "SeriesCounter" SET value = value + 1, "updatedAt" = now()
      WHERE "organizationId" = ${organizationId} AND key = ${key}
      RETURNING value
  `
  const existing = incremented[0]?.value
  if (typeof existing === 'number') return existing

  const created = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "SeriesCounter" ("id", "organizationId", "key", "value", "updatedAt")
    VALUES (gen_random_uuid()::text, ${organizationId}, ${key}, ${SERIES_START + 1}, now())
    ON CONFLICT ("organizationId", "key")
      DO UPDATE SET value = "SeriesCounter".value + 1, "updatedAt" = now()
    RETURNING value
  `
  const value = created[0]?.value
  if (typeof value !== 'number') {
    throw new Error(`Could not allocate ${key}; the operation must fail.`)
  }
  return value
}

export const batchNumberOf = (value: number) =>
  `SB-${String(value).padStart(6, '0')}`
export const statementNumberOf = (value: number) =>
  `ST-${String(value).padStart(6, '0')}`

// ── reading what a week owes ──────────────────────────────────────────────

/**
 * Every load that may enter a batch.
 *
 * `SETTLEABLE_LOAD` AND NOTHING ELSE. That constant is the single definition of
 * settleable — not cancelled, not deleted, not closed-in-Datatruck history —
 * and it closed a real hole where an imported POD_RECEIVED load could be
 * settled a second time. Re-deriving the condition here would be a second
 * definition, and two definitions of "settleable" is how closed history gets
 * into a batch.
 *
 * A LOAD ALREADY ON A SETTLEMENT IS EXCLUDED BY THE `SettlementLoadLine`
 * UNIQUE, which the database enforces on write. This filter keeps it off the
 * draft as well, so a person never sees a line that cannot be written. Both
 * halves are needed: the filter is the screen, the constraint is the promise.
 */
export function settleableForBatch(
  companyId: string | readonly string[],
  period: Week,
): Prisma.LoadWhereInput {
  return {
    ...SETTLEABLE_LOAD,
    // ONE COMPANY OR SEVERAL, through the same definition. The money screen
    // reads every authority at once and a per-company loop cost it five times
    // the round trips — 16 seconds against 14,464 loads, over a 5s budget.
    companyId:
      typeof companyId === 'string' ? companyId : { in: [...companyId] },
    driverId: { not: null },
    // The DELIVERY is what puts a load in a week — the same date the pay rule
    // is looked up on, so a load cannot be paid under a rule from a week it
    // does not belong to.
    stops: {
      some: {
        type: 'DELIVERY',
        scheduledAt: {
          gte: period.start,
          lte: new Date(period.end.getTime() + 86_399_999),
        },
      },
    },
    settlementLoadLines: { none: {} },
    settlementLines: { none: {} },
  }
}

const placeOf = (
  stop: { city: string | null; state: string | null } | undefined,
) => (stop ? `${stop.city ?? ''},${stop.state ?? ''}` : '')

/**
 * Everything one company's week needs, per driver, ready for the engine.
 *
 * ONE READ, NOT ONE PER DRIVER. A batch of fifteen drivers reading pay rules,
 * recurring deductions, charges, escrow and opening balances separately is
 * seventy-five round trips inside a five-second transaction budget.
 */
export async function batchInputFor(
  tx: TxClient,
  input: {
    organizationId: string
    companyId: string
    period: Week
    statementDate: Date
    checkDate: Date
  },
): Promise<{ drivers: DriverSettlementInput[] }> {
  const many = await batchInputForCompanies(tx, {
    ...input,
    companyIds: [input.companyId],
  })
  return { drivers: many.get(input.companyId) ?? [] }
}

/**
 * The same read, for several authorities at once.
 *
 * ── WHY THIS EXISTS AND `batchInputFor` IS NOW A WRAPPER ─────────────────
 *
 * The money screen reads every company in the organization. Calling the
 * single-company version in a loop made each of its eight queries eight times
 * over — 16.2 seconds against the 14,464 loads on dev, against a five-second
 * transaction budget. The queries were already `driverId: { in: [...] }`
 * shaped; only the company filter and the grouping needed widening.
 *
 * ONE DEFINITION STILL. `settleableForBatch` decides what may settle, for one
 * company or for five, and `batchInputFor` now goes through here — so the
 * screen and the draft cannot drift apart, which was the point of sharing it.
 */
export async function batchInputForCompanies(
  tx: TxClient,
  input: {
    organizationId: string
    companyIds: readonly string[]
    period: Week
    statementDate: Date
    checkDate: Date
  },
): Promise<Map<string, DriverSettlementInput[]>> {
  const byCompany = new Map<string, DriverSettlementInput[]>()
  for (const companyId of input.companyIds) byCompany.set(companyId, [])
  if (input.companyIds.length === 0) return byCompany

  const loads = await tx.load.findMany({
    where: settleableForBatch(input.companyIds, input.period),
    select: {
      id: true,
      loadNumber: true,
      driverId: true,
      totalRevenueCents: true,
      actualMiles: true,
      dispatchedMiles: true,
      settledGrossCents: true,
      customer: { select: { settlesDirectly: true } },
      stops: {
        orderBy: { sequence: 'asc' },
        select: { type: true, city: true, state: true, scheduledAt: true },
      },
      // WHAT AMAZON ACTUALLY PAID, as the remittance importer recorded it.
      // There is no stored "outcome": it is the comparison between this and
      // the booked rate, and deriving it here keeps ONE definition of short.
      paymentApplications: { select: { amountCents: true } },
    },
  })

  const driverIds = [
    ...new Set(loads.map((load) => load.driverId).filter((id) => id !== null)),
  ]

  // ── STANDING DEDUCTIONS, IN ONE READ THAT SERVES TWO PURPOSES ─────────
  //
  // Drivers with recurring deductions but NO loads still get a statement — an
  // idle owner-operator still owes escrow — so they are unioned in rather than
  // derived from the freight.
  //
  // THE `OR` IS WHAT MAKES IT ONE QUERY. By company finds the idle ones; by
  // driver id catches a driver pulling another authority's freight, whose home
  // company may not be in this list at all. Two reads of the same table cost a
  // round trip that the money screen cannot spare, and the union is the same
  // set either way.
  const recurringAll = await tx.recurringDeduction.findMany({
    where: {
      OR: [
        {
          driver: { companyId: { in: [...input.companyIds] }, deletedAt: null },
        },
        { driverId: { in: driverIds } },
      ],
    },
  })
  for (const row of recurringAll) {
    if (!driverIds.includes(row.driverId)) driverIds.push(row.driverId)
  }

  if (driverIds.length === 0) return byCompany

  const year = input.period.start.getUTCFullYear()
  const [drivers, payRules, charges, escrow, opening, prior] =
    await Promise.all([
      tx.driver.findMany({
        where: { id: { in: driverIds } },
        select: {
          id: true,
          companyId: true,
          firstName: true,
          lastName: true,
          payoutLagWeeks: true,
          assignedTruck: { select: { unitNumber: true } },
        },
      }),
      tx.driverPayRule.findMany({ where: { driverId: { in: driverIds } } }),
      tx.settlementCharge.findMany({
        where: { driverId: { in: driverIds }, settledAt: null },
      }),
      tx.driverEscrowEntry.groupBy({
        by: ['driverId'],
        where: { driverId: { in: driverIds } },
        _sum: { amountCents: true },
      }),
      tx.driverOpeningBalance.findMany({
        where: { driverId: { in: driverIds }, year },
      }),
      tx.settlement.findMany({
        where: {
          driverId: { in: driverIds },
          batch: { status: { in: ['FINAL', 'PAID'] } },
          periodStart: { gte: new Date(Date.UTC(year, 0, 1)) },
          periodEnd: { lt: input.period.start },
        },
        select: {
          driverId: true,
          periodStart: true,
          earningsCents: true,
          advancesCents: true,
          reimbursementsCents: true,
          deductionsCents: true,
          otherPayCents: true,
          netCents: true,
        },
      }),
    ])

  const escrowOf = new Map(
    escrow.map((row) => [row.driverId, row._sum.amountCents ?? 0]),
  )

  for (const driver of drivers) {
    const built = ((): DriverSettlementInput => {
      const mine = loads.filter((load) => load.driverId === driver.id)
      const priorMine = prior.filter((row) => row.driverId === driver.id)
      const openingMine: Partial<Record<YtdCategory, number>> = {}
      for (const row of opening.filter((r) => r.driverId === driver.id)) {
        openingMine[row.category as YtdCategory] = row.amountCents
      }

      return {
        driverId: driver.id,
        // AS THE STATEMENT PRINTS IT. "JERRY ROBERT MCKANE", first then last.
        driverName: `${driver.firstName} ${driver.lastName}`.trim(),
        unitNumber: driver.assignedTruck?.unitNumber ?? null,
        period: input.period,
        loads: mine.map((load): SettleableLoad => {
          const pickup = load.stops.find((stop) => stop.type === 'PICKUP')
          const delivery = [...load.stops]
            .reverse()
            .find((stop) => stop.type === 'DELIVERY')
          const remitted = load.paymentApplications.reduce(
            (sum, row) => sum + row.amountCents,
            0,
          )
          const hasRemittance = load.paymentApplications.length > 0
          return {
            id: load.id,
            loadNumber: load.loadNumber,
            puPlace: placeOf(pickup),
            delPlace: placeOf(delivery),
            puDate: pickup?.scheduledAt ?? input.period.start,
            delDate: delivery?.scheduledAt ?? input.period.end,
            rateCents: load.totalRevenueCents,
            milesHundredths:
              (load.actualMiles ?? load.dispatchedMiles ?? 0) * 100,
            direct: load.customer.settlesDirectly
              ? {
                  // ONE DEFINITION OF SHORT, and it is this comparison. The
                  // importer's preview computes the same thing for its own
                  // report; a stored outcome column would be a second answer
                  // that could drift from the figures it describes.
                  outcome: !hasRemittance
                    ? ('none' as const)
                    : remitted === load.totalRevenueCents
                      ? ('matched_exact' as const)
                      : remitted < load.totalRevenueCents
                        ? ('short' as const)
                        : ('over' as const),
                  remittedCents: hasRemittance ? remitted : null,
                  confirmedCents: load.settledGrossCents,
                }
              : null,
          }
        }),
        payRules: payRules.filter((rule) => rule.driverId === driver.id),
        recurring: recurringAll.filter((rule) => rule.driverId === driver.id),
        charges: charges.filter((charge) => charge.driverId === driver.id),
        escrowHeldCents: escrowOf.get(driver.id) ?? 0,
        payoutLagWeeks: driver.payoutLagWeeks,
        checkDate: input.checkDate,
        openingBalances: openingMine,
        priorThisYear: priorMine as YtdTotals[],
        firstSettledPeriodStart:
          priorMine.length === 0
            ? null
            : priorMine.reduce(
                (earliest, row) =>
                  row.periodStart < earliest ? row.periodStart : earliest,
                priorMine[0]!.periodStart,
              ),
      }
    })()
    byCompany.get(driver.companyId)?.push(built)
  }

  return byCompany
}

/**
 * Create a batch for one company and one week, and draft it immediately.
 *
 * ── ONE CREATE, TWO CALLERS ──────────────────────────────────────────────
 *
 * The batch screen's form and the money screen's "Open batch" button both land
 * here. They differ only in where the four values come from — typed, or
 * prefilled from the week that is due — and a second create would be a second
 * place for the period to be got wrong.
 *
 * THE DATES ARRIVE ALREADY DECIDED. This function does not compute a statement
 * date or a check date from the period, because §0 forbids deriving them; a
 * caller may OFFER a default somebody can overwrite, which is a different
 * thing, and `payWeekFor` is where that default comes from.
 */
export async function openBatch(
  tx: TxClient,
  input: {
    organizationId: string
    companyId: string
    period: Week
    statementDate: Date
    checkDate: Date
  },
): Promise<
  { ok: true; batchId: string } | { ok: false; reason: BatchRefusal }
> {
  if (!isSettlementWeek(input.period)) {
    return { ok: false, reason: { kind: 'not_a_week' } }
  }

  const batch = await tx.settlementBatch.create({
    data: {
      organizationId: input.organizationId,
      companyId: input.companyId,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      statementDate: input.statementDate,
      checkDate: input.checkDate,
    },
    select: { id: true },
  })

  // DRAFTED ON CREATION, so the person who pressed the button lands on
  // something to read rather than on an empty batch they have to refresh.
  await refreshDraft(tx, batch.id)
  return { ok: true, batchId: batch.id }
}

export type BatchRefusal =
  | { kind: 'not_a_week' }
  | { kind: 'not_found' }
  | { kind: 'not_draft'; status: string }
  | { kind: 'blocked'; blockers: BatchResult['blockers'] }

/** Recompute a draft from the rows as they are now. Throws the old lines away. */
export async function refreshDraft(
  tx: TxClient,
  batchId: string,
): Promise<
  { ok: true; result: BatchResult } | { ok: false; reason: BatchRefusal }
> {
  const batch = await tx.settlementBatch.findFirst({
    where: { id: batchId, deletedAt: null },
  })
  if (!batch) return { ok: false, reason: { kind: 'not_found' } }
  if (batch.status !== 'DRAFT') {
    // A FINAL batch is a document. Recomputing it would rewrite what somebody
    // was paid, which is the one thing FINAL means.
    return { ok: false, reason: { kind: 'not_draft', status: batch.status } }
  }

  const period: Week = { start: batch.periodStart, end: batch.periodEnd }

  // ── THE OLD LINES GO FIRST, AND THE ORDER IS THE WHOLE POINT ──────────
  //
  // `settleableForBatch` excludes any load that already carries a settlement
  // line — which, before this delete, includes every load on THIS draft. Read
  // first and the second refresh sees only the loads the first one missed, so
  // a draft that was correct becomes a draft missing everything it already
  // had. The live path caught it: three loads went in, the second refresh
  // wrote one, the third wrote the other two, and one load fell out of the
  // batch entirely and turned up unsettled in the following week.
  //
  // Deleting first makes the read see the world as it would be with this
  // draft absent, which is exactly what recomputing it means.
  await tx.settlement.deleteMany({ where: { batchId } })

  const { drivers } = await batchInputFor(tx, {
    organizationId: batch.organizationId,
    companyId: batch.companyId,
    period,
    statementDate: batch.statementDate,
    checkDate: batch.checkDate,
  })

  const result = computeBatch({
    companyId: batch.companyId,
    period,
    statementDate: batch.statementDate,
    checkDate: batch.checkDate,
    drivers,
  })

  for (const settlement of result.settlements) {
    await tx.settlement.create({
      data: {
        organizationId: batch.organizationId,
        companyId: batch.companyId,
        batchId: batch.id,
        driverId: settlement.driverId,
        // NO NUMBER ON A DRAFT. A number issued to something that may never
        // exist is a gap in a series nobody can explain later.
        settlementNumber: `DRAFT-${batch.id.slice(-8)}-${settlement.driverId.slice(-8)}`,
        periodStart: period.start,
        periodEnd: period.end,
        unitNumber: settlement.unitNumber,
        payTariffLabel: settlement.payTariffLabel,
        payoutDate: settlement.payoutDate,
        grossCents: settlement.grossCents,
        milesHundredths: settlement.milesHundredths,
        earningsCents: settlement.earningsCents,
        advancesCents: settlement.advancesCents,
        reimbursementsCents: settlement.reimbursementsCents,
        deductionsCents: settlement.deductionsCents,
        otherPayCents: settlement.otherPayCents,
        netCents: settlement.netCents,
        loadLines: {
          create: settlement.lines.map((line, index) => ({
            organizationId: batch.organizationId,
            loadId: line.loadId,
            loadNumber: line.loadNumber,
            puPlace: line.puPlace,
            delPlace: line.delPlace,
            puDate: line.puDate,
            delDate: line.delDate,
            grossCents: line.grossCents,
            milesHundredths: line.milesHundredths,
            amountCents: line.amountCents,
            settledBasis: line.basis,
            payRuleSnapshot: line.snapshot as unknown as Prisma.InputJsonValue,
            sortOrder: index,
          })),
        },
        deductionLines: {
          create: [
            ...settlement.deductionLines,
            ...settlement.otherPayLines,
          ].map((line, index) => ({
            organizationId: batch.organizationId,
            type: line.type,
            description: line.description,
            quantity: line.quantity,
            rateCents: line.rateCents,
            totalCents: line.totalCents,
            recurringDeductionId: line.ruleId,
            sortOrder: index,
          })),
        },
      },
    })
  }

  return { ok: true, result }
}

/**
 * DRAFT -> FINAL. Numbers allocated, escrow moved, charges marked taken.
 *
 * THE BLOCKERS ARE CHECKED HERE AND NOT ONLY ON THE SCREEN. A draft refreshed
 * an hour ago and finalised now may have grown a driver with no pay rule, and
 * the button that was enabled then would still be enabled.
 */
export async function finaliseBatch(
  tx: TxClient,
  batchId: string,
  userId: string,
): Promise<
  { ok: true; batchNumber: string } | { ok: false; reason: BatchRefusal }
> {
  const refreshed = await refreshDraft(tx, batchId)
  if (!refreshed.ok) return refreshed
  if (!refreshed.result.canFinalise) {
    return {
      ok: false,
      reason: { kind: 'blocked', blockers: refreshed.result.blockers },
    }
  }

  const batch = await tx.settlementBatch.findFirstOrThrow({
    where: { id: batchId },
  })
  const period: Week = { start: batch.periodStart, end: batch.periodEnd }
  if (!isSettlementWeek(period)) {
    return { ok: false, reason: { kind: 'not_a_week' } }
  }

  const batchNumber = batchNumberOf(
    await allocateSeries(tx, batch.organizationId, BATCH_SERIES),
  )

  const settlements = await tx.settlement.findMany({
    where: { batchId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, driverId: true, deductionLines: true },
  })

  for (const settlement of settlements) {
    const statementNumber = statementNumberOf(
      await allocateSeries(tx, batch.organizationId, STATEMENT_SERIES),
    )
    await tx.settlement.update({
      where: { id: settlement.id },
      data: { settlementNumber: statementNumber, status: 'APPROVED' },
    })

    // ESCROW MOVES AT FINAL AND ONLY AT FINAL. A draft that incremented the
    // ledger would let refreshing a draft three times hold three weeks of
    // escrow off one week's pay.
    const escrow = settlement.deductionLines
      .filter((line) => line.type === 'Escrow')
      .reduce((sum, line) => sum + Math.abs(line.totalCents), 0)
    if (escrow > 0) {
      await tx.driverEscrowEntry.create({
        data: {
          organizationId: batch.organizationId,
          driverId: settlement.driverId,
          amountCents: escrow,
          settlementId: settlement.id,
          occurredAt: batch.periodEnd,
        },
      })
    }
  }

  // The one-offs this batch took are marked so no later batch takes them again.
  await tx.settlementCharge.updateMany({
    where: {
      driverId: { in: settlements.map((row) => row.driverId) },
      settledAt: null,
      appliesOn: { gte: batch.periodStart, lte: batch.periodEnd },
    },
    data: { settledAt: new Date() },
  })

  await tx.settlementBatch.update({
    where: { id: batchId },
    data: {
      status: 'FINAL',
      batchNumber,
      finalizedAt: new Date(),
      finalizedByUserId: userId,
    },
  })

  return { ok: true, batchNumber }
}

/** FINAL -> PAID. A person saw the money leave. */
export async function markBatchPaid(
  tx: TxClient,
  batchId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: BatchRefusal }> {
  const batch = await tx.settlementBatch.findFirst({
    where: { id: batchId, deletedAt: null },
  })
  if (!batch) return { ok: false, reason: { kind: 'not_found' } }
  if (batch.status !== 'FINAL') {
    return { ok: false, reason: { kind: 'not_draft', status: batch.status } }
  }

  await tx.settlementBatch.update({
    where: { id: batchId },
    data: { status: 'PAID', paidAt: new Date(), paidByUserId: userId },
  })
  await tx.settlement.updateMany({
    where: { batchId },
    data: { status: 'PAID', paidAt: new Date() },
  })
  return { ok: true }
}
