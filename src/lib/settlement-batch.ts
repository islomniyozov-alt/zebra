import type { Prisma } from '@/generated/prisma/client'
import { settleableInPeriod } from './settlements'
import {
  allocateSeries,
  batchNumberOf,
  BATCH_SERIES,
  draftNumberFor,
  ensureStatementNumber,
  isPlaceholderNumber,
  statementNumberOf,
  STATEMENT_SERIES,
} from './settlement-number'
import { isReferralPayee } from './driver-kind'
import { readStandingChargesForRun, standingRulesFor } from './standing-charges'
import { fuelChargeFor, fuelModeOf, tollChargeFor } from './fuel-charge'
import type { DeductionLine } from './deductions'
import {
  checkDateFor,
  computeBatch,
  remittanceOutcome,
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

// ── reading what a week owes ──────────────────────────────────────────────

/**
 * Every load that may enter a batch.
 *
 * `settleableInPeriod` AND NOTHING ELSE, plus this function's own scoping.
 * Owner's ruling, 2026-09-27: one predicate. See that function for what this
 * one used to leave out and what it cost — two DISPATCHED loads paid on the
 * 8/30 replay, $1,316.92 of driver pay for freight that had not arrived.
 *
 * THE OLD COMMENT HERE SAID "`SETTLEABLE_LOAD` AND NOTHING ELSE" and warned
 * that "two definitions of settleable is how closed history gets into a batch".
 * It was right about the hazard and wrong about the scope: sharing the
 * three-line constant while restating the period condition IS two definitions,
 * and the restatement is where the POD requirement went missing.
 *
 * A LOAD ALREADY ON A SETTLEMENT IS EXCLUDED BY THE `SettlementLoadLine`
 * UNIQUE, which the database enforces on write. This filter keeps it off the
 * draft as well, so a person never sees a line that cannot be written. Both
 * halves are needed: the filter is the screen, the constraint is the promise.
 */
export function settleableForBatch(
  companyId: string | readonly string[] | null,
  period: Week,
): Prisma.LoadWhereInput {
  return {
    // THE PERIOD, THE STATUS AND THE EVENT — one definition, shared with
    // `settleableWhere`. The end is pushed to the last millisecond of the
    // Saturday for the same reason the stop filter used to be: a period ending
    // at midnight loses everything that landed on the last day.
    ...settleableInPeriod(
      period.start,
      new Date(period.end.getTime() + 86_399_999),
    ),
    // ONE COMPANY, SEVERAL, OR THE WHOLE ORGANIZATION through the same
    // definition. Settlement is org-wide by ruling, so `null` is now the
    // normal case and the company filter is what a scoped VIEW uses — row-level
    // security already fences the organization, so no filter is needed to stay
    // inside it.
    ...(companyId === null
      ? {}
      : {
          companyId:
            typeof companyId === 'string' ? companyId : { in: [...companyId] },
        }),
    driverId: { not: null },
    // ── THE DELIVERY-STOP FILTER IS GONE, AND THAT IS THE MERGE ───────────
    //
    // It used to read: "The DELIVERY is what puts a load in a week — the same
    // date the pay rule is looked up on, so a load cannot be paid under a rule
    // from a week it does not belong to."
    //
    // The first clause is what `settleableInPeriod` now answers, with the POD
    // event instead of the stop's plan. The second clause is still true and is
    // not this filter's job: `ruleInForce` is called on `load.delDate` further
    // down, whatever put the load in the batch.

    // ── SETTLED BY ANYBODY, WHICH IS NOT QUITE RIGHT FOR A TEAM ─────────
    //
    // `settleableWhere` is scoped to `{ none: { driverId } }` because it
    // answers "what does THIS driver still have coming". This one is
    // org-wide: it asks what may enter a batch at all, and there is no driver
    // to scope to.
    //
    // WHAT THAT COSTS, NAMED RATHER THAN DISCOVERED: if a team load were ever
    // settled for one crew member and not the other, it would carry a line and
    // this filter would refuse it forever after — the second crew member would
    // never be paid for it, silently, and nothing would say so.
    //
    // It cannot arise today. Settlement is ORG-WIDE by ruling: every driver in
    // the organization is in the same batch, so both crew are settled in one
    // pass or neither is, and `settles both crew members in one batch` guards
    // exactly that. It would arise the day somebody settles a subset of
    // drivers — which is why this is written here and flagged, not left to be
    // found in a cheque.
    //
    // Prisma cannot express the correct condition ("some crew member has no
    // line yet"): it has no relation-count filter and no way to compare a
    // relation's column to the parent row's. Fixing it properly means raw SQL
    // here, and that is a deliberate decision rather than a silent one.
    settlementLoadLines: { none: {} },
    settlementLines: { none: {} },
  }
}

const placeOf = (
  stop: { city: string | null; state: string | null } | undefined,
) => (stop ? `${stop.city ?? ''},${stop.state ?? ''}` : '')

/**
 * Everything the organization's week needs, per driver, ready for the engine.
 *
 * ONE READ FOR EVERYTHING, which is both the ruling and the performance fix.
 * Settlement is org-wide, so there is no company to loop over — and the loop
 * that used to be here cost the money screen five times its round trips.
 *
 * `batchInputFor`, the single-company wrapper, is GONE rather than deprecated.
 * Nothing may settle one authority at a time any more, and leaving the door
 * open would be leaving the old rule reachable.
 */
export async function batchInputForOrg(
  tx: TxClient,
  input: {
    organizationId: string
    period: Week
    statementDate: Date
    checkDate: Date
    /**
     * The authority this batch settles, or null for the whole organization
     * (§6.2.10). Null is the default and the 2026-09-11 ruling.
     */
    companyId?: string | null
    /**
     * Trips the office unticked (§6.2.10 part 2). EXCLUSIONS, not selections:
     * everything settleable goes in EXCEPT these, so freight that arrives after
     * the decision is included rather than silently dropped.
     */
    excludeLoadIds?: readonly string[]
  },
  options: {
    /**
     * Read everything needed to compute NET pay. Default true.
     *
     * ── FALSE IS FOR A SCREEN THAT NEVER SHOWS NET ──────────────────────
     *
     * Four of this function's reads exist only to turn gross into net:
     * recurring deductions, the escrow balance, the opening balance and the
     * year's prior settlements. The Tuesday screen displays Ready (loads,
     * drivers, GROSS), held lines and blocked drivers — and reads
     * `netCents` nowhere. Measured 2026-09-18: those four cost four round
     * trips out of a page that had grown to twenty-three.
     *
     * A BATCH MUST NEVER PASS FALSE. What it produces is a statement
     * somebody is paid on, and a settlement computed without its deductions
     * would overpay every driver who has any. The default is therefore the
     * safe one, and the money screen is the single caller that opts out.
     */
    netPay?: boolean
  } = {},
): Promise<DriverSettlementInput[]> {
  const netPay = options.netPay !== false
  const loads = await tx.load.findMany({
    where: {
      ...settleableForBatch(input.companyId ?? null, input.period),
      // THE EXCLUSION SET, SUBTRACTED HERE AND NOWHERE ELSE, so every caller
      // that computes a batch honours it: the draft refresh, the preview, and
      // the agreement test all read one definition of "what is in this batch".
      ...(input.excludeLoadIds && input.excludeLoadIds.length > 0
        ? { id: { notIn: [...input.excludeLoadIds] } }
        : {}),
    },
    select: {
      id: true,
      loadNumber: true,
      // THE BROKER'S REFERENCE, read here so it can be FROZEN onto the line
      // (migration 61). The workbench's Trip column and the PDF read it live
      // until today, which meant a correction next year changed an issued
      // statement.
      referenceNumber: true,
      driverId: true,
      // THE SECOND CREW MEMBER. A team load belongs to both of them and is
      // read ONCE here — the split into two lines happens per driver below,
      // so there is no second query and no chance of the two halves reading
      // different grosses.
      coDriverId: true,
      totalRevenueCents: true,
      actualMiles: true,
      dispatchedMiles: true,
      settledGrossCents: true,
      companyId: true,
      company: { select: { name: true } },
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

  // BOTH SEATS. A co-driver who pulled nothing of their own all week still
  // has a statement coming, so they must enter the batch by being crew on
  // somebody else's load — taking only `driverId` here is how a team member
  // silently goes unpaid.
  const driverIds = [
    ...new Set(
      loads
        .flatMap((load) => [load.driverId, load.coDriverId])
        .filter((id) => id !== null),
    ),
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
  const recurringAll = netPay
    ? await tx.recurringDeduction.findMany({
        where: {
          OR: [
            {
              // EVERY LIVE DRIVER IN THE ORGANIZATION. Row-level security is
              // the tenant fence; there is no company to narrow to any more.
              driver: { deletedAt: null },
            },
            { driverId: { in: driverIds } },
          ],
        },
      })
    : []
  for (const row of recurringAll) {
    if (!driverIds.includes(row.driverId)) driverIds.push(row.driverId)
  }

  if (driverIds.length === 0) return []

  // ── STANDING CHARGES, FUEL AND TOLLS (migration 61) ───────────────────
  //
  // THREE READS, ALL BEHIND `netPay`, for the reason the option's own note
  // gives: the Tuesday screen shows gross and must not pay for the four reads
  // that turn gross into net. These are the fifth, sixth and seventh.
  //
  // THE SETTINGS COME PER AUTHORITY, not per organization: fuel policy is a
  // property of the company whose letterhead the statement goes out under
  // (§6.2.3 — "a policy on the authority"), and this fleet has six of them
  // settling differently.
  const standing = netPay
    ? await readStandingChargesForRun(tx)
    : { charges: [], exemptions: [] }

  const [settingsRows, fuelRows, tollRows] = netPay
    ? await Promise.all([
        tx.companySettings.findMany({
          select: {
            companyId: true,
            deductFuel: true,
            deductTolls: true,
            fuelMode: true,
          },
        }),
        // UNCLAIMED ONLY. `settlementId` is how a transaction records that it
        // has already been charged (§6.2.3 — pending and added are states of
        // the transaction, not two tables), so a row already on a FINAL
        // statement must not be charged a second time by a later draft.
        //
        // INCLUSIVE AT BOTH ENDS, as `fuelAndTollsFor` is: the period end is
        // stored as the Saturday itself and a Saturday fill-up belongs to the
        // week it happened in.
        tx.fuelTransaction.findMany({
          where: {
            driverId: { in: driverIds },
            deletedAt: null,
            settlementId: null,
            purchasedAt: { gte: input.period.start, lte: input.period.end },
          },
          select: {
            id: true,
            driverId: true,
            companyId: true,
            purchasedAt: true,
            totalCents: true,
            invoiceCents: true,
            feesCents: true,
          },
        }),
        tx.tollTransaction.findMany({
          where: {
            driverId: { in: driverIds },
            deletedAt: null,
            settlementId: null,
            incurredAt: { gte: input.period.start, lte: input.period.end },
          },
          select: {
            id: true,
            driverId: true,
            companyId: true,
            incurredAt: true,
            totalCents: true,
            invoiceCents: true,
            feesCents: true,
          },
        }),
      ])
    : [[], [], []]

  const settingsOf = new Map(settingsRows.map((row) => [row.companyId, row]))

  const year = input.period.start.getUTCFullYear()
  const [drivers, payRules, charges, escrow, collected, opening, prior] =
    await Promise.all([
      tx.driver.findMany({
        where: { id: { in: driverIds } },
        select: {
          id: true,
          companyId: true,
          firstName: true,
          lastName: true,
          // A PAYEE IN THE SECOND SEAT IS NOT A TEAMMATE. Read here so the
          // split below needs no second query — every crew member is already
          // in `driverIds` by construction.
          kind: true,
          // WHICH STANDING CHARGES REACH THEM. `appliesTo` on a `StandingCharge`
          // carries this same `OwnershipType` vocabulary, so the scope and the
          // driver are compared in one currency — see `standing-charges.ts`.
          employmentType: true,
          payToName: true,
          payToAddress: true,
          payoutLagWeeks: true,
          // THE LETTERHEAD COMES WITH THE UNIT. By ruling the statement goes
          // out under the authority that owns the truck it is frozen on, so
          // the truck's company is read in the same breath as its number.
          assignedTruck: { select: { unitNumber: true, companyId: true } },
        },
      }),
      tx.driverPayRule.findMany({ where: { driverId: { in: driverIds } } }),
      tx.settlementCharge.findMany({
        where: { driverId: { in: driverIds }, settledAt: null },
      }),
      netPay
        ? tx.driverEscrowEntry.groupBy({
            by: ['driverId'],
            where: { driverId: { in: driverIds } },
            _sum: { amountCents: true },
          })
        : [],
      // ── WHAT EACH CAPPED RULE HAS ALREADY TAKEN ──────────────────────
      //
      // Owner's ruling, 2026-09-29: a target stops ANY recurring deduction,
      // not only escrow. Escrow counts its own ledger because it is
      // refundable; everything else counts the lines it has already written,
      // which carry `recurringDeductionId`.
      //
      // FINAL AND PAID ONLY. A DRAFT is recomputed on every refresh, so
      // counting its lines would count this week's instalment against this
      // week's remaining — the rule would stop one week early, and it would
      // stop differently depending on how many times somebody pressed
      // Refresh.
      netPay
        ? tx.settlementDeductionLine.groupBy({
            by: ['recurringDeductionId'],
            where: {
              recurringDeductionId: { not: null },
              settlement: {
                driverId: { in: driverIds },
                deletedAt: null,
                batch: { status: { in: ['FINAL', 'PAID'] }, deletedAt: null },
              },
            },
            _sum: { totalCents: true },
          })
        : [],
      netPay
        ? tx.driverOpeningBalance.findMany({
            where: { driverId: { in: driverIds }, year },
          })
        : [],
      netPay
        ? tx.settlement.findMany({
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
          })
        : [],
    ])

  /**
   * The OTHER crew member on each of a driver's loads.
   *
   * Extracted because it is now asked twice — once for the teammates and once for
   * the referral payees — and two copies of "whichever seat is not mine" is two
   * chances to get the seat backwards in one of them.
   */
  function crewIdsFor(
    loads: readonly { driverId: string | null; coDriverId: string | null }[],
    driverId: string,
  ): string[] {
    return loads
      .map((load) =>
        load.driverId === driverId ? load.coDriverId : load.driverId,
      )
      .filter((id): id is string => id !== null && id !== driverId)
  }

  const escrowOf = new Map(
    escrow.map((row) => [row.driverId, row._sum.amountCents ?? 0]),
  )

  // STORED AS A NEGATIVE, COUNTED AS A POSITIVE. `totalCents` on a deduction
  // line is what it takes OFF the cheque, so it is negative; a target is a
  // positive ceiling. `Math.abs` once here rather than at the comparison, where
  // a missed sign would quietly make every cap unreachable.
  const collectedOf = new Map(
    collected
      .filter((row) => row.recurringDeductionId !== null)
      .map((row) => [
        row.recurringDeductionId!,
        Math.abs(row._sum.totalCents ?? 0),
      ]),
  )

  // Crew names for the "Team with" header, from the drivers already read.
  const nameOf = new Map(
    drivers.map((d) => [d.id, `${d.firstName} ${d.lastName}`.trim()]),
  )
  // AND WHICH OF THEM ARE COMMISSIONS RATHER THAN PEOPLE.
  const payee = new Map(drivers.map((d) => [d.id, isReferralPayee(d)]))

  const out: DriverSettlementInput[] = []
  for (const driver of drivers) {
    const built = ((): DriverSettlementInput => {
      // ── EITHER SEAT MAKES IT MINE ────────────────────────────────────
      //
      // A team load appears in BOTH crew members' lists, and that is the whole
      // mechanism: the engine already computes pay per driver from that
      // driver's own rule in force on the delivery date, so two lists
      // containing the same load produce two lines at two percentages with one
      // shared gross. Nothing is summed, nothing is split, and a solo load —
      // `coDriverId` null — appears exactly once, as before.
      const mine = loads.filter(
        (load) => load.driverId === driver.id || load.coDriverId === driver.id,
      )
      const priorMine = prior.filter((row) => row.driverId === driver.id)
      const openingMine: Partial<Record<YtdCategory, number>> = {}
      for (const row of opening.filter((r) => r.driverId === driver.id)) {
        openingMine[row.category as YtdCategory] = row.amountCents
      }

      // ── THE ORGANIZATION'S STANDING CHARGES, AS RULES ────────────────
      //
      // §6.2.4. The engine is not changed, only fed: these are appended to the
      // driver's own recurring rules and `computeDeductions` decides in-force,
      // cadence and sign exactly as it does for the rest. `standingRulesFor`
      // returns NOTHING for a driver with no freight this week — the charge
      // follows the work, and billing somebody an admin fee for a week they did
      // not drive is a negative net on a document handed to a person.
      const standingMine = standingRulesFor({
        charges: standing.charges,
        exemptions: standing.exemptions,
        driver: {
          id: driver.id,
          employmentType: driver.employmentType,
          hasFreight: mine.length > 0,
        },
      })

      // ── FUEL AND TOLLS, UNDER THE AUTHORITY'S OWN POLICY ─────────────
      //
      // §6.2.3, migration 61. THE LETTERHEAD DECIDES: the settings come from
      // the company the statement goes out under, which is the truck's
      // authority and not the driver's home company when they differ. A driver
      // on a RAM truck pulling Dolphins freight is settled on RAM's fuel
      // policy, because RAM's name is on the paper.
      const letterheadCompanyId =
        driver.assignedTruck?.companyId ?? driver.companyId
      const settings = settingsOf.get(letterheadCompanyId)
      // NO SETTINGS ROW MEANS NO CHARGE. An authority that has never had its
      // fuel policy set has not decided to deduct, and defaulting to "charge
      // them" would take money off a cheque on the strength of a missing row.
      const mode = fuelModeOf(settings?.fuelMode)
      const fuelCharge = fuelChargeFor({
        transactions: fuelRows
          .filter((row) => row.driverId === driver.id)
          .map((row) => ({
            id: row.id,
            purchasedAt: row.purchasedAt,
            totalCents: row.totalCents,
            invoiceCents: row.invoiceCents,
            feesCents: row.feesCents,
          })),
        mode,
        period: input.period,
        deduct: settings?.deductFuel ?? false,
      })
      const tollCharge = tollChargeFor({
        transactions: tollRows
          .filter((row) => row.driverId === driver.id)
          .map((row) => ({
            id: row.id,
            incurredAt: row.incurredAt,
            totalCents: row.totalCents,
            invoiceCents: row.invoiceCents,
            feesCents: row.feesCents,
          })),
        mode,
        period: input.period,
        deduct: settings?.deductTolls ?? false,
      })

      return {
        driverId: driver.id,
        // AS THE STATEMENT PRINTS IT. "JERRY ROBERT MCKANE", first then last.
        driverName: `${driver.firstName} ${driver.lastName}`.trim(),
        unitNumber: driver.assignedTruck?.unitNumber ?? null,
        // Falls back to the driver's own authority when no truck is assigned:
        // a statement with no letterhead is not a document.
        letterheadCompanyId:
          driver.assignedTruck?.companyId ?? driver.companyId,
        // WHO ELSE WAS IN THE CAB. Distinct, in the order they first appear,
        // and read from the drivers already loaded above rather than a second
        // query — every crew member is in `driverIds` by construction.
        // THE PAYEE AS IT STANDS TODAY, frozen onto the row below.
        payToName: driver.payToName,
        payToAddress: driver.payToAddress,
        // SPLIT BY KIND, because "Team with 7 Star" is a false statement
        // about who was in the truck, on the one document the driver reads to
        // check their own pay. Same source, two lists, one pass.
        teamWith: [
          ...new Set(
            crewIdsFor(mine, driver.id)
              .filter((id) => !payee.get(id))
              .map((id) => nameOf.get(id))
              .filter((name) => name !== undefined),
          ),
        ],
        referralWith: [
          ...new Set(
            crewIdsFor(mine, driver.id)
              .filter((id) => payee.get(id) === true)
              .map((id) => nameOf.get(id))
              .filter((name) => name !== undefined),
          ),
        ],
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
            referenceNumber: load.referenceNumber,
            companyId: load.companyId,
            companyName: load.company.name,
            puPlace: placeOf(pickup),
            delPlace: placeOf(delivery),
            puDate: pickup?.scheduledAt ?? input.period.start,
            delDate: delivery?.scheduledAt ?? input.period.end,
            rateCents: load.totalRevenueCents,
            milesHundredths:
              (load.actualMiles ?? load.dispatchedMiles ?? 0) * 100,
            direct: load.customer.settlesDirectly
              ? {
                  // ONE DEFINITION OF SHORT, now actually shared rather
                  // than asserted: `remittanceOutcome` is the comparison, and
                  // item 9 calls it too instead of writing a third copy.
                  outcome: remittanceOutcome(
                    remitted,
                    hasRemittance,
                    load.totalRevenueCents,
                  ),
                  remittedCents: hasRemittance ? remitted : null,
                  confirmedCents: load.settledGrossCents,
                }
              : null,
          }
        }),
        payRules: payRules.filter((rule) => rule.driverId === driver.id),
        // THE DRIVER'S OWN RULES, THEN THE ORGANIZATION'S. One list, because
        // `computeDeductions` treats them identically by design — see
        // `standing-charges.ts` on why selection and pricing are separate.
        recurring: [
          ...recurringAll.filter((rule) => rule.driverId === driver.id),
          ...standingMine,
        ],
        charges: charges.filter((charge) => charge.driverId === driver.id),
        // Priced by `fuel-charge.ts` and joined before the sign split, so they
        // land in `deductionsCents` and therefore in net. `filter` rather than a
        // conditional spread because either or both may be absent.
        extraDeductionLines: [fuelCharge.line, tollCharge.line].filter(
          (line): line is DeductionLine => line !== null,
        ),
        // FROZEN ONLY WHEN SOMETHING WAS CHARGED. A statement that deducted no
        // fuel has no fuel policy to record, and writing `RETAIL` on it would
        // claim a decision nobody made.
        fuelMode:
          fuelCharge.line === null && tollCharge.line === null ? null : mode,
        escrowHeldCents: escrowOf.get(driver.id) ?? 0,
        // Only this driver's rules, so one driver's cap cannot be read against
        // another's collections.
        collectedToDateCents: Object.fromEntries(
          recurringAll
            .filter((rule) => rule.driverId === driver.id)
            .map((rule) => [rule.id, collectedOf.get(rule.id) ?? 0]),
        ),
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
    out.push(built)
  }

  return out
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
 * ── THE STATEMENT DATE ARRIVES; THE CHECK DATE CANNOT ────────────────────
 *
 * The statement date is when the paperwork was cut, which is a fact about an
 * afternoon, so it is an input and stays one.
 *
 * THE CHECK DATE IS NOT IN THIS SIGNATURE AT ALL. It is `checkDateFor(period)`
 * — period end + 13, the verified company cadence — and a caller has no way to
 * pass a different one. §0 used to require it typed; batch
 * cmuga82ji0000qkvslwyibodv was typed 2026-09-25 against a period ending 9/19,
 * which is period end + 6 and the exact mistake §0 was warning about. Owner's
 * ruling, 2026-09-28.
 *
 * AN OPTIONAL OVERRIDE WOULD BE THE SAME BUG WITH A LONGER NAME. A parameter
 * that is usually omitted is a parameter that gets passed wrong once, and once
 * is what this cost. Correcting an already-open batch is deliberate and lives
 * in `scripts/correct-batch-check-date.ts`, which takes no date either.
 */
export async function openBatch(
  tx: TxClient,
  input: {
    organizationId: string
    period: Week
    statementDate: Date
    /**
     * The authority to settle, or null for the whole organization (§6.2.10).
     * Null is the default: Islom's 2026-09-11 ruling, unchanged.
     */
    companyId?: string | null
    /**
     * The trips the office unticked on the way in (§6.2.10 part 2). Written as
     * exclusions before the first refresh, so the draft is built without them.
     */
    excludeLoadIds?: readonly string[]
    /** Who unticked them. Null when nothing was unticked. */
    excludedByUserId?: string | null
  },
): Promise<
  { ok: true; batchId: string } | { ok: false; reason: BatchRefusal }
> {
  if (!isSettlementWeek(input.period)) {
    return { ok: false, reason: { kind: 'not_a_week' } }
  }

  // ── ONE BATCH PER PERIOD, ENFORCED HERE AND NOT BY THE DATABASE ───────
  //
  // The ruling is one batch per period for the organization, and this is where
  // it lives. There is deliberately NO unique on (organizationId,
  // periodStart): a held line confirmed after FINAL has to land somewhere, and
  // post-FINAL money is a next-week line by a ruling that still stands — a
  // constraint would make the recovery path impossible rather than merely
  // discouraged.
  //
  // So the action refuses BY NAME and hands back the batch that already covers
  // the week, so the screen can link to it instead of reporting a collision.
  // ── AND THE CHECK IS SCOPE-AWARE, BUT NOT SCOPE-BLIND ─────────────────
  //
  // Two batches for one week are legitimate when they settle different
  // authorities — that is Datatruck's shape. They are NOT legitimate when one of
  // them is org-wide, because an org-wide batch and a RAM batch both reach for
  // RAM's freight.
  //
  // So this looks for a batch whose scope OVERLAPS the one being asked for: the
  // same company, or either side being the whole organization. The refusal
  // carries the batch it found, so the screen links to it rather than reporting a
  // collision the reader has to go and investigate.
  //
  // THE TRIP-LEVEL FENCE IS STILL THERE — `alreadyInBatch` means no load can be
  // settled twice whatever happens here. This refusal exists so the office never
  // has to rely on that: finding out by noticing a half-empty batch is not the
  // same as being told.
  const existing = await tx.settlementBatch.findFirst({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      periodStart: input.period.start,
      ...(input.companyId == null
        ? {}
        : { OR: [{ companyId: input.companyId }, { companyId: null }] }),
    },
    select: { id: true, status: true, batchNumber: true },
  })
  if (existing) {
    return {
      ok: false,
      reason: {
        kind: 'period_taken',
        batchId: existing.id,
        status: existing.status,
        batchNumber: existing.batchNumber,
      },
    }
  }

  // ── THE NUMBER IS ALLOCATED HERE, NOT AT FINALISE ──────────────────────
  //
  // Owner's ruling, 2026-09-28. It was assigned by `finaliseBatch`, so every
  // DRAFT was nameless and the Batches grid printed a cuid — `cmujowoz` where
  // Datatruck shows `SB-000448`. A run people discuss for three days before
  // finalising it needs a name on the first of those days.
  //
  // ORG-WIDE AND GAPLESS-ISH, through the same `SeriesCounter` the statements
  // use. A number is spent when a draft is opened, so a deleted draft leaves a
  // gap — which is the right trade: reusing one would give two different runs
  // the same name in somebody's email.
  const batchNumber = batchNumberOf(
    await allocateSeries(tx, input.organizationId, BATCH_SERIES),
  )

  const batch = await tx.settlementBatch.create({
    data: {
      organizationId: input.organizationId,
      // §6.2.10. Null is the whole organization and the default.
      companyId: input.companyId ?? null,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      statementDate: input.statementDate,
      checkDate: checkDateFor(input.period),
      batchNumber,
    },
    select: { id: true },
  })

  // ── THE UNTICKED TRIPS, BEFORE THE FIRST REFRESH ──────────────────────
  //
  // Written here rather than after `refreshDraft` so the draft is never
  // momentarily correct-and-wrong: a batch that briefly contained freight the
  // office had already declined would be a batch somebody could read in that
  // state, and on a money screen a moment is long enough.
  if (input.excludeLoadIds && input.excludeLoadIds.length > 0) {
    await tx.settlementBatchExclusion.createMany({
      data: [...new Set(input.excludeLoadIds)].map((loadId) => ({
        organizationId: input.organizationId,
        batchId: batch.id,
        loadId,
        excludedByUserId: input.excludedByUserId ?? null,
      })),
      // THE UNIQUE ON (batchId, loadId) IS THE POINT: a double-posted form is a
      // no-op rather than a duplicate-key refusal in the middle of a create.
      skipDuplicates: true,
    })
  }

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
  /** A batch already covers this period. Carries it, so the screen can link. */
  | {
      kind: 'period_taken'
      batchId: string
      status: string
      batchNumber: string | null
    }

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

  // ── THE SCOPE AND THE EXCLUSIONS COME OFF THE BATCH ───────────────────
  //
  // Not off the caller. A refresh is "recompute THIS batch as the rows are now",
  // and a batch's company and its exclusions are part of what it is — passing
  // them in would let one caller refresh a RAM batch as though it were org-wide.
  //
  // AND IT NEVER UN-EXCLUDES (§6.2.10 part 2). This reads the exclusion rows; it
  // does not write or clear them. New freight appears because the settleable set
  // grew, which is the monotonicity the exclusion design exists for.
  const excluded = await tx.settlementBatchExclusion.findMany({
    where: { batchId },
    select: { loadId: true },
  })

  const drivers = await batchInputForOrg(tx, {
    organizationId: batch.organizationId,
    period,
    statementDate: batch.statementDate,
    checkDate: batch.checkDate,
    companyId: batch.companyId,
    excludeLoadIds: excluded.map((row) => row.loadId),
  })

  const result = computeBatch({
    period,
    statementDate: batch.statementDate,
    checkDate: batch.checkDate,
    drivers,
  })

  for (const settlement of result.settlements) {
    await tx.settlement.create({
      data: {
        organizationId: batch.organizationId,
        // THE LETTERHEAD, not the batch's company — the batch has none. By
        // ruling this is the authority that owns the truck the settlement is
        // frozen on, resolved in `batchInputForOrg` beside the unit number.
        companyId: settlement.letterheadCompanyId,
        batchId: batch.id,
        driverId: settlement.driverId,
        // NO NUMBER ON A DRAFT. A number issued to something that may never
        // exist is a gap in a series nobody can explain later.
        settlementNumber: draftNumberFor(batch.id, settlement.driverId),
        periodStart: period.start,
        periodEnd: period.end,
        unitNumber: settlement.unitNumber,
        // Frozen beside the unit number, and for the same argument.
        teamWith: [...settlement.teamWith],
        referralWith: [...settlement.referralWith],
        // FROZEN BESIDE THE UNIT NUMBER. Reading the driver back next
        // year would restate a statement somebody was already paid on.
        payToName: settlement.payToName,
        payToAddress: settlement.payToAddress,
        payTariffLabel: settlement.payTariffLabel,
        // WHICH OF THE FOUR FUEL AMOUNTS THIS STATEMENT CHARGED, frozen beside
        // the pay tariff and for the same argument (§6.2.3): the authority's
        // policy can move and the document cannot. Null where nothing was
        // deducted — see the builder.
        fuelMode: settlement.fuelMode,
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
            // WHOSE LINE THIS IS, carried on the row rather than inferred
            // through the settlement — it is half the uniqueness key that
            // lets a team load pay two people and still refuses to pay
            // either of them twice.
            driverId: settlement.driverId,
            loadId: line.loadId,
            loadNumber: line.loadNumber,
            // THE BROKER'S REFERENCE, FROZEN (migration 61). The workbench's
            // Trip column and the PDF printed this live until today.
            referenceNumber: line.referenceNumber,
            // FROZEN, so a statement carrying two authorities keeps its
            // grouping even if a load is later moved between them.
            companyId: line.companyId,
            companyName: line.companyName,
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

  // THE NUMBER THE BATCH ALREADY HAS. `openBatch` allocates it, so finalising
  // does not mint a second one — a run that changed name between the draft
  // somebody reviewed and the statement somebody was handed would be the same
  // week under two identities.
  //
  // A BATCH OPENED BEFORE THIS RULING HAS NONE, so one is allocated now rather
  // than finalising a nameless run: `?? batchNumberOf(...)` and not a throw,
  // because those drafts are real and are mid-week.
  const batchNumber =
    batch.batchNumber ??
    batchNumberOf(await allocateSeries(tx, batch.organizationId, BATCH_SERIES))

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

  // ── THE FUEL AND TOLL TRANSACTIONS THIS BATCH CHARGED ─────────────────
  //
  // §6.2.3: pending and added are states of the transaction, not two tables.
  // `settlementId` is the record that a row has been charged once, and it is
  // what stops a later batch charging it again — `batchInputForOrg` reads only
  // rows where it is null.
  //
  // AT FINAL AND ONLY AT FINAL, the same rule as escrow one block up and for
  // the same reason inverted: a draft that claimed its transactions would make
  // the NEXT refresh of that same draft find nothing and drop the line it had
  // just printed. Refreshing a draft three times would leave the fuel charge
  // on the first pass and gone from the third.
  //
  // PER SETTLEMENT, so the row points at the statement that charged it rather
  // than at the batch — a driver asking which statement took a fill-up is
  // asking about one document.
  for (const settlement of settlements) {
    const claim = {
      driverId: settlement.driverId,
      deletedAt: null,
      settlementId: null,
    }
    await Promise.all([
      tx.fuelTransaction.updateMany({
        where: {
          ...claim,
          purchasedAt: { gte: batch.periodStart, lte: batch.periodEnd },
        },
        data: { settlementId: settlement.id },
      }),
      tx.tollTransaction.updateMany({
        where: {
          ...claim,
          incurredAt: { gte: batch.periodStart, lte: batch.periodEnd },
        },
        data: { settlementId: settlement.id },
      }),
    ])
  }

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
  // EVERY PATH OUT OF DRAFT MINTS (owner's ruling, 2026-09-30). A FINAL batch
  // has been through `finaliseBatch`, which numbers each settlement, so this
  // finds nothing in the normal course — it is here because the invariant is
  // "a paid statement carries a number" and this is one of the three places a
  // statement becomes PAID. An invariant enforced at two of three doors is a
  // habit, not an invariant.
  // FILTERED BY THE PREDICATE, NOT BY A PREFIX IN A WHERE CLAUSE. `DRAFT-` is
  // one placeholder shape and dev turned up a second nobody wrote down; a SQL
  // `startsWith` here would silently be a third definition of "has no name".
  const inBatch = await tx.settlement.findMany({
    where: { batchId },
    select: { id: true, organizationId: true, settlementNumber: true },
  })
  for (const settlement of inBatch) {
    if (isPlaceholderNumber(settlement.settlementNumber)) {
      await ensureStatementNumber(tx, settlement)
    }
  }

  await tx.settlement.updateMany({
    where: { batchId },
    data: { status: 'PAID', paidAt: new Date() },
  })
  return { ok: true }
}
