import type { Maybe } from './envelope'

// ---------------------------------------------------------------------------
// THE DOT MEDICAL EXAMINER'S CERTIFICATE, AS FAR AS THIS SYSTEM CARES.
//
// The form is federal — FMCSA, 49 CFR 391.43 — so what it prints is fixed by
// regulation rather than by a state's design department. Everything below is
// transcribed from that form; none of it comes from watching a model's output,
// because there is no certificate in the corpus yet.
//
// ── FOUR FIELDS, AND A FIFTH THAT IS ONLY EVER COMPARED ───────────────────
//
// expiresAt, issuedAt, examinerName, examinerRegistryNumber. That is the whole
// stored contract. `driverName` is read, compared, and kept nowhere — see
// below.
//
// ── WHAT IS DELIBERATELY NOT HERE, AND WHY IT IS ASSERTED ─────────────────
//
// NO MEDICAL DETERMINATION. NO RESTRICTIONS, QUALIFIERS OR EXEMPTIONS. NO
// HEALTH INFORMATION OF ANY KIND.
//
// The certificate prints a great deal of it: whether the driver meets the
// standards, whether they wear corrective lenses or a hearing aid, whether an
// exemption or a skill performance evaluation applies, sometimes a shortened
// validity period that implies a monitored condition. A dispatch system needs
// to know WHEN THE CARD EXPIRES and WHO SIGNED IT. It has no use for any of
// the rest, and holding it would create a medical record inside a freight
// database — one nobody asked for, that no screen displays, and that every
// future export and backup would carry.
//
// THE PROMPT REFUSES THEM BY NAME AND `tests/med-cert.test.ts` ASSERTS THEY
// ARE ABSENT FROM THIS FILE. Same treatment date of birth got on the CDL, and
// for the same reason: a prompt is an instruction to something that may not
// follow it, and a schema with no such key is a shape that cannot carry the
// value even if the model volunteers one.
//
// ── NO LIST FIELDS, SO NO PER-ELEMENT CONFIDENCE ──────────────────────────
//
// The CDL's code lists carry an envelope per element, because ten runs of one
// card showed a single confidence covering a certain code and an illegible one
// and reporting the best case. Nothing in THIS contract is a list — the
// restrictions that would have been are excluded above — so the pattern is
// deliberately not reached for. It is here the moment a list is.
// ---------------------------------------------------------------------------

export interface ExtractedMedicalCert {
  /**
   * The expiry, EXACTLY AS PRINTED. Converted by `parseMedDate`, not by the
   * model.
   *
   * THE SPINE. This is the only field that feeds an alarm: a medical card is
   * what makes a driver legal to operate, and an expired one grounds them. A
   * certificate that yields no expiry was not read, whatever else came back.
   *
   * TRANSCRIBED RATHER THAN CONVERTED UPSTREAM, which is where this contract
   * departs from the CDL's. Asking a model for ISO makes it interpret
   * `03/04/2027` and discards the printed text on the way out; here the text
   * survives and `med-dates.ts` states the rule.
   */
  expiresAt: Maybe<string>
  /** The examination date, exactly as printed. Bounds the expiry. */
  issuedAt: Maybe<string>
  /** The examiner's printed name. Not matched against anything. */
  examinerName: Maybe<string>
  /**
   * The examiner's National Registry number.
   *
   * The one identifier on this form that can be checked against something
   * outside it — FMCSA publishes the registry — which is why it is worth
   * storing and why it is transcribed rather than normalised.
   */
  examinerRegistryNumber: Maybe<string>
  /**
   * The driver's printed name — the matching key, and never stored.
   *
   * ── THIS FIELD'S JOB CHANGED ON 2026-09-08, AND THE REASON IS THE FLOW ──
   *
   * It was read ONLY to be compared, and this comment said the reader
   * identifies nobody. That was true while the upload lived on a driver's own
   * page: the page stated the subject, so matching a name could only add a way
   * to get it wrong.
   *
   * The upload is the front door now — a certificate is dropped before any
   * driver is named — so nothing states the subject and this is what proposes
   * one. A property that held because of where a control lived does not
   * survive the control moving; leaving the old sentence here would have been
   * a comment asserting an invariant the code no longer has.
   *
   * WHAT DID NOT CHANGE IS THAT IT NEVER DECIDES. `matchDriverByName` requires
   * an EXACT set of name words and treats none and several identically — ask.
   * A person confirms the driver before anything is filed. See `med-cert.ts`
   * for why nearest-match is refused over this particular roster.
   *
   * Still not stored: the four contracted fields are what becomes a row.
   */
  driverName: Maybe<string>
}

const field = (type: unknown) => ({
  type: ['object', 'null'],
  properties: {
    value: type,
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: { type: 'string' },
  },
  required: ['value', 'confidence'],
  additionalProperties: false,
})

/**
 * The JSON Schema the model is held to.
 *
 * WRITTEN OUT RATHER THAN DERIVED, as `rate-con-shape.ts` and `cdl-shape.ts`
 * both argue: it is the contract with an outside system, and a derivation
 * would let a TypeScript refactor silently change what is asked for.
 *
 * `additionalProperties: false` IS DOING REAL WORK HERE. It is the line that
 * makes a volunteered blood-pressure reading or vision restriction a schema
 * violation rather than an extra key nobody notices — the prompt refuses them
 * in words, and this refuses them in shape.
 *
 * NO ENUMS ON ANYTHING TRANSCRIBED. `confidence` is our own vocabulary about
 * the model's certainty and is legitimately closed; every field off the
 * document is a free string, because telling a model the permitted answers is
 * what turned a Georgia `CLASS AM` into `A` at high confidence.
 */
export const MEDICAL_CERT_SCHEMA = {
  type: 'object',
  properties: {
    expiresAt: field({ type: 'string' }),
    issuedAt: field({ type: 'string' }),
    examinerName: field({ type: 'string' }),
    examinerRegistryNumber: field({ type: 'string' }),
    driverName: field({ type: 'string' }),
  },
  required: [
    'expiresAt',
    'issuedAt',
    'examinerName',
    'examinerRegistryNumber',
    'driverName',
  ],
  additionalProperties: false,
} as const

/** Every key the schema names, for the test that keeps the two in step. */
export const MEDICAL_CERT_FIELDS = Object.keys(
  MEDICAL_CERT_SCHEMA.properties,
) as (keyof ExtractedMedicalCert)[]

/**
 * Everything this contract must never grow a field for.
 *
 * ASSERTED, NOT JUST INTENDED. `tests/med-cert.test.ts` checks each of these
 * against the schema, the type's own keys and the prompt — so adding one is a
 * test failure that names it rather than a review somebody has to notice.
 *
 * These are the words a well-meaning change would reach for. The list is
 * deliberately broader than the form's own labels, because the next person to
 * add a field will call it whatever seems natural at the time.
 */
export const MEDICAL_CERT_FORBIDDEN_FIELDS: readonly string[] = [
  'determination',
  'qualified',
  'meetsStandards',
  'restrictions',
  'qualifiers',
  'exemption',
  'skillPerformanceEvaluation',
  'spe',
  'correctiveLenses',
  'hearingAid',
  'bloodPressure',
  'vision',
  'hearing',
  'diabetes',
  'condition',
  'medication',
  'height',
  'weight',
  'dateOfBirth',
  'dob',
]
