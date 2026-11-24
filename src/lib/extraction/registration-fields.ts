import type { Confidence } from './envelope'
import type { ExtractedRegistration } from './registration-shape'
import { asText, judge, type Verdict } from './inspection-fields'
import { parseUsDate } from './us-dates'
import { checkVin } from './vin'

// ---------------------------------------------------------------------------
// EACH REGISTRATION FIELD READ OR UNREADABLE — NEVER A GUESS (TMS §6.5 part
// 4, v11.55; owner's ruling 2026-11-24).
//
// The inspection reader's rule, per field: a cab card whose plate was cut off
// by the photo still has a legible VIN and expiry, and the office should not
// retype those. Each field is judged alone by the inspection's own `judge` —
// not shown and low confidence are unreadable — and then by its converter
// here, which names its own reason. A refused field is shown on the form as
// "Unreadable — enter by hand" with what was seen; the rest still fill.
//
// PURE, AND THE CLOCK IS PASSED IN: the year's upper bound is the upload
// year plus one (a model year runs ahead of the calendar).
// ---------------------------------------------------------------------------

export type RegistrationUnreadableWhy =
  /** An expiry that does not convert under `parseUsDate`. */
  | 'not_a_date'
  /** A VIN of the wrong length, an illegal character, or a bad check digit. */
  | 'vin_invalid'
  /** A plate state that is not two letters once read. */
  | 'not_a_state'
  /** A year that is not four digits between 1950 and next year. */
  | 'not_a_year'
  /** A GVWR that is not a whole number of pounds. */
  | 'not_a_weight'

export type RegistrationVerdict<T> = Verdict<T, RegistrationUnreadableWhy>

export interface RegistrationVerdicts {
  /** Upper-cased, de-spaced, check digit verified. */
  vin: RegistrationVerdict<string>
  plate: RegistrationVerdict<string>
  /** Two upper-case letters. */
  plateState: RegistrationVerdict<string>
  /** ISO `yyyy-mm-dd`, converted from what was printed. */
  expiresAt: RegistrationVerdict<string>
  year: RegistrationVerdict<number>
  make: RegistrationVerdict<string>
  model: RegistrationVerdict<string>
  ownerName: RegistrationVerdict<string>
  /** Pounds, a whole number. */
  gvwr: RegistrationVerdict<number>
}

/**
 * US states, DC and the Canadian provinces by name, for a card that prints
 * the word rather than the code. Anything else that is not already two
 * letters is unreadable.
 */
const STATE_NAMES: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
  ALBERTA: 'AB',
  'BRITISH COLUMBIA': 'BC',
  MANITOBA: 'MB',
  'NEW BRUNSWICK': 'NB',
  'NEWFOUNDLAND AND LABRADOR': 'NL',
  'NOVA SCOTIA': 'NS',
  ONTARIO: 'ON',
  'PRINCE EDWARD ISLAND': 'PE',
  QUEBEC: 'QC',
  SASKATCHEWAN: 'SK',
}

export function readPlateState(
  printed: string,
): { ok: true; value: string } | { ok: false; why: 'not_a_state' } {
  const upper = printed
    .toUpperCase()
    .replace(/[.\s]+/g, ' ')
    .trim()
  if (/^[A-Z]{2}$/.test(upper)) return { ok: true, value: upper }
  const named = STATE_NAMES[upper]
  return named ? { ok: true, value: named } : { ok: false, why: 'not_a_state' }
}

export function readModelYear(
  printed: string,
  uploadedOnIso: string,
): { ok: true; value: number } | { ok: false; why: 'not_a_year' } {
  if (!/^\d{4}$/.test(printed)) return { ok: false, why: 'not_a_year' }
  const year = Number(printed)
  const latest = Number(uploadedOnIso.slice(0, 4)) + 1
  return year >= 1950 && year <= latest
    ? { ok: true, value: year }
    : { ok: false, why: 'not_a_year' }
}

/**
 * Pounds from what was printed: "80,000", "80000 LBS", "80 000 lb". A
 * kilogram figure, a decimal or anything else is unreadable rather than
 * converted — the conversion would be this file guessing the unit.
 */
