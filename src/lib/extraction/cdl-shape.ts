import type { Field, Maybe } from './envelope'

// ---------------------------------------------------------------------------
// WHAT A COMMERCIAL DRIVER'S LICENCE IS, AS FAR AS THIS SYSTEM CARES.
//
// One file, imported by the parser, the prompt builder and the tests, so the
// three cannot disagree about the shape — the same arrangement `extraction-
// shape.ts` makes for rate confirmations, and for the same reason.
//
// ── KEYED OFF THE PRINTED AAMVA NUMBERS, NOT ENGLISH LABELS ────────────────
//
// Every US and Canadian licence prints numbered field identifiers from the
// AAMVA card design standard: `4d` beside the licence number, `4b` beside the
// expiry, `1` beside the family name. States relabel and reflow constantly —
// "DL", "LIC. NO.", "License Number"; expiry above the photo in one state and
// below it in another — and the NUMBERS do not move. A reader keyed on English
// words or on line order is a reader that works until the next state redesigns
// its card.
//
// FAMILY AND GIVEN COME FROM `1` AND `2`, WHICH IS THE POINT. A model asked
// for "first name" and "last name" applies English name intuition, and this
// office's drivers are named Islom Niyozov, Aziz Karimov, Ahmad — where that
// intuition is a coin flip. The card states which is which by number, so the
// reader can never swap them, and `cdlPrefill` no longer has to guess.
//
// ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
//
// Date of birth, sex, height, weight, eye colour, signature, portrait.
//
// THE TEST IS A CONSUMER, NOT SENSITIVITY. The rule has never been "no
// personal data" — it is DON'T EXTRACT SOMETHING BECAUSE IT HAPPENS TO BE IN
// THE FRAME. A field earns its place when something in this system reads it,
// and the ones above still have nothing that does. Add one the day that
// changes, with the reason written beside it.
//
// THE ADDRESS CROSSED THAT LINE ON 2026-09-07 and is now read and stored:
// dispatch and correspondence need it, and it appears on the driver record
// and the detail screen. It is transcribed from field 8 — street, city and
// postal code — and it is STALE MORE OFTEN THAN NOT, because a driver who
// moves has no reason to reissue the card until it expires. A starting point
// for a human to confirm; never a payroll or tax address.
//
// `addressStateCode` REMAINS A DIFFERENT THING FROM THE STORED STATE. It is a
// second reading of the ISSUING state, used to cross-check the header and then
// discarded. See both fields below.
// ---------------------------------------------------------------------------

