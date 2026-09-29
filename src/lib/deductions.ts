// ---------------------------------------------------------------------------
// ONE DRIVER'S DEDUCTION LINES FOR ONE PERIOD. PURE, AND MEASURED OFF PAPER.
//
// ── THE TRUTH SET IS SIX REAL STATEMENTS ─────────────────────────────────
//
// `corpus/datatruck` holds ST-005284, 005301, 005310, 005317, 005336 and
// 005352. Between them they print nine deduction descriptions, and the
// acceptance for this file is that every one is reproducible from a STORED
// RULE — not hard-coded here, not approximated:
//
//   Fuel        "Auto calculated Fuel cost"
//   Insurance   "Insurance (GL, AL, Cargo, TI) for August $1800/$450"
//   Insurance   "Insurance (GL, AL, Cargo, TI) for August 24days"
//   Ifta        (no description at all)
//   Admin Fee   (no description at all)
//   Tolls       "TollPrePass 08/01/2026 to 08/31/2026"
//   Other       "Charge for late Del Load#111VS62GS"
//   Escrow      "Security Deposit $2500/$500"
//   Escrow      "Security Deposit $2500/$250"
//
// TWO OF THOSE COME FROM ONE RULE. The same insurance row produced `$1800/$450`
// on the week of Aug 9–15 and `24days` on Aug 16–22, so the description is a
// TEMPLATE the engine fills, not a string somebody retypes each week. A design
// that stored the finished text would need a new row every month.
//
// ── ONLY TWO TYPES BRANCH, AND THE REST ARE LABELS ───────────────────────
//
// `Escrow` has a target and a held balance and must stop itself. `Fuel` takes
// its amount from the transaction import (item 4) and prints no line at all
// when there are no transactions. Everything else — Insurance, Ifta, Admin
// Fee, Tolls, Other, and whatever is invented next — is a label, an amount and
// a cadence. `deduction-types.ts` holds the known labels for the UI; nothing
// here refuses an unknown one.
//
// ── PURE ─────────────────────────────────────────────────────────────────
//
// No database, no clock, no settlement. Everything it needs arrives as an
// argument, including the escrow balance and the fuel total, because the
// engine that computes somebody's wages has to be testable without standing up
// a settlement — the standing rule about domain logic, applied where it costs
// the most to ignore.
// ---------------------------------------------------------------------------

/** The cadences the model carries. Mirrors the Prisma enum without importing it. */
export type DeductionCadence = 'WEEKLY' | 'MONTHLY_SPLIT_WEEKLY'

/** A stored standing deduction, as the engine needs it. */
export interface RecurringRule {
  id: string
  /** The printed label. A string, never an enum — see the header. */
  type: string
  /** Template or literal, or null where the statement prints nothing. */
  description: string | null
  amountCents: number
  cadence: DeductionCadence
  /** The `$1800` of `$1800/$450`. Null for WEEKLY. */
  monthlyTotalCents: number | null
  /**
   * A ceiling the rule stops itself at, for ANY type (owner's ruling,
   * 2026-09-29). Null where the charge runs indefinitely, which is most of them.
   */
  targetCents: number | null
  effectiveFrom: Date
  effectiveTo: Date | null
}

/** A one-off, signed. Negative takes money off the driver. */
export interface OneOffCharge {
  id: string
  type: string
  description: string
  amountCents: number
  appliesOn: Date
}

export interface DeductionPeriod {
  /** Inclusive UTC day the period opens — a Sunday, per MONEY-DESIGN §0. */
  start: Date
  /** Inclusive UTC day it closes — the following Saturday. */
  end: Date
}

