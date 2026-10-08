import type { MessageKey } from './i18n'

// ---------------------------------------------------------------------------
// REFERENCE DATA — the shared vocabulary for brokers, trucks, trailers and
// drivers.
//
// These four are the thinnest CRUD in the application and they still need a
// service layer, for one reason: every one of them has a uniqueness rule, a
// soft delete, and an authority, and all three interact in ways a page should
// not be deciding for itself.
//
// The rule that shapes this file: **a failure is a typed value, never a
// thrown Prisma error.** `P2002` reaching a route means the interface says
// "something went wrong" where §10 requires "Truck 101 already exists under
// RAM Haulage." The translation happens once, here.
// ---------------------------------------------------------------------------

export type ReferenceFailure =
  | 'required'
  | 'duplicate'
  | 'not_found'
  | 'invalid_year'
  | 'invalid_authority'
  /** Restoring a removed asset whose number a live one has since taken. */
  | 'number_taken_since'
  /** Pairing a driver with a truck that runs under a different authority. */
  | 'truck_other_authority'
  /** One person named in both seats of a team load (item 8). */
  | 'same_driver_twice'
  /** A payment type stamped on freight Datatruck already settled (item 10). */
  | 'closed_history_payment_type'
  /** A stop whose arrival window ends before it starts (Phase 5). */
  | 'window_inverted'
  /**
   * Codes were read off a licence and nobody confirmed them against the card.
   *
   * RECOGNITION IS NOT THE GATE, AND THIS IS WHY. Two batches of ten runs over
   * one Georgia card produced seven different letters for one printed glyph —
   * and `E` and `O` were among them. Both are REAL restriction codes, so a
   * recognition check waves them through; it caught nine of ten in the second
   * batch by luck of which letters the model happened to guess. A check whose
   * success depends on the shape of the error is not a check.
   *
   * So the codes are never auto-accepted. A person says they match the card.
   */
  /**
   * A driver status the roster does not get to state (item 11, ruling).
   *
   * DISPATCHED and ON_ROUTE are derived from the freight and OFF_DUTY is a
   * flag of its own. The three remain in the Postgres enum because dropping
   * an enum value means rewriting the table; this is what stops them being
   * written. See src/lib/driver-roster.ts.
   */
  | 'not_roster_status'
  /** A third driver on a truck that seats two (§6.4 part 3). */
  | 'truck_full'
  /** A driver kind outside `DRIVER_KINDS` — a person or a referral payee (item 17). */
  | 'not_driver_kind'
  /** A payment type other than Direct on direct-settled freight (§7.12). */
  | 'payment_type_direct'
  /**
   * A value outside a small code list — fleet status, fuel type (item 12).
   *
   * The list is TEXT rather than an enum by ruling, so the database will
   * store anything. This is what makes the list mean something.
   */
  | 'not_in_code_list'
  /** A trailer already pulled by somebody else (item 12). */
  | 'trailer_already_paired'
  /**
   * A register entry somebody tried to void twice (item 14).
   *
   * The second attempt would overwrite the first reason, which is the record
   * of what actually happened — so it is refused rather than accepted.
   */
  | 'already_voided'
  /**
   * A testing year nobody has entered the FMCSA rate for (item 15).
   *
   * NOT A DEFAULT. §382.305(b)’s rate is adjusted by notice and a fallback
   * would be a wrong number nobody questions. See random-testing.ts.
   */
  | 'rate_not_recorded'
  | 'codes_unconfirmed'

export class ReferenceError extends Error {
  readonly code: ReferenceFailure
  /** The field to attach the message to, where there is one. */
  readonly field: string | undefined
  /** Filled for `duplicate_deleted`, so the interface can offer a restore. */
  readonly conflictId: string | undefined

  constructor(
    code: ReferenceFailure,
    options: { field?: string; conflictId?: string; message?: string } = {},
  ) {
    super(options.message ?? code)
    this.name = 'ReferenceError'
    this.code = code
    this.field = options.field
    this.conflictId = options.conflictId
  }
}

/** Message keys, so a route never carries a sentence. */
export const REFERENCE_ERROR_KEYS: Record<ReferenceFailure, MessageKey> = {
  required: 'ref.error.required',
  duplicate: 'ref.error.duplicate',
  not_found: 'ref.error.notFound',
  invalid_year: 'ref.error.invalidYear',
  invalid_authority: 'ref.error.invalidAuthority',
  number_taken_since: 'ref.error.numberTakenSince',
  truck_other_authority: 'ref.error.truckOtherAuthority',
  same_driver_twice: 'ref.error.sameDriverTwice',
  closed_history_payment_type: 'ref.error.closedHistoryPaymentType',
  window_inverted: 'ref.error.windowInverted',
  codes_unconfirmed: 'ref.error.codesUnconfirmed',
  not_roster_status: 'ref.error.notRosterStatus',
  truck_full: 'ref.error.truckFull',
  not_driver_kind: 'ref.error.notDriverKind',
  payment_type_direct: 'ref.error.paymentTypeDirect',
  not_in_code_list: 'ref.error.notInCodeList',
  trailer_already_paired: 'ref.error.trailerAlreadyPaired',
  already_voided: 'ref.error.alreadyVoided',
  rate_not_recorded: 'ref.error.rateNotRecorded',
}

/**
 * Trim, and turn empty into null.
 *
 * `''` and `null` are different in Postgres and identical to a user who left a
 * box alone. Storing the empty string makes "no phone number recorded" and "a
 * phone number of nothing" two states that render the same and sort
 * differently — and §8 requires `—` and a value to be distinguishable.
 */
export function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function requiredText(value: unknown, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed === '') throw new ReferenceError('required', { field })
  return trimmed
}

/** Two letters, upper case. A plate state of "il" and "IL" are one state. */
export function stateCode(value: unknown): string | null {
  const text = optionalText(value)
  return text === null ? null : text.toUpperCase().slice(0, 2)
}

/**
 * A model year, or null.
 *
 * Bounded rather than merely numeric: a typo of 202 or 20255 is a data-entry
 * slip that would otherwise sit in the fleet list looking like a fact.
 */
export function modelYear(value: unknown, field = 'year'): number | null {
  const text = optionalText(value)
  if (text === null) return null
  const year = Number(text)
  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    throw new ReferenceError('invalid_year', { field })
  }
  return year
}

/** Prisma's unique-violation code, without importing the runtime for it. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  )
}

/**
 * A date from a form's `<input type="date">`, or null.
 *
 * Parsed as UTC midnight rather than local: a hire date is a date-only field
 * (§8), and letting the server's zone decide turns "2026-07-30" into the 29th
 * for anyone west of Greenwich.
 */
export function dateOnly(value: unknown, field: string): Date | null {
  const text = optionalText(value)
  if (text === null) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) throw new ReferenceError('required', { field })
  return new Date(`${text}T00:00:00.000Z`)
}
