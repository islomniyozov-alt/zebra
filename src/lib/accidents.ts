import type { TxClient } from './tenancy'
import { ReferenceError } from './reference'

// ---------------------------------------------------------------------------
// THE ACCIDENT REGISTER — 49 CFR 390.15(b).
//
// Item 14. A motor carrier must keep a register of accidents and produce it at
// an audit. The regulation is unusually precise about what the register
// contains, so this file is unusually literal about it: the columns are
// §390.15(b)(2)'s six, and recordability is §390.5's three-part test.
//
// ── RECORDABLE IS DERIVED, AND NEVER TYPED ───────────────────────────────
//
// §390.5 defines an "accident" as an occurrence involving a commercial motor
// vehicle on a highway in commerce that results in:
//
//   (i)   a fatality;
//   (ii)  bodily injury to a person who, as a result, immediately receives
//         medical treatment away from the scene; or
//   (iii) one or more vehicles incurring disabling damage requiring tow-away.
//
// Three facts, one function. A `isRecordable` column would be somebody's
// opinion on the day it was typed, and the opinion that matters is the
// auditor's — who will apply the test to the three numbers in front of them.
// If the stored flag and the numbers disagreed, the flag would be the lie and
// the numbers would be the evidence.
//
// HAZMAT IS NOT PART OF THE TEST, and this is the mistake a careful reader
// makes. §390.15(b)(2)(vi) requires the register to RECORD whether hazardous
// materials were released; §390.5 does not count a release as making the
// occurrence an accident. A spill with no injury, no fatality and no tow-away
// is recorded in full and is not DOT-recordable, and this file says so in one
// place so nobody has to rediscover it.
//
// ── AN ENTRY IS VOIDED, NEVER DELETED ────────────────────────────────────
//
// There is no `deletedAt` on `Accident` and there must not be one. A register
// is a document a regulator reads; a row that leaves it silently is the shape
// of falsification, whatever the intent. A mistake is VOIDED — struck through,
// with a reason and a date, still on the register and still counted as a row
// that exists. `voidAccident` is the only way out and it requires a reason.
//
// ── THREE YEARS, AND THE CLOCK IS THE OCCURRENCE ─────────────────────────
//
// §390.15(b) requires the register be maintained for three years after the
// date of the accident. Retention is derived from `occurredAt`, not stored:
// a `retainedUntil` column would be three years of arithmetic frozen on the
// day somebody typed it, and the one thing that never changes here is the
// date the accident happened.
// ---------------------------------------------------------------------------

/** The three facts §390.5 tests, and nothing else. */
export interface RecordableFacts {
  fatalities: number
  /**
   * Injuries meeting §390.5: a person who IMMEDIATELY RECEIVED MEDICAL
   * TREATMENT AWAY FROM THE SCENE.
   *
   * NOT a count of everybody who was shaken up. The qualifier is the whole
   * distinction between a recordable accident and a bad afternoon, and it is
   * the field most likely to be filled in by somebody who has not read the
   * section — so the form says it too, not only this comment.
   */
  injuries: number
  /** One or more vehicles took disabling damage and had to be towed away. */
  towedAway: boolean
}

/**
 * Is this a DOT-recordable accident?
 *
 * ANY ONE OF THE THREE. The test is a disjunction and reads as one; a version
 * that weighed them would be inventing a rule the regulation does not have.
 */
export function isDotRecordable(facts: RecordableFacts): boolean {
  return facts.fatalities > 0 || facts.injuries > 0 || facts.towedAway
}

/** §390.15(b): three years after the date of the accident. */
export const RETENTION_YEARS = 3

/**
 * The day this entry may leave the register.
 *
 * Derived from the occurrence, never stored. Nothing deletes anything when it
 * passes — the register simply stops being obliged to carry it, and an entry
 * past retention is marked rather than removed, for the same reason a mistake
 * is voided rather than deleted.
 */
export function retainedUntil(occurredAt: Date): Date {
  const until = new Date(occurredAt)
  until.setUTCFullYear(until.getUTCFullYear() + RETENTION_YEARS)
  return until
}

export function isWithinRetention(occurredAt: Date, now: Date): boolean {
  return retainedUntil(occurredAt).getTime() > now.getTime()
}

// ── the register row, as an auditor reads it ─────────────────────────────

export interface RegisterEntry {
  id: string
  occurredAt: Date
  /** "Dayton, OH" — §390.15(b)(2)(ii) asks for the city or nearest town, and the state. */
  place: string
  driverName: string
  truckLabel: string | null
  injuries: number
  fatalities: number
  hazmatReleased: boolean
  towedAway: boolean
  /** Derived on every read. See `isDotRecordable`. */
  recordable: boolean
  /** Derived. The register may drop it after this date; nothing does so. */
  retainedUntil: Date
  withinRetention: boolean
  voidedAt: Date | null
  voidReason: string | null
  claimId: string | null
}

/**
 * Shape stored rows into register rows.
 *
 * Exported so the screen, the print view and the tests all read one function.
 * The recordable flag is computed HERE and nowhere else — three call sites
 * each applying §390.5 is three chances for one of them to include hazmat.
 */
