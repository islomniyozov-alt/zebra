import type { Confidence, Maybe } from './extraction-shape'

// ---------------------------------------------------------------------------
// WHAT A COMMERCIAL DRIVER'S LICENCE IS, AS FAR AS THIS SYSTEM CARES.
//
// Daler's ruling: Add driver opens two controls — an authority and a place to
// drop the CDL — and the licence fills the rest. The form we already have
// becomes the CONFIRM step after the read, prefilled, never the front door.
//
// ── THE READER IS A STUB AND RETURNS NOTHING. THAT IS DELIBERATE. ──────────
//
// There is no CDL in the corpus. `EXTRACTION-CONTRACT.md` opens by warning
// that its thirteen documents are already thin and double-weighted, and every
// rule in it exists because a real document produced it — Phase 5 §9 item 7
// exists precisely because changing a prompt before there is verified truth is
// tuning against the model's own answers.
//
// So the FLOW is real and the READ is not. Dropping a card walks the whole
// path — upload, read, confirm form — and arrives at an empty form, which is
// exactly what the reader knows today. The screen says so in words rather than
// leaving somebody to conclude the upload failed.
//
// WHAT IT NEEDS WHEN A CARD ARRIVES: the fields below, a JSON Schema written
// out (not derived — see extraction-shape.ts on why), a system prompt, and a
// refusal rule. `extraction.ts` treats "no stops" as a failed extraction
// because a rate confirmation without a lane was not read; the CDL's spine is
// LICENCE NUMBER AND EXPIRY, and a card yielding neither was not read either.
//
// DATE OF BIRTH IS DELIBERATELY ABSENT. It is printed on every licence and it
// is the most sensitive field on the card; nothing in this system consumes it.
// Extracting personal data because it happens to be there is the wrong
// default. Add it the day something needs it, with the reason written down.
// ---------------------------------------------------------------------------

export interface ExtractedCdl {
  /** As printed. Split into first/last by the confirm step, never by a model. */
  fullName: Maybe<string>
  licenceNumber: Maybe<string>
  /** Two-letter state. `stateCode` normalises it on the way into the record. */
  state: Maybe<string>
  /** "A", "B", "C" — the class the card grants. */
  licenceClass: Maybe<string>
  /** ISO date. Feeds a ComplianceItem, which is what the alerting reads. */
  expiresAt: Maybe<string>
}

export type CdlReadOutcome =
  | { ok: true; fields: ExtractedCdl }
  | { ok: false; reason: 'not_implemented' | 'too_large' | 'unsupported_type' }

/** Nothing read, in the shape a read returns. */
export const NOTHING_READ: ExtractedCdl = {
  fullName: null,
  licenceNumber: null,
  state: null,
  licenceClass: null,
  expiresAt: null,
}

/**
 * Read a licence. Returns nothing, on purpose, until a real card exists.
 *
 * IT RETURNS `not_implemented` RATHER THAN AN EMPTY SUCCESS. An empty success
 * is indistinguishable from "the model read the card and found nothing on it",
 * and the difference decides whether a dispatcher re-photographs the licence
 * or stops trying. The screen renders the two differently.
 */
export async function readCdl(_input: {
  base64: string
  mimeType: string
}): Promise<CdlReadOutcome> {
  return { ok: false, reason: 'not_implemented' }
}

/** Confidence a value carries, for a form that marks the doubtful ones. */
export type { Confidence }

/**
 * The licence's fields, as values for the confirm form.
 *
 * IN lib/ RATHER THAN IN THE ACTION, per the rule in AGENTS.md: a rule inside
 * a `'use server'` file is a rule no test can reach, because getting at it
 * means standing up the whole auth context. This one has a judgement in it and
 * therefore needs the test.
 *
 * ONLY WHAT WAS READ. A null field is a field the card did not yield, and it
 * must not become an empty string in the form — an empty string is a value
 * somebody typed, and the confirm step should show a blank that is honestly
 * blank rather than one the reader supplied.
 *
 * THE NAME IS SPLIT HERE AND NOT BY THE MODEL. A licence prints one name and
 * this system stores two. "Which word is the surname" is a judgement, and it
 * belongs in a form a human is already reading rather than made silently on
 * the way in: last word is the surname, everything before it is given. That is
 * wrong for compound surnames and for name orders that put the family name
 * first, which is exactly why the result lands in an EDITABLE field and not in
 * the database.
 */
export function cdlPrefill(fields: ExtractedCdl): Record<string, string> {
  const values: Record<string, string> = {}

  const full = fields.fullName?.value?.trim()
  if (full) {
    const parts = full.split(/\s+/)
    values.lastName = parts.length > 1 ? parts[parts.length - 1]! : full
    values.firstName = parts.slice(0, -1).join(' ') || full
  }
  if (fields.licenceNumber?.value) values.cdlNumber = fields.licenceNumber.value
  if (fields.state?.value) values.cdlState = fields.state.value
  if (fields.licenceClass?.value) values.cdlClass = fields.licenceClass.value
  if (fields.expiresAt?.value) values.cdlExpiresAt = fields.expiresAt.value

  return values
}
