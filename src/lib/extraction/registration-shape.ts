import type { Maybe } from './envelope'

// ---------------------------------------------------------------------------
// THE VEHICLE REGISTRATION — THE CAB CARD (TMS §6.5 part 4, v11.55; owner's
// ruling 2026-11-24).
//
// A state's registration card for a power unit or a trailer: an IRP
// apportioned cab card or an ordinary single-state registration. Layouts vary
// by state; the facts this system wants are the same few on every one.
//
// ── NINE FIELDS, ALL TRANSCRIBED ─────────────────────────────────────────
//
// Every value is a free string as printed. The expiry is converted after the
// reader by `us-dates.ts`, the VIN checked by `vin.ts`, the year and GVWR
// read as numbers by `registration-fields.ts`. None of that is asked of the
// model, because a model asked for ISO or for a valid VIN will produce one.
//
// ── NOT THE REST OF THE CARD, AND THAT IS ASSERTED ───────────────────────
//
// The registrant's address, the fees, the title number, the apportioned
// jurisdictions and their weights are on many cab cards. The owner ruled the
// nine. `tests/registration-reader.test.ts` checks every name in
// `REGISTRATION_FORBIDDEN_FIELDS` against the schema, the type and the
// prompt, so growing one is a failure that names it.
// ---------------------------------------------------------------------------

export interface ExtractedRegistration {
  /** The VIN as printed. Checked, never corrected. */
  vin: Maybe<string>
  /** The plate number, character for character. */
  plate: Maybe<string>
  /** The plate's state or province as printed — "IL", "Illinois". */
  plateState: Maybe<string>
  /** The registration's expiry exactly as printed. Converted by `parseUsDate`. */
  expiresAt: Maybe<string>
  /** The model year as printed. */
  year: Maybe<string>
  /** The make as printed — "FRHT", "KENWORTH". */
  make: Maybe<string>
  /** The model as printed, if the card shows one. */
  model: Maybe<string>
  /** The registered owner's name — a person or a company. Never the address. */
  ownerName: Maybe<string>
  /**
   * The gross vehicle weight (rating) as printed — "80,000", "80000 LBS".
   * On an apportioned card, the registered gross weight.
   */
  gvwr: Maybe<string>
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
 * The JSON Schema the model is held to. Written out, not derived, for the
 * reason `med-shape.ts` gives: it is a contract with an outside system.
 */
export const REGISTRATION_SCHEMA = {
  type: 'object',
  properties: {
    vin: field({ type: 'string' }),
    plate: field({ type: 'string' }),
    plateState: field({ type: 'string' }),
    expiresAt: field({ type: 'string' }),
    year: field({ type: 'string' }),
    make: field({ type: 'string' }),
    model: field({ type: 'string' }),
    ownerName: field({ type: 'string' }),
    gvwr: field({ type: 'string' }),
  },
  required: [
    'vin',
    'plate',
    'plateState',
    'expiresAt',
    'year',
    'make',
    'model',
    'ownerName',
    'gvwr',
  ],
  additionalProperties: false,
} as const

/** Every key the schema names, in order, for the tests and the form. */
export const REGISTRATION_FIELDS = Object.keys(
  REGISTRATION_SCHEMA.properties,
) as (keyof ExtractedRegistration)[]

/** What the nine-field contract must never grow a field for. */
export const REGISTRATION_FORBIDDEN_FIELDS: readonly string[] = [
  'address',
  'ownerAddress',
  'street',
  'city',
  'zip',
  'fees',
  'fee',
  'titleNumber',
  'jurisdictions',
  'dateOfBirth',
]
