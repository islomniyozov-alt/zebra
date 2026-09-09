import type { Maybe } from './envelope'

// ---------------------------------------------------------------------------
// THE ACORD CERTIFICATE OF INSURANCE, AS FAR AS THIS SYSTEM CARES.
//
// ACORD 25 is a standard form — the layout, the box numbers and the wording
// are fixed by ACORD rather than by each insurer's design department, which is
// why one contract can read a certificate from any of them.
//
// ── THIS CONTRACT WAS REBUILT ON 2026-09-09, AND BY A DOCUMENT ────────────
//
// The first version had nine flat fields, and three of them encoded a belief
// about what a certificate carries: `policyNumber` (singular), `liabilityLimit`
// and `cargoLimit`. It was written from the blank form, before any real
// certificate existed — the note where this paragraph now sits said so.
//
// The first real certificate, `corpus/coi/acord25-01.pdf`, broke all three:
//
//   * The insured is CHAPAN INC — an owner-operator's entity, not one of this
//     system's authorities.
//   * The coverages are NON-TRUCKING LIABILITY and PHYSICAL DAMAGE. There is
//     no auto-liability row and no cargo row at all, so the old contract's two
//     limit fields had nothing to hold and its prompt was asking for lines the
//     document does not print.
//   * It names two vehicles by VIN, in the description of operations.
//
// So the shape is now a LIST OF COVERAGE ROWS, READ AS PRINTED, and nothing
// here decides which coverage a row is. `coi-coverages.ts` proposes an
// obligation afterwards, on the transcription — the `cdl-codes.ts` rule, which
// exists because telling a model the permitted answers is how a Georgia
// `CLASS AM` became `A` at high confidence.
//
// ── WHAT THIS DOCUMENT IS FOR HERE ────────────────────────────────────────
//
// One question: WHAT IS INSURED, UNTIL WHEN, AND FOR HOW MUCH. That becomes
// `ComplianceItem` rows — on the COMPANY when the certificate names one of our
// authorities, on the TRUCKS when it names vehicles instead — and the expiry
// is what feeds the alarm.
//
// ── THE CROSS-CHECK IS THE POINT OF THE INSURED'S NAME ────────────────────
//
// A certificate names the INSURED, and brokers send certificates constantly —
// their own, their other carriers', last year's. `insuredName`, `insuredMc`
// and `insuredDot` exist so a person can be shown who the document names
// before anything is stored, and so `coi.ts` can work out whose file this
// belongs in. Same posture as the medical card's printed name: read, compared,
// and the comparison shown — never a silent match.
//
// ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
//
// NO CERTIFICATE HOLDER. NO PRODUCER. NO ADDITIONAL INSURED OR SUBROGATION
// ENDORSEMENTS. NO PREMIUM. NO INSURED ADDRESS.
//
// The form prints all of it and none of it becomes a compliance row. The
// holder is whoever asked for this copy, the producer is the broker who issued
// it. Extracting them would create fields no screen shows and every export
// carries.
//
// THE DESCRIPTION OF OPERATIONS IS THE INTERESTING EXCLUSION. The free-text
// box itself is still forbidden — it varies per certificate and means nothing
// to a compliance row — but `vehicles` reads the VINs OUT of it, because a
// certificate that insures particular trucks is evidence about those trucks
// and this system holds trucks. The paragraph is not stored; what it names is.
// ---------------------------------------------------------------------------

/**
 * ONE ROW OF THE COVERAGES TABLE, TRANSCRIBED.
 *
 * ── EVERY CELL IS ITS OWN ENVELOPE, AND THAT IS THE POINT ────────────────
 *
 * The CDL's code lists moved confidence onto the elements after ten runs of
 * one card measured what a single confidence costs: it had to cover a certain
 * value and an illegible one, and it reported the best case. The same argument
 * applies harder here, and `acord25-01.pdf` is the demonstration — it prints
 * ONE policy number and ONE date pair against TWO named coverages, so whether
 * the Physical Damage row shares them is a reading of the layout rather than
 * of any text. A model can say `type: high, policyNumber: low` and be exactly
 * right; one confidence over the row could only be wrong in one direction.
 *
 * NOTHING HERE IS AN OBLIGATION TYPE. `type` is the TYPE OF INSURANCE cell as
 * printed — "Non-Trucking Liability", "COMMERCIAL GENERAL LIABILITY", whatever
 * the form says. `coi-coverages.ts` proposes a `ComplianceType` from it,
 * afterwards, and a person confirms.
 */
