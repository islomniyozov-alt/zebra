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
  /** The unit number is free, but a SOFT-DELETED row is still holding it. */
  | 'duplicate_deleted'
  | 'not_found'
  | 'invalid_year'
  | 'invalid_authority'

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
  duplicate_deleted: 'ref.error.duplicateDeleted',
  not_found: 'ref.error.notFound',
  invalid_year: 'ref.error.invalidYear',
  invalid_authority: 'ref.error.invalidAuthority',
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
