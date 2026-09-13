import { readCostOf, type AskResult, type ReadCost } from './claude'
import type { Confidence } from './extraction/envelope'
import { askModel } from './model-engine'
import { readNothing } from './extraction/read-nothing'
import { parseCdlResponse } from './extraction/cdl-parse'
import { CDL_EXTRACTION_SYSTEM_WITH_SCHEMA } from './extraction/cdl-prompt'
import {
  codeList,
  refuseCdl,
  type CdlRefusal,
  type CodeReadout,
} from './extraction/cdl-refusal'
import { operationalClass } from './extraction/cdl-class'
import type { ExtractedCdl } from './extraction/cdl-shape'

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
// out (not derived — see rate-con-shape.ts on why), a system prompt, and a
// refusal rule. `extraction.ts` treats "no stops" as a failed extraction
// because a rate confirmation without a lane was not read; the CDL's spine is
// LICENCE NUMBER AND EXPIRY, and a card yielding neither was not read either.
//
// DATE OF BIRTH IS DELIBERATELY ABSENT. It is printed on every licence and it
// is the most sensitive field on the card; nothing in this system consumes it.
// Extracting personal data because it happens to be there is the wrong
// default. Add it the day something needs it, with the reason written down.
// ---------------------------------------------------------------------------

export type CdlReadOutcome =
  | { ok: true; fields: ExtractedCdl; cost: ReadCost }
  | {
      ok: false
      reason:
        | 'too_large'
        | 'unsupported_type'
        | 'call_failed'
        | 'unparsable'
        /** The engine answered, in the right shape, with nothing in it. */
        | 'read_nothing'
        | CdlRefusal
      /**
       * What the attempt cost, or null when no engine was ever reached.
       *
       * A refused reading is a BILLED reading — the model answered and the
       * rules rejected it — and a ledger that dropped those would understate
       * by exactly the refusal rate. `null` is reserved for the branch above,
       * where the call itself failed.
       */
      cost: ReadCost | null
    }

/** Nothing read, in the shape a read returns. */
export const NOTHING_READ: ExtractedCdl = {
  licenceNumber: null,
  expiresAt: null,
  issuedAt: null,
  class: null,
  familyName: null,
  givenName: null,
  state: null,
  addressLine1: null,
  addressCity: null,
  addressPostalCode: null,
  addressStateCode: null,
  restrictions: null,
  endorsements: null,
  isTemporary: null,
}

/**
 * Read a licence.
 *
 * ── SAME ENGINE POSTURE AS THE RATE-CON PATH, NO NEW DECISIONS ────────────
 *
 * It goes through `askModel`, which picks `EXTRACTION_MODEL` and falls back
 * only on the default path — a caller that NAMES a model gets the failure it
 * asked for, because the engine table names one per column and a silent swap
 * would make a column measure something other than what it says. This file
 * chooses nothing about engines; it hands over a document and a system prompt.
 *
 * THE FAILURE TAXONOMY IS THE SAME ONE, AND IT MATTERS TO THE SCREEN.
 * `not_readable` is the DOCUMENT's fault — too large, wrong type, more than
 * the model can say back — and `call_failed` is ours or the network's. One
 * means photograph it again; the other means try again. A dispatcher told the
 * wrong one makes a wasted trip to the driver.
 *
 * AND A PARSED READING IS STILL SUBJECT TO THE REFUSAL RULES. Parsing proves
 * the model answered in the right shape; `refuseCdl` decides whether what it
 * said is a licence reading — spine present, spine confident, state agreeing
 * with itself, expiry after issue. Both have to pass before a single value
 * reaches a form.
 */