export interface CoverageReading {
  /** The TYPE OF INSURANCE cell, exactly as printed. */
  type: Maybe<string>
  /**
   * The insurer CARRYING this row's risk.
   *
   * PER ROW, NOT PER CERTIFICATE. ACORD prints INSURER A through F and each
   * coverage row points at a letter; a certificate placing liability with one
   * carrier and physical damage with another is ordinary. A single top-level
   * insurer field would have quietly picked one.
   */
  insurer: Maybe<string>
  /** This row's policy number, exactly as printed. Never normalised. */
  policyNumber: Maybe<string>
  /**
   * This row's POLICY EFF and POLICY EXP, exactly as printed.
   *
   * TRANSCRIBED, NOT CONVERTED BY THE MODEL — `us-dates.ts` states the rule,
   * for the reason `med-dates.ts` records: asking for ISO makes the model
   * interpret `03/04/2027` and throws the printed text away on the way out.
   */
  effectiveAt: Maybe<string>
  expiresAt: Maybe<string>
  /**
   * The LIMITS cell for this row, exactly as printed, INCLUDING the currency,
   * the separators and any label beside it.
   *
   * NOT PARSED TO CENTS HERE, and often not a number at all: the physical
   * damage row on `acord25-01.pdf` prints "Deductibles - Comp: $2,500, Coll:
   * $2,500", which is a real and useful thing to record and is not a limit.
   * A contract that demanded a figure would have forced a guess.
   */
  limit: Maybe<string>
}

/**
 * ONE VEHICLE THE CERTIFICATE NAMES.
 *
 * ── WHY A TRUCKING SYSTEM READS THESE AND A GENERIC ONE WOULD NOT ────────
 *
 * An owner-operator's certificate does not name a carrier this system knows —
 * it names the operator's own entity — so the insured's name cannot place it.
 * The VINs can: they are the only thing on the document that points at a row
 * in this database. See `decideCoiSubject` in `coi.ts`.
 *
 * They also FILL NULLS. Trucks arrive from imports without VINs, and a
 * certificate is a document that states one — so a matched truck missing a VIN
 * gets it, add-missing, shown on the confirm step. Never a replacement: a VIN
 * already on record that disagrees with the certificate is a discrepancy to
 * show a person, not one for a reader to resolve.
 *
 * VALIDATED AFTERWARDS, NEVER GUIDED. `vin.ts` runs the ISO 3779 check digit
 * on what came back. The model is not told the alphabet excludes I, O and Q,
 * for the `cdl-codes.ts` reason — told the rule, it would apply the rule, and
 * a corrected VIN is indistinguishable from a read one.
 */
export interface VehicleReading {
  /** The VIN exactly as printed. `value: null` means one is printed here and could not be read. */
  vin: Maybe<string>
  /** Year, make and model as printed beside it — "2021, FREIGHTLINER, Cascadia". */
  description: Maybe<string>
}