export interface ExtractedCdl {
  /**
   * AAMVA field `4d`. The licence number, and ONLY from 4d.
   *
   * THE CARD CARRIES A SECOND LONG ALPHANUMERIC AT `5DD` — the document
   * discriminator, an inventory number for the piece of plastic. It is the
   * obvious wrong grab: same shape, similar length, often printed larger. A
   * driver filed under their discriminator is a driver whose licence number
   * matches nothing on any roadside inspection or MVR.
   */
  licenceNumber: Maybe<string>
  /** AAMVA `4b`. ISO date. Feeds the ComplianceItem the alerting watches. */
  expiresAt: Maybe<string>
  /** AAMVA `4a`. ISO date. */
  issuedAt: Maybe<string>
  /**
   * AAMVA `9`. THE CLASS EXACTLY AS PRINTED — transcription, not judgement.
   *
   * NOT AN ENUM, AND THAT IS THE FIX. It was `'A' | 'B' | 'C'`, with the same
   * three values in the JSON Schema and in the prompt, and a Georgia card
   * printing `AM` came back as `A` at high confidence: told the answer had to
   * be one of three, the model made it one of three. The `bad_enum` refusal
   * that existed for precisely this could never fire, because the value it
   * would have caught was destroyed before it arrived.
   *
   * The mapping from printed to operational lives in `cdl-class.ts`, on a
   * value that survived the trip, where an unknown class refuses by name and
   * says what it read.
   */
  class: Maybe<string>
  /** AAMVA `1`. The family name, as the card labels it. Never inferred. */
  familyName: Maybe<string>
  /** AAMVA `2`. The given name(s). */
  givenName: Maybe<string>
  /**
   * The issuing state, two letters, from the name across the top of the card.
   *
   * THE CLAIM. `addressStateCode` is the second reading, and `refuseCdl`
   * compares them.
   */
  state: Maybe<string>
  /**
   * AAMVA `8`, the street line, transcribed as printed.
   *
   * ── WHY THIS IS HERE WHEN DOB AND SEX ARE NOT ───────────────────────────
   *
   * The rule was never "no personal data". It was DON'T EXTRACT SOMETHING
   * BECAUSE IT HAPPENS TO BE PRINTED — a consumer is what justifies a field.
   * The address has one now: it goes on the driver record and the detail
   * screen, where dispatch and correspondence need it. Date of birth, sex,
   * height, weight and eye colour still have none, so they are still absent.
   *
   * A LICENCE ADDRESS IS OFTEN STALE. Drivers move and do not reissue the
   * card. This is a starting point on a form somebody confirms, never a source
   * of truth for payroll or a tax document — said in the schema, in the
   * migration, and in the words on the confirm form, because it is the kind of
   * thing that gets forgotten precisely where it matters.
   */
  addressLine1: Maybe<string>
  /** AAMVA `8`, the city line, as printed. */
  addressCity: Maybe<string>
  /**
   * AAMVA `8`, the postal code, as printed. Never reformatted or completed —
   * a ZIP+4 stays a ZIP+4 and a five-digit code is not padded into one.
   */
  addressPostalCode: Maybe<string>
  /**
   * The ST field of the printed address, two letters. The cross-check.
   *
   * NOT THE STORED ADDRESS'S STATE, even though the two agree on nearly every
   * card. This one exists ONLY to be compared against `state`, and it is
   * discarded afterwards; `Driver.addressState` is what gets written down.
   * Collapsing them would mean the cross-check silently starts depending on
   * what somebody edited on the confirm form, which is a check reading its own
   * answer — the failure the note below already records once.
   *
   * ITS OWN FIELD SINCE 2026-09-06, AND THE REASON IS THAT THE NOTE COULD NOT
   * DISCRIMINATE. It was asked for inside `state.note` — free text — and
   * `refuseCdl` regex-searched that string for two capitals. The first real
   * card returned a note of exactly `"FL"`, so the check passed by finding the
   * value it was supposed to be checking AGAINST. It would have passed on
   * anything containing the claimed code and on plenty that contained nothing
   * useful; a comparison of two named values cannot do either.
   *
   * TWO LETTERS, AND STILL ONLY TWO. The street, city and postal code are on
   * this contract now — as `addressLine1`, `addressCity` and
   * `addressPostalCode`, which are stored — but this field did not grow to
   * meet them. It answers one question, "does the card agree with itself",
   * and the smallest thing that answers it is a state code.
   */
  addressStateCode: Maybe<string>
  /** AAMVA `12`. Restriction codes. `NONE` on the card means an empty array. */
  restrictions: Field<string[]> | null
  /** AAMVA `9a`. Endorsement codes — H, N, T, P, S, X. Same NONE rule. */
  endorsements: Field<string[]> | null
  /**
   * A temporary or interim credential rather than a permanent card.
   *
   * SURFACED BECAUSE IT IS A COMPLIANCE HOLE. Paper interim licences print a
   * marker — "TEMPORARY", "INTERIM", "PAPER" — and expire in weeks rather than
   * years. Read as a full licence, the driver looks compliant for four years
   * on the strength of a document that stops being valid next month.
   */
  isTemporary: Maybe<boolean>
}

/**
 * The JSON Schema the model is held to.
 *
 * WRITTEN OUT RATHER THAN DERIVED from the types, exactly as
 * `rate-con-shape.ts` argues: it is the CONTRACT with an outside system, and
 * a derivation would let a TypeScript refactor silently change what the model
 * is asked for. The test asserts the two agree field for field.
 */
const field = (type: unknown, extra: Record<string, unknown> = {}) => ({
  type: ['object', 'null'],
  properties: {
    value: type,
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: { type: 'string' },
    ...extra,
  },
  required: ['value', 'confidence'],
  additionalProperties: false,
})

export const CDL_SCHEMA = {
  type: 'object',
  properties: {
    licenceNumber: field({ type: 'string' }),
    expiresAt: field({ type: 'string' }),
    issuedAt: field({ type: 'string' }),
    // NO ENUM. See the note on `class` above: constraining this to three
    // values is what made the model return one of three for a card printing
    // something else. The schema asks for a string; the table decides.
    class: field({ type: 'string' }),
    familyName: field({ type: 'string' }),
    givenName: field({ type: 'string' }),
    state: field({ type: 'string' }),
    addressLine1: field({ type: 'string' }),
    addressCity: field({ type: 'string' }),
    addressPostalCode: field({ type: 'string' }),
    addressStateCode: field({ type: 'string' }),
    restrictions: field({ type: 'array', items: { type: 'string' } }),
    endorsements: field({ type: 'array', items: { type: 'string' } }),
    isTemporary: field({ type: 'boolean' }),
  },
  required: [
    'licenceNumber',
    'expiresAt',
    'issuedAt',
    'class',
    'familyName',
    'givenName',
    'state',
    'addressLine1',
    'addressCity',
    'addressPostalCode',
    'addressStateCode',
    'restrictions',
    'endorsements',
    'isTemporary',
  ],
  additionalProperties: false,
} as const

/** Every key the schema names, for the test that keeps the two in step. */
export const CDL_FIELDS = Object.keys(
  CDL_SCHEMA.properties,
) as (keyof ExtractedCdl)[]