export function readGvwr(
  printed: string,
): { ok: true; value: number } | { ok: false; why: 'not_a_weight' } {
  const match =
    /^(\d{1,3}(?:[,\s]\d{3})+|\d{3,6})\s*(?:LBS?\.?|POUNDS)?$/i.exec(
      printed.trim(),
    )
  if (!match) return { ok: false, why: 'not_a_weight' }
  const pounds = Number(match[1]!.replace(/[,\s]/g, ''))
  return pounds >= 1_000 && pounds <= 200_000
    ? { ok: true, value: pounds }
    : { ok: false, why: 'not_a_weight' }
}

export function judgeRegistration(
  fields: ExtractedRegistration,
  uploadedOnIso: string,
): RegistrationVerdicts {
  return {
    vin: judge(fields.vin, (printed) => {
      const check = checkVin(printed)
      // Never corrected: a VIN that fails is unreadable, not "nearly right".
      if (!check?.ok) return { ok: false, why: 'vin_invalid' as const }
      return { ok: true, value: check.vin }
    }),
    plate: judge<string, RegistrationUnreadableWhy>(fields.plate, asText),
    plateState: judge(fields.plateState, readPlateState),
    expiresAt: judge(fields.expiresAt, (printed) => {
      const date = parseUsDate(printed)
      if (!date.ok) return { ok: false, why: 'not_a_date' as const }
      return { ok: true, value: date.iso }
    }),
    year: judge(fields.year, (printed) =>
      readModelYear(printed, uploadedOnIso),
    ),
    make: judge<string, RegistrationUnreadableWhy>(fields.make, asText),
    model: judge<string, RegistrationUnreadableWhy>(fields.model, asText),
    ownerName: judge<string, RegistrationUnreadableWhy>(
      fields.ownerName,
      asText,
    ),
    gvwr: judge(fields.gvwr, readGvwr),
  }
}

/** A field the form fills, as the form's own names call it. */
export type RegistrationFormField =
  | 'vin'
  | 'plate'
  | 'plateState'
  | 'year'
  | 'make'
  | 'model'
  | 'ownerName'
  | 'grossWeightLbs'
  | 'registrationExpiresAt'

/** `yyyy-mm-dd` to `mm/dd/yyyy`, the way the typed-date fields show a date. */
const typedDate = (iso: string) => {
  const [year, month, day] = iso.split('-')
  return `${month}/${day}/${year}`
}

/**
 * What the form is filled with, in its own field names. An unreadable field
 * is absent — the form keeps what it had and shows "Unreadable — enter by
 * hand" — never a guess.
 */
export function registrationPrefill(
  verdicts: RegistrationVerdicts,
): Partial<Record<RegistrationFormField, string>> {
  const out: Partial<Record<RegistrationFormField, string>> = {}
  const put = <T>(
    name: RegistrationFormField,
    verdict: RegistrationVerdict<T>,
    show: (value: T) => string = String,
  ) => {
    if (verdict.read) out[name] = show(verdict.value)
  }
  put('vin', verdicts.vin)
  put('plate', verdicts.plate)
  put('plateState', verdicts.plateState)
  put('year', verdicts.year)
  put('make', verdicts.make)
  put('model', verdicts.model)
  put('ownerName', verdicts.ownerName)
  put('grossWeightLbs', verdicts.gvwr)
  put('registrationExpiresAt', verdicts.expiresAt, typedDate)
  return out
}

/** The verdict behind each form field, for the "unreadable" hint. */
export function verdictFor(
  verdicts: RegistrationVerdicts,
  name: RegistrationFormField,
): {
  read: boolean
  why?: string
  printed: string | null
  confidence?: Confidence
} {
  const verdict =
    name === 'grossWeightLbs'
      ? verdicts.gvwr
      : name === 'registrationExpiresAt'
        ? verdicts.expiresAt
        : verdicts[name]
  return verdict.read
    ? { read: true, printed: verdict.printed, confidence: verdict.confidence }
    : { read: false, why: verdict.why, printed: verdict.printed }
}