export interface ExtractedCoi {
  /**
   * The insured, for the cross-check — never stored as a company's name.
   *
   * This is what decides whose file the certificate belongs in: an authority
   * this system holds, or somebody else's entity whose trucks we run.
   */
  insuredName: Maybe<string>
  /**
   * MC and USDOT as printed, when the certificate prints them.
   *
   * MANY DO NOT. They are not ACORD 25 boxes — they appear in the description
   * of operations, or on a schedule, or not at all — so both are `Maybe` and
   * their absence is never a refusal. Where they ARE present they are the
   * strongest cross-check available, because a name can be spelled several
   * ways and a USDOT number cannot.
   */
  insuredMc: Maybe<string>
  insuredDot: Maybe<string>
  /**
   * Every row of the COVERAGES table that carries anything.
   *
   * An EMPTY array is a certificate with no coverage rows filled in. `null` is
   * a document this was not read from at all — the answer for something that
   * is not an ACORD certificate.
   */
  coverages: CoverageReading[] | null
  /** Every vehicle named anywhere on the certificate. Empty means none named. */
  vehicles: VehicleReading[] | null
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
 * A list whose ELEMENTS are objects of envelopes.
 *
 * `value` is nullable inside every envelope on purpose — it is how the model
 * says "something is printed in this cell and I cannot read it" instead of
 * inventing a policy number. An element with every cell null should not be
 * returned at all; a row that carries one legible cell should.
 */
const listOf = (properties: Record<string, unknown>) => ({
  type: ['array', 'null'],
  items: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
})

/**
 * The JSON Schema the model is held to.
 *
 * WRITTEN OUT RATHER THAN DERIVED, as every other shape in this directory
 * argues: it is the contract with an outside system, and a derivation would
 * let a TypeScript refactor silently change what is asked for.
 *
 * `additionalProperties: false` IS DOING REAL WORK, at both levels. It is the
 * line that makes a volunteered certificate holder — or a resurrected
 * `liabilityLimit` — a schema violation rather than an extra key nobody
 * notices. The prompt refuses them in words; this refuses them in shape.
 */
export const COI_SCHEMA = {
  type: 'object',
  properties: {
    insuredName: field({ type: ['string', 'null'] }),
    insuredMc: field({ type: ['string', 'null'] }),
    insuredDot: field({ type: ['string', 'null'] }),
    // NO ENUM ON `type`. Constraining it to the obligations this system files
    // is precisely what would turn "Non-Trucking Liability" into
    // "Automobile Liability" — the `CLASS AM` failure with a policy behind it.
    coverages: listOf({
      type: field({ type: ['string', 'null'] }),
      insurer: field({ type: ['string', 'null'] }),
      policyNumber: field({ type: ['string', 'null'] }),
      effectiveAt: field({ type: ['string', 'null'] }),
      expiresAt: field({ type: ['string', 'null'] }),
      limit: field({ type: ['string', 'null'] }),
    }),
    vehicles: listOf({
      vin: field({ type: ['string', 'null'] }),
      description: field({ type: ['string', 'null'] }),
    }),
  },
  required: ['insuredName', 'insuredMc', 'insuredDot', 'coverages', 'vehicles'],
  additionalProperties: false,
} as const

/** Every key the contract has. The accuracy runner grades against this. */
export const COI_FIELDS = [
  'insuredName',
  'insuredMc',
  'insuredDot',
  'coverages',
  'vehicles',
] as const

/** Every cell inside one coverage row, for the test that keeps shape and schema in step. */
export const COI_COVERAGE_FIELDS = [
  'type',
  'insurer',
  'policyNumber',
  'effectiveAt',
  'expiresAt',
  'limit',
] as const

/** Every cell inside one vehicle. */
export const COI_VEHICLE_FIELDS = ['vin', 'description'] as const

/**
 * Keys this contract must NEVER carry, asserted by `tests/coi.test.ts`.
 *
 * The same treatment date of birth got on the CDL and health information got
 * on the medical card: a prompt is an instruction to something that may not
 * follow it, and a test over the schema is a shape that cannot carry the value
 * even if the model volunteers one.
 *
 * `liabilityLimit` AND `cargoLimit` ARE ON THIS LIST BECAUSE THEY USED TO BE ON
 * THE CONTRACT. They are not fields a model would invent — they are fields
 * this codebase invented, from the blank form, and the first real certificate
 * showed what they cost. Forbidding them by name is how the assumption stays
 * retired rather than drifting back the next time somebody finds a flat field
 * more convenient than a list.
 *
 * THE OTHER HALF OF THAT ASSUMPTION CANNOT BE FORBIDDEN THIS WAY, and saying
 * so is more useful than a list that looks complete. `policyNumber`,
 * `effectiveAt` and `expiresAt` were also flat fields here and are now
 * legitimate CELL names inside a coverage row — so a test that greps this file
 * for them would fail on the correct contract. What stops them returning to the
 * top level is the schema test: `COI_FIELDS` and `COI_SCHEMA.properties` must
 * agree exactly, and neither may grow a key without somebody writing it here.
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
  'liabilityLimit',
  'cargoLimit',
] as const
