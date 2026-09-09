import type { Maybe } from './envelope'

// ---------------------------------------------------------------------------
// THE ACORD CERTIFICATE OF INSURANCE, AS FAR AS THIS SYSTEM CARES.
//
// ACORD 25 is a standard form — the layout, the box numbers and the wording
// are fixed by ACORD rather than by each insurer's design department, which is
// why one contract can read a certificate from any of them. Everything below
// is transcribed from that form; none of it comes from watching a model's
// output, because there is no certificate in the corpus yet.
//
// ── WHAT THIS DOCUMENT IS FOR HERE ────────────────────────────────────────
//
// One question: IS THIS CARRIER INSURED, UNTIL WHEN, AND FOR HOW MUCH. That
// becomes a `ComplianceItem` on the COMPANY — liability and cargo are fleet
// policies, not properties of a vehicle (see `FLEET_COMPLIANCE_TYPES`) — and
// the expiry is what feeds the alarm.
//
// ── THE CROSS-CHECK IS THE POINT OF THE INSURED'S NAME ────────────────────
//
// A certificate names the INSURED, and brokers send certificates constantly —
// their own, their other carriers', last year's. `insuredName`, `insuredMc`
// and `insuredDot` exist so a person can be shown "this names RAM Haulage,
// MC 1234567, and you are filing it against Dolphins Transport" before
// anything is stored. Same posture as the medical card's printed name: read,
// compared, and the comparison shown — never a silent match.
//
// ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
//
// NO CERTIFICATE HOLDER. NO PRODUCER. NO DESCRIPTION OF OPERATIONS. NO
// ADDITIONAL INSURED OR SUBROGATION ENDORSEMENTS. NO PREMIUM.
//
// The form prints all of it. A dispatch system needs the policy, its dates and
// its limits; the holder is whoever asked for this copy, the producer is the
// broker who issued it, and the operations box is free text that varies per
// certificate and means nothing to a compliance row. Extracting them would
// create fields no screen shows and every export carries.
//
// AUTO PHYSICAL DAMAGE IS ABSENT TOO, and that is a narrower call: it is on
// the form and it IS a real coverage, but it insures particular vehicles for
// particular values and this contract files fleet policies. It goes in the day
// something consumes it.
//
// ── NO LIST FIELDS, SO NO PER-ELEMENT CONFIDENCE ──────────────────────────
//
// The CDL's code lists carry an envelope per element because one confidence
// covering several values reports the best case. Nothing here is a list — the
// endorsements that would have been are excluded above — so that pattern is
// deliberately not reached for.
// ---------------------------------------------------------------------------

export interface ExtractedCoi {
  /**
   * The policy number, EXACTLY AS PRINTED.
   *
   * THE IDENTIFIER, and the one field that makes two certificates for the same
   * policy recognisable as the same policy. Transcribed rather than
   * normalised: insurers use their own formats, and stripping punctuation to
   * make them look alike is how two different policies come to share a key.
   */
  policyNumber: Maybe<string>
  /**
   * The insurer — the company CARRYING the risk, box "INSURER A" and its
   * siblings, not the producer who sold it.
   */
  insurer: Maybe<string>
  /**
   * Policy effective and expiry, exactly as printed.
   *
   * THE SPINE IS THE EXPIRY. A certificate that yields no expiry was not read,
   * whatever else came back: the expiry is the only field that feeds an alarm,
   * and a compliance row cannot exist without one — `expiresAt` is NOT NULL.
   *
   * TRANSCRIBED, NOT CONVERTED BY THE MODEL. `coi-dates.ts` states the rule,
   * for the reason `med-dates.ts` records: asking for ISO makes the model
   * interpret `03/04/2027` and throws the printed text away on the way out.
   */
  effectiveAt: Maybe<string>
  expiresAt: Maybe<string>
  /**
   * Limits, exactly as printed, INCLUDING the currency and separators.
   *
   * NOT PARSED TO CENTS HERE. These are transcriptions; `money.ts` converts,
   * and it refuses what it cannot read rather than guessing. A limit that
   * arrives as `1,000,000` and a limit that arrives as `$1,000,000` are the
   * same number and neither is this contract's business to normalise.
   *
   * COMBINED SINGLE LIMIT IS WHAT THE AUTO SECTION USUALLY PRINTS, and cargo
   * sits under the inland-marine or a scheduled line. Both are `Maybe`: plenty
   * of certificates carry one and not the other, and an absent coverage is a
   * fact worth showing rather than a zero to invent.
   */
  liabilityLimit: Maybe<string>
  cargoLimit: Maybe<string>
  /**
   * The insured, for the cross-check — never stored as the company's name.
   *
   * The company row already knows what it is called. This exists so the
   * confirm step can say which carrier the certificate names, and let a person
   * notice when it is not the one they are filing against.
   */
  insuredName: Maybe<string>
  /**
   * MC and USDOT as printed on the certificate, when it prints them.
   *
   * MANY CERTIFICATES DO NOT. They are not ACORD 25 boxes — they appear in the
   * description of operations, or on a schedule, or not at all — so both are
   * `Maybe` and their absence is never a refusal. Where they ARE present they
   * are the strongest cross-check available, because a name can be spelled
   * several ways and a USDOT number cannot.
   */
  insuredMc: Maybe<string>
  insuredDot: Maybe<string>
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
 * WRITTEN OUT RATHER THAN DERIVED, as every other shape in this directory
 * argues: it is the contract with an outside system, and a derivation would
 * let a TypeScript refactor silently change what is asked for.
 *
 * `additionalProperties: false` IS DOING REAL WORK. It is the line that makes
 * a volunteered certificate holder or premium a schema violation rather than
 * an extra key nobody notices — the prompt refuses them in words, and this
 * refuses them in shape.
 */
export const COI_SCHEMA = {
  type: 'object',
  properties: {
    policyNumber: field({ type: ['string', 'null'] }),
    insurer: field({ type: ['string', 'null'] }),
    effectiveAt: field({ type: ['string', 'null'] }),
    expiresAt: field({ type: ['string', 'null'] }),
    liabilityLimit: field({ type: ['string', 'null'] }),
    cargoLimit: field({ type: ['string', 'null'] }),
    insuredName: field({ type: ['string', 'null'] }),
    insuredMc: field({ type: ['string', 'null'] }),
    insuredDot: field({ type: ['string', 'null'] }),
  },
  required: [
    'policyNumber',
    'insurer',
    'effectiveAt',
    'expiresAt',
    'liabilityLimit',
    'cargoLimit',
    'insuredName',
    'insuredMc',
    'insuredDot',
  ],
  additionalProperties: false,
} as const

/** Every key the contract has. The accuracy runner grades against this. */
export const COI_FIELDS = [
  'policyNumber',
  'insurer',
  'effectiveAt',
  'expiresAt',
  'liabilityLimit',
  'cargoLimit',
  'insuredName',
  'insuredMc',
  'insuredDot',
] as const

/**
 * Keys this contract must NEVER carry, asserted by `tests/coi.test.ts`.
 *
 * The same treatment date of birth got on the CDL and health information got
 * on the medical card: a prompt is an instruction to something that may not
 * follow it, and a test over the schema is a shape that cannot carry the value
 * even if the model volunteers one.
 */
export const COI_FORBIDDEN_FIELDS = [
  'certificateHolder',
  'producer',
  'descriptionOfOperations',
  'additionalInsured',
  'subrogationWaiver',
  'premium',
  'insuredAddress',
  'producerContact',
] as const