export interface DeductionInput {
  period: DeductionPeriod
  rules: readonly RecurringRule[]
  charges: readonly OneOffCharge[]
  /**
   * What escrow is already holding for this driver, before this period.
   *
   * AN ARGUMENT RATHER THAN A LOOKUP, because the balance is a ledger fact and
   * this function is arithmetic. It is also what lets the target rule be
   * tested at every point on its way to stopping.
   */
  escrowHeldCents: number
  /**
   * What a MONTHLY_SPLIT_WEEKLY rule has already collected in the period's
   * month, keyed by rule id. The month-end true-up needs it — see
   * `prorateFinalMonth`.
   */
  collectedThisMonthCents?: Readonly<Record<string, number>>
  /**
   * What each rule has already taken, across every settled week, by rule id.
   *
   * ── ESCROW HAS A LEDGER AND NOTHING ELSE DOES ──────────────────────────
   *
   * `escrowHeldCents` is a running balance in its own table, because escrow is
   * refundable and somebody has to be able to ask what is held. An insurance
   * cap needs no ledger — what it needs is the sum of what this rule has
   * already charged, which the settlement lines already record against
   * `recurringDeductionId`.
   *
   * SO A TARGET ON A NON-ESCROW RULE COUNTS LINES, and the caller supplies the
   * sum. Absent means zero collected, which is right for a rule whose first
   * week this is and wrong for nothing: a caller that forgets it makes the cap
   * too generous, never too tight, and `settlement-batch.ts` is the one caller.
   */
  collectedToDateCents?: Readonly<Record<string, number>>
  /**
   * The fuel total for the period, from the transaction import. Absent means
   * NO FUEL LINE — never a zero line, which would claim somebody looked.
   */
  fuelCents?: number | null
}

/** One line as it will print. `amountCents` is positive; the sign is the type. */
export interface DeductionLine {
  ruleId: string | null
  type: string
  /** Exactly what goes in the Description column. Empty string prints blank. */
  description: string
  quantity: number
  rateCents: number
  /** Signed: negative is money off the driver. */
  totalCents: number
  /** Said out loud on the statement when a rule stopped itself. */
  note?: string
}

export interface DeductionResult {
  lines: DeductionLine[]
  totalCents: number
  /** Escrow after this period. Unchanged when escrow did not run. */
  escrowHeldCents: number
  /**
   * True when there is nothing to print.
   *
   * AN EMPTY SECTION IS OMITTED, NEVER RENDERED AT ZERO — the rule carried in
   * from the artefact, where the two Dolphins statements have no Deductions
   * block at all rather than a block of zeros. The renderer asks this; it does
   * not count the lines itself and get it right by luck.
   */
  omitSection: boolean
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** `$1,800.00` -> `$1800`. Datatruck prints whole dollars in these templates. */
const dollars = (cents: number): string =>
  cents % 100 === 0 ? `$${String(cents / 100)}` : `$${(cents / 100).toFixed(2)}`

const daysInMonth = (at: Date): number =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate()

const startOfMonth = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))

const endOfMonth = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0))

/** `MM/DD/YYYY`, the way Datatruck prints a toll range. */
const usDate = (at: Date): string => {
  const month = String(at.getUTCMonth() + 1).padStart(2, '0')
  const day = String(at.getUTCDate()).padStart(2, '0')
  return `${month}/${day}/${at.getUTCFullYear()}`
}

const day = (at: Date): number =>
  Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())

/**
 * How many days of the period's month this rule was actually in force.
 *
 * ── THE MEASUREMENT THAT DEFINES THIS ────────────────────────────────────
 *
 * ST-005310 prints `for August 24days` at $43.55 against a $1800/month rule
 * taking $450 a week. That is not a fresh charge, it is a TRUE-UP:
 *
 *   $1800 x 24/31 = $1393.55   the month's entitlement at 24 days
 *   less 3 x $450 = $1350.00   what the earlier weeks already took
 *   ------------------------
 *                    $43.55    exactly what the statement prints
 *
 * So the last week of a partial month charges the difference, and the day
 * count goes in the description. Nothing about that is derivable from the
 * weekly amount alone, which is why `collectedThisMonthCents` is an input.
 *
 * NOTE THE SPACING: the statement prints `24days`, with no space. Reproducing
 * a description verbatim means reproducing that too.
 */
export function activeDaysInMonth(rule: RecurringRule, anchor: Date): number {
  const first = startOfMonth(anchor)
  const last = endOfMonth(anchor)
  const from = day(rule.effectiveFrom) > day(first) ? rule.effectiveFrom : first
  const to =
    rule.effectiveTo && day(rule.effectiveTo) < day(last)
      ? rule.effectiveTo
      : last
  const span = (day(to) - day(from)) / 86_400_000 + 1
  return span > 0 ? span : 0
}

