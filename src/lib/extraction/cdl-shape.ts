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
// Date of birth, address, sex, height, weight, eye colour, signature, portrait.
// Every one of them is printed on the card and none is consumed by anything in
// this system. Extracting personal data because it happens to be in the frame
// is the wrong default: it creates a copy of somebody's identity documents in
// a database that never asked for one. Add a field the day something needs it,
// with the reason written beside it.
//
// The ADDRESS is read but never returned — see `state` below, which uses it as
// a cross-check and keeps nothing.
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
  /** AAMVA `9`. A, B or C — the commercial class the card grants. */
  class: Maybe<'A' | 'B' | 'C'>
  /** AAMVA `1`. The family name, as the card labels it. Never inferred. */
  familyName: Maybe<string>
  /** AAMVA `2`. The given name(s). */
  givenName: Maybe<string>
  /**
   * The issuing state, two letters.
   *
   * DERIVED FROM THE HEADER AND CROSS-CHECKED AGAINST THE ADDRESS. The state
   * name across the top of the card is the claim; the ST field in the printed
   * address is the second reading. They agree on a real card, and a
   * disagreement means the reader has combined two documents or misread the
   * header — which is a refusal, not a value to pick a winner from.
   */
  state: Maybe<string>
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
    class: field({ type: 'string', enum: ['A', 'B', 'C'] }),
    familyName: field({ type: 'string' }),
    givenName: field({ type: 'string' }),
    state: field({ type: 'string' }),
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