export function shapeRegister(
  rows: readonly {
    id: string
    occurredAt: Date
    city: string | null
    state: string | null
    injuries: number
    fatalities: number
    hazmatReleased: boolean
    towedAway: boolean
    voidedAt: Date | null
    voidReason: string | null
    claimId: string | null
    driver: { firstName: string; lastName: string } | null
    truck: { unitNumber: string } | null
  }[],
  now: Date,
): RegisterEntry[] {
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt,
    // AN UNKNOWN PLACE IS BLANK, NOT INVENTED. The register wants the city or
    // the nearest town; a row where nobody recorded one is a gap an auditor
    // can see rather than a guess they cannot.
    place: [row.city, row.state].filter(Boolean).join(', '),
    driverName: row.driver
      ? `${row.driver.lastName}, ${row.driver.firstName}`
      : '',
    truckLabel: row.truck?.unitNumber ?? null,
    injuries: row.injuries,
    fatalities: row.fatalities,
    hazmatReleased: row.hazmatReleased,
    towedAway: row.towedAway,
    recordable: isDotRecordable(row),
    retainedUntil: retainedUntil(row.occurredAt),
    withinRetention: isWithinRetention(row.occurredAt, now),
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    claimId: row.claimId,
  }))
}

// ── writing one ──────────────────────────────────────────────────────────

export interface AccidentInput {
  companyId: string
  occurredAt: unknown
  city?: unknown
  state?: unknown
  driverId?: unknown
  truckId?: unknown
  injuries?: unknown
  fatalities?: unknown
  hazmatReleased?: unknown
  towedAway?: unknown
  /** The claim this accident produced, WHERE ONE EXISTS. Independent of it. */
  claimId?: unknown
  notes?: unknown
}

function count(value: unknown, field: string): number {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(String(value).trim())
  if (!Number.isInteger(n) || n < 0 || n > 1000) {
    throw new ReferenceError('invalid_year', { field })
  }
  return n
}

function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on' || value === '1'
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

function occurred(value: unknown): Date {
  const raw = text(value)
  if (raw === null) {
    throw new ReferenceError('required', { field: 'occurredAt' })
  }
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) {
    throw new ReferenceError('required', { field: 'occurredAt' })
  }
  return at
}

/**
 * File an accident on a company's register.
 *
 * THE COMPANY IS THE REGISTER. §390.15 is an obligation of the motor carrier,
 * and a group running four authorities keeps four registers — the one an
 * auditor asks for is the one belonging to the MC number they are auditing.
 * `companyId` is required for exactly that reason and is never inferred from
 * the driver or the truck, either of which may have transferred since.
 */
export async function recordAccident(
  tx: TxClient,
  organizationId: string,
  input: AccidentInput,
  options: { byUserId?: string | null } = {},
) {
  void options
  const companyId = text(input.companyId)
  if (companyId === null) {
    throw new ReferenceError('required', { field: 'companyId' })
  }

  return tx.accident.create({
    data: {
      organizationId,
      companyId,
      occurredAt: occurred(input.occurredAt),
      city: text(input.city),
      state: text(input.state),
      driverId: text(input.driverId),
      truckId: text(input.truckId),
      injuries: count(input.injuries, 'injuries'),
      fatalities: count(input.fatalities, 'fatalities'),
      hazmatReleased: flag(input.hazmatReleased),
      towedAway: flag(input.towedAway),
      claimId: text(input.claimId),
      notes: text(input.notes),
    },
  })
}

/**
 * Strike an entry from the register WITHOUT removing it.
 *
 * A REASON IS REQUIRED and the refusal says so. "Voided" with no reason is a
 * row an auditor will ask about and nobody will be able to answer; the whole
 * point of voiding rather than deleting is that the answer stays attached.
 *
 * Voiding twice is refused rather than silently overwriting the first reason,
 * which is the record of what actually happened.
 */
export async function voidAccident(tx: TxClient, id: string, reason: unknown) {
  const why = text(reason)
  if (why === null) {
    throw new ReferenceError('required', { field: 'voidReason' })
  }

  const current = await tx.accident.findUnique({
    where: { id },
    select: { id: true, voidedAt: true },
  })
  if (!current) throw new ReferenceError('not_found')
  if (current.voidedAt !== null) {
    throw new ReferenceError('already_voided', { field: 'voidReason' })
  }

  return tx.accident.update({
    where: { id },
    data: { voidedAt: new Date(), voidReason: why },
  })
}

/**
 * One company's register, newest first, in ONE statement.
 *
 * SCOPED BY COMPANY, NOT BY ORGANISATION. Row-level security already stops
 * another tenant's rows; this stops another AUTHORITY's, which RLS has nothing
 * to say about because they share a tenant. A group running RAM and Dolphins
 * must not hand an auditor a register with the other one's accidents on it.
 */
export async function registerFor(
  tx: TxClient,
  companyId: string,
  now: Date = new Date(),
): Promise<RegisterEntry[]> {
  const rows = await tx.accident.findMany({
    where: { companyId },
    orderBy: { occurredAt: 'desc' },
    take: 500,
    select: {
      id: true,
      occurredAt: true,
      city: true,
      state: true,
      injuries: true,
      fatalities: true,
      hazmatReleased: true,
      towedAway: true,
      voidedAt: true,
      voidReason: true,
      claimId: true,
      driver: { select: { firstName: true, lastName: true } },
      truck: { select: { unitNumber: true } },
    },
  })

  return shapeRegister(rows, now)
}