/** Whether a rule is in force at any point in the period. */
export function inForce(rule: RecurringRule, period: DeductionPeriod): boolean {
  if (day(rule.effectiveFrom) > day(period.end)) return false
  if (rule.effectiveTo && day(rule.effectiveTo) < day(period.start))
    return false
  return true
}

/**
 * Is this the last period of a partial month for this rule?
 *
 * True when the rule stops inside the period's month AND the period contains
 * or follows that stop — the week that has to settle up.
 */
function isFinalPartialMonth(
  rule: RecurringRule,
  period: DeductionPeriod,
): boolean {
  if (!rule.effectiveTo) return false
  const last = endOfMonth(period.start)
  if (day(rule.effectiveTo) >= day(last)) return false
  return day(period.end) >= day(rule.effectiveTo) - 7 * 86_400_000
}

/** `{month}` and `{split}` filled from the rule and the period. */
function renderDescription(
  rule: RecurringRule,
  period: DeductionPeriod,
  split: string,
): string {
  if (rule.description === null) return ''
  return rule.description
    .replace('{month}', MONTHS[period.start.getUTCMonth()]!)
    .replace('{split}', split)
    .replace('{from}', usDate(startOfMonth(period.start)))
    .replace('{to}', usDate(endOfMonth(period.start)))
}

/**
 * A capped line always prints `target/remaining`, template or not.
 *
 * ── WHY THIS IS NOT LEFT TO `{split}` ─────────────────────────────────────
 *
 * `renderDescription` substitutes `{split}` where the stored description asks
 * for it, which is how the escrow rules in the corpus are written —
 * `Security Deposit {split}`. A rule typed through the Charges screen has no
 * placeholder at all: Julia Rose Hall's is the word "Insurance".
 *
 * The ruling is that the STATEMENT prints target and remaining, so a rule with
 * a target prints them whether or not somebody thought to type a placeholder.
 * Appended rather than substituted, and only when it is not already there — a
 * description carrying `{split}` has put the figures where its author wanted.
 */
function withSplit(rendered: string, split: string): string {
  if (rendered.includes(split)) return rendered
  return rendered === '' ? split : `${rendered} ${split}`
}

/**
 * The deduction lines for one driver, one period.
 *
 * ORDERED AS THE STATEMENTS PRINT THEM: recurring rules in the order given,
 * then one-off charges. Datatruck's own order varies week to week, so this
 * takes the stored order rather than inventing a sort nobody asked for.
 */