export async function readCdl(input: {
  base64: string
  mimeType: string
  /** Named by the accuracy run, absent everywhere else. */
  model?: string
  apiKey?: string
}): Promise<CdlReadOutcome> {
  let answer: AskResult
  try {
    answer = await askModel({
      base64: input.base64,
      mimeType: input.mimeType,
      system: CDL_EXTRACTION_SYSTEM_WITH_SCHEMA,
      prompt: 'Read this driver licence and return the JSON described.',
      // WHAT THIS IS, so the provider can be chosen per document type
      // (owner's ruling, 2026-09-12). The reader still picks no engine.
      kind: 'cdl',
      ...(input.model ? { model: input.model } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    })
  } catch (error) {
    const reason =
      error instanceof Error &&
      'reason' in error &&
      (error.reason === 'document_too_large' ||
        error.reason === 'unsupported_media_type' ||
        error.reason === 'truncated')
        ? ('unsupported_type' as const)
        : ('call_failed' as const)
    // NO ENGINE ANSWERED, SO THERE IS NOTHING TO BILL. Null rather than a
    // zero-token reading, which would claim a call happened and was free.
    return { ok: false, reason, cost: null }
  }

  const cost = readCostOf(answer)

  let fields: ExtractedCdl
  try {
    fields = parseCdlResponse(answer.text)
  } catch {
    // A RESPONSE THAT DOES NOT PARSE IS A FAILED READ, never a half-filled
    // form. The eighteen fixtures in tests/cdl-parse.test.ts are the shapes
    // that land here.
    return { ok: false, reason: 'unparsable', cost }
  }

  // ── AN ANSWER THAT SAYS NOTHING IS NOT A READING ──────────────────
  //
  // Measured 2026-09-13: an engine returned valid, schema-conformant JSON
  // with EVERY value null for thirteen documents in a row, and every
  // defence in this pipeline was satisfied because there was nothing there
  // to be wrong. See `read-nothing.ts`.
  if (readNothing({ base64: input.base64, fields })) {
    return { ok: false, reason: 'read_nothing', cost }
  }

  const refusal = refuseCdl(fields)
  if (refusal) return { ok: false, reason: refusal, cost }

  return { ok: true, fields, cost }
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

  // NO NAME SPLITTING ANY MORE, AND THAT IS THE POINT OF THE AAMVA KEYS. This
  // used to take one printed name and guess which word was the surname — last
  // word wins — which is a coin flip for this office's drivers and was flagged
  // as known-wrong at the time. Field 1 IS the family name and field 2 IS the
  // given name, stated by the card, so the guess is gone rather than improved.
  if (fields.familyName?.value) values.lastName = fields.familyName.value.trim()
  if (fields.givenName?.value) values.firstName = fields.givenName.value.trim()

  if (fields.licenceNumber?.value) values.cdlNumber = fields.licenceNumber.value
  if (fields.state?.value) values.cdlState = fields.state.value

  // THE MAPPED CLASS FILLS THE FIELD; THE PRINTED ONE IS IN `cdlNotes`.
  // `Driver.cdlClass` is what dispatch and compliance read, so it holds the
  // operational class — but the card's own text is not discarded to get it.
  // `refuseCdl` has already stopped anything the table does not know, so this
  // cannot silently blank a class it failed to understand.
  const operational = operationalClass(fields.class?.value)
  if (operational) values.cdlClass = operational

  // ── THE ADDRESS, INTO EDITABLE FIELDS ────────────────────────────────────
  //
  // `addressState` COMES FROM `addressStateCode`, AND THAT IS THE ONLY PLACE
  // THE TWO MEET. The cross-check has already run by the time anything reaches
  // here — `refuseCdl` compared it against the header and refused a card that
  // contradicted itself — so what is copied is a value that survived the
  // comparison, not a value the comparison will later depend on. Nothing reads
  // `Driver.addressState` back into the check.
  //
  // AND EVERY ONE OF THESE IS EDITABLE ON THE CONFIRM FORM, because a licence
  // address is frequently the one the driver had two moves ago.
  if (fields.addressLine1?.value)
    values.addressLine1 = fields.addressLine1.value.trim()
  if (fields.addressCity?.value)
    values.addressCity = fields.addressCity.value.trim()
  if (fields.addressStateCode?.value)
    values.addressState = fields.addressStateCode.value.trim().toUpperCase()
  if (fields.addressPostalCode?.value)
    values.addressPostalCode = fields.addressPostalCode.value.trim()
  if (fields.expiresAt?.value) values.cdlExpiresAt = fields.expiresAt.value

  return values
}

/**
 * What the confirm form must SAY rather than fill in.
 *
 * A temporary credential is the one reading that changes what the driver is,
 * not just what a field holds: read as a permanent card it produces a
 * ComplianceItem four years out on the strength of a paper licence that lapses
 * next month. Endorsements, restrictions and the printed class have no column
 * — they qualify what the form holds rather than filling it.
 *
 * RENDERED BY `NewDriverFlow`'s CONFIRM STEP, and that sentence used to be
 * false. This value was returned by `/api/cdl/read` and the component never
 * read the key, so every one of these reached the browser and was dropped
 * while the comment here claimed they were "shown so the dispatcher sees what
 * the card said" — true of the payload, true of nothing on screen. If the
 * component stops rendering them, this comment is wrong again: it names the
 * renderer so the claim can be checked rather than believed.
 */
export interface CdlNotes {
  isTemporary: boolean
  /** One entry per code, each with its own confidence and recognition flag. */
  endorsements: CodeReadout[]
  restrictions: CodeReadout[]
  /**
   * What field 9 actually said, kept beside the class the form was given.
   *
   * A LEGAL DOCUMENT'S OWN TEXT IS NOT DISCARDED AT THE DOOR. `AM` maps to `A`
   * for operating purposes and the two are not the same statement; a record
   * that keeps only the mapped value cannot answer "what did the card say",
   * which is the question every dispute about a licence turns on.
   *
   * IT SITS HERE BECAUSE THERE IS NO COLUMN FOR IT, exactly like endorsements
   * and restrictions above — shown to the dispatcher on the confirm step
   * rather than persisted. Giving it a column on `Driver` is a migration and a
   * separate decision.
   */
  classPrinted: string | null
}

export function cdlNotes(fields: ExtractedCdl): CdlNotes {
  return {
    isTemporary: fields.isTemporary?.value === true,
    endorsements: codeList('endorsement', fields.endorsements),
    restrictions: codeList('restriction', fields.restrictions),
    classPrinted: fields.class?.value?.trim() || null,
  }
}

/** Re-exported so callers have one import for the contract. */
export { refuseCdl }
export type { ExtractedCdl, CdlRefusal }
