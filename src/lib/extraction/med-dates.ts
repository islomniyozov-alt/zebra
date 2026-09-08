// ---------------------------------------------------------------------------
// A DATE OFF THE CERTIFICATE, CONVERTED HERE RATHER THAN BY THE MODEL.
//
// ── THE CDL DOES THIS THE OTHER WAY, AND THAT WAS THE WEAKER CHOICE ───────
//
// The CDL prompt says "DATES ARE ISO, yyyy-mm-dd" and the model converts. The
// audit of that contract on 2026-09-07 named it the closest sibling to the
// class bug: `01/12/2033` is ambiguous, converting it is an INTERPRETATION,
// and the card's own text is discarded on the way — so nothing downstream can
// audit the reading or even see what was printed.
//
// Here the model transcribes and this file converts. The rule is stated, the
// printed text survives in the contract beside the converted value, and a
// format nobody planned for refuses by name instead of being guessed at.
//
// ── MM/DD IS ASSUMED, AND THAT IS A STATED ASSUMPTION ─────────────────────
//
// The medical examiner's certificate is a FEDERAL US form — FMCSA, 49 CFR
// 391.43 — so `03/04/2027` is 4 March in the way an American form means it.
// That is an assumption about the DOCUMENT rather than a guess about the
// characters, which is the distinction that makes it safe to write down: a
// Canadian or European medical card is not this form and should not reach this
// function. If one ever does, it refuses on format rather than silently
// reading the day as the month.
//
// NEVER `new Date(text)`. It parses almost anything, in the process timezone,
// so `03/04/2027` becomes the 3rd for everyone west of Greenwich — the same
// hazard `parseLicenceExpiry` in the Datatruck seed records, and the reason
// both build the ISO string by hand and compare as text.
// ---------------------------------------------------------------------------

export type MedDateResult =
  | { ok: true; iso: string }
  | { ok: false; raw: string; why: string }

/** `03/04/2027` — the shape the federal form is printed and typed in. */
const SLASHED = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
/** `2027-03-04` — some electronic examiners print ISO already. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
/** `Mar 04, 2027` and `March 4, 2027`. */
const NAMED = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/

const MONTHS: Readonly<Record<string, string>> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
}

/** Two digits, for building an ISO string by hand. */
const pad = (value: number) => String(value).padStart(2, '0')

/**
 * A real calendar day, checked without a local-time `Date` anywhere near it.
 *
 * `Date.UTC` plus `toISOString` round-trips with no zone in it: February 30th
 * comes back as March 2nd and therefore fails to match what went in.
 */
function realDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const iso = `${year}-${pad(month)}-${pad(day)}`
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
    .toISOString()
    .slice(0, 10)
  return roundTrip === iso ? iso : null
}

export function parseMedDate(raw: string | null | undefined): MedDateResult {
  const value = (raw ?? '').trim()
  if (value === '') return { ok: false, raw: value, why: 'empty' }

  const slashed = SLASHED.exec(value)
  if (slashed) {
    // MONTH FIRST. See the note above: this is a US federal form, stated
    // rather than inferred from the digits — `03/04` gives no clue on its own,
    // which is exactly why the assumption has to be about the document.
    const iso = realDay(
      Number(slashed[3]),
      Number(slashed[1]),
      Number(slashed[2]),
    )
    return iso
      ? { ok: true, iso }
      : {
          ok: false,
          raw: value,
          why: `${value} is not a real date (read MM/DD/YYYY)`,
        }
  }

  const isoMatch = ISO.exec(value)
  if (isoMatch) {
    const iso = realDay(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    )
    return iso
      ? { ok: true, iso }
      : { ok: false, raw: value, why: `${value} is not a real date` }
  }

  const named = NAMED.exec(value)
  if (named) {
    const month = MONTHS[named[1]!.slice(0, 3).toUpperCase()]
    if (!month) {
      return { ok: false, raw: value, why: `${named[1]} is not a month` }
    }
    const iso = realDay(Number(named[3]), Number(month), Number(named[2]))
    return iso
      ? { ok: true, iso }
      : { ok: false, raw: value, why: `${value} is not a real date` }
  }

  return {
    ok: false,
    raw: value,
    why: 'not a format this contract states — MM/DD/YYYY, YYYY-MM-DD, or "Mar 4, 2027"',
  }
}