export function computeDeductions(input: DeductionInput): DeductionResult {
  const lines: DeductionLine[] = []
  let escrowHeld = input.escrowHeldCents

  for (const rule of input.rules) {
    if (!inForce(rule, input.period)) continue

    // ── FUEL: A LINE ONLY WHEN TRANSACTIONS EXIST ──────────────────────
    //
    // Item 4 brings the import. Until then, and on any week with no card
    // activity, there is NO LINE — not a zero one, which would claim somebody
    // checked and found nothing. Same rule §5 states for the fuel line and §4
    // states for the whole section.
    if (rule.type === 'Fuel') {
      const cents = input.fuelCents ?? null
      if (cents === null || cents === 0) continue
      lines.push({
        ruleId: rule.id,
        type: rule.type,
        description: renderDescription(rule, input.period, ''),
        quantity: 1,
        rateCents: cents,
        totalCents: -cents,
      })
      continue
    }

    // ── ESCROW: A TARGET THAT STOPS ITSELF ─────────────────────────────
    //
    // The one behaviour Datatruck does not have. `remaining` is what the
    // statement prints beside the target, and when it reaches zero the rule
    // stops and SAYS SO — a line that silently disappears is indistinguishable
    // from a rule somebody deleted.
    // ── ANY TARGET STOPS ITSELF, AND THE LINE PRINTS TARGET / REMAINING ──
    //
    // Owner's ruling, 2026-09-29. This branch was `rule.type === 'Escrow'`, so
    // a $4,000 cap on an insurance rule was stored, printed and IGNORED — the
    // engine kept charging past it. Julia Rose Hall's insurance is exactly that
    // shape and is why the ruling exists.
    //
    // WHERE THE BALANCE COMES FROM DIFFERS AND THE ARITHMETIC DOES NOT. Escrow
    // counts its ledger, because it is refundable and the balance is a fact
    // somebody asks about directly. Everything else counts what its own lines
    // have already taken. Both answer the same question — how much of the
    // target is left — so both go through one branch rather than two that have
    // to agree.
    if (rule.targetCents !== null) {
      const isEscrow = rule.type === 'Escrow'
      const collected = isEscrow
        ? escrowHeld
        : (input.collectedToDateCents?.[rule.id] ?? 0)
      const remaining = rule.targetCents - collected

      // REACHED MEANS NO LINE AT ALL, not a zero one. A zero line claims
      // somebody was charged nothing this week; an absent line claims nothing,
      // which is what §4 asks for and what the note on the LAST line already
      // said would happen.
      if (remaining <= 0) continue

      // THE LAST INSTALMENT IS THE REMAINDER, not the full amount. A $1,250
      // weekly against $4,000 takes 1,250 three times and 250 once — charging
      // the fourth in full would collect $5,000 against a $4,000 cap, which is
      // the whole failure this prevents.
      const take = Math.min(rule.amountCents, remaining)
      const split = `${dollars(rule.targetCents)}/${dollars(remaining)}`
      const reached = take === remaining

      lines.push({
        ruleId: rule.id,
        type: rule.type,
        description: withSplit(
          renderDescription(rule, input.period, split),
          split,
        ),
        quantity: 1,
        rateCents: take,
        totalCents: -take,
        // THE NOTE NAMES THE TYPE, because "target reached" on a statement with
        // three capped rules on it would not say which one stopped.
        ...(reached
          ? {
              note: `${rule.type} target ${dollars(rule.targetCents)} reached; no further deductions.`,
            }
          : {}),
      })
      if (isEscrow) escrowHeld += take
      continue
    }

    // ── MONTHLY, SPLIT WEEKLY, WITH A MONTH-END TRUE-UP ────────────────
    if (rule.cadence === 'MONTHLY_SPLIT_WEEKLY') {
      const monthly = rule.monthlyTotalCents ?? rule.amountCents
      if (isFinalPartialMonth(rule, input.period)) {
        const days = activeDaysInMonth(rule, input.period.start)
        const entitled = Math.round(
          (monthly * days) / daysInMonth(input.period.start),
        )
        const already = input.collectedThisMonthCents?.[rule.id] ?? 0
        const owed = entitled - already
        if (owed === 0) continue
        lines.push({
          ruleId: rule.id,
          type: rule.type,
          description: renderDescription(
            rule,
            input.period,
            `${String(days)}days`,
          ),
          quantity: 1,
          rateCents: Math.abs(owed),
          totalCents: -owed,
        })
        continue
      }

      const split = `${dollars(monthly)}/${dollars(rule.amountCents)}`
      lines.push({
        ruleId: rule.id,
        type: rule.type,
        description: renderDescription(rule, input.period, split),
        quantity: 1,
        rateCents: rule.amountCents,
        totalCents: -rule.amountCents,
      })
      continue
    }

    // ── EVERYTHING ELSE IS A LABEL AND AN AMOUNT ───────────────────────
    lines.push({
      ruleId: rule.id,
      type: rule.type,
      description: renderDescription(rule, input.period, ''),
      quantity: 1,
      rateCents: rule.amountCents,
      totalCents: -rule.amountCents,
    })
  }

  // ── ONE-OFFS, SIGN AS STORED ─────────────────────────────────────────
  //
  // A late-delivery charge and a truck-wash reimbursement are the same object
  // pointing opposite ways, so nothing here decides which is which.
  for (const charge of input.charges) {
    if (day(charge.appliesOn) < day(input.period.start)) continue
    if (day(charge.appliesOn) > day(input.period.end)) continue
    lines.push({
      ruleId: null,
      type: charge.type,
      description: charge.description,
      quantity: 1,
      rateCents: Math.abs(charge.amountCents),
      totalCents: charge.amountCents,
    })
  }

  const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0)

  return {
    lines,
    totalCents,
    escrowHeldCents: escrowHeld,
    omitSection: lines.length === 0,
  }
}
