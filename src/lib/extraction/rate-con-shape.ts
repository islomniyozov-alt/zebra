import type { EquipmentType, StopType } from '@/generated/prisma/client'
import type { Maybe } from './envelope'

// ---------------------------------------------------------------------------
// WHAT A RATE CONFIRMATION IS, AS FAR AS THIS SYSTEM CARES (Phase 5 §3 step 1).
//
// NAMED FOR ITS DOCUMENT, beside `cdl-shape.ts`. It was `extraction-shape.ts`
// while a rate confirmation was the only thing read here — "the" shape — and
// that name stopped being true the moment a second document arrived. Neither
// is the default now, and the pairing reads itself.
//
// The `{value, confidence}` envelope both shapes use went to `envelope.ts`,
// because a shared idea filed under one document's name is one nobody finds.
//
// One file, imported by the parser, the prompt builder and the tests, so the
// three cannot disagree about the shape. §1.2: "a strict JSON shape, per-field
// values WITH per-field confidence; a response that doesn't parse is a failed
// extraction, never a half-filled form."
//
// EVERY FIELD IS A `Field<T>`, not a bare value. A rate confirmation from a
// broker nobody has seen before will have fields the model is sure about (the
// BOL number printed in 14pt) and fields it is guessing at (a delivery window
// written as "Tue AM"). Collapsing those into the same shape is how a guess
// gets typed into a load and nobody knows which one it was — so confidence
// travels with the value and Step 2 marks the low ones on the form.
//
// NO MONEY IS PARSED HERE. The model reports what it read as a STRING, exactly
// as printed; `money.ts` turns it into cents in `extraction.ts`, and rule
// 9-money means that is the only place it can happen. A model that returns
// `1850.5` as a number has already made a rounding decision nobody reviewed.
// ---------------------------------------------------------------------------

export interface ExtractedStop {
  type: Maybe<StopType>
  name: Maybe<string>
  addressLine1: Maybe<string>
  addressLine2: Maybe<string>
  city: Maybe<string>
  state: Maybe<string>
  postalCode: Maybe<string>
  /** ISO-8601 local, no zone: the document says "8/12 0800", not an instant. */
  scheduledAt: Maybe<string>
  windowStart: Maybe<string>
  windowEnd: Maybe<string>
  /** PU# / DEL# — the number the facility asks for at the gate. */
  referenceNumber: Maybe<string>
  contactName: Maybe<string>
  contactPhone: Maybe<string>
  instructions: Maybe<string>
}

export interface ExtractedMoney {
  /** As PRINTED. "$1,850.00", "1850", "1,850.00 USD". Parsed in extraction.ts. */
  linehaul: Maybe<string>
  fuelSurcharge: Maybe<string>
  /** The total the broker promises to pay. Checked against the parts. */
  total: Maybe<string>
  accessorials: {
    description: Maybe<string>
    amount: Maybe<string>
  }[]
}

export interface Extracted {
  brokerName: Maybe<string>
  brokerReference: Maybe<string>
  /** BOL, PO, and whatever else the document calls a number. */
  bolNumber: Maybe<string>
  poNumber: Maybe<string>
  commodity: Maybe<string>
  weightLbs: Maybe<number>
  /**
   * Total trip mileage, WHEN THE DOCUMENT STATES IT.
   *
   * READ, NEVER COMPUTED. A Relay booking prints the trip distance on its
   * face — "320.1mi" — and a number a document states is a number this
   * contract may carry. Distance between two cities is a number this
   * contract may NOT invent: rule 1 of EXTRACTION-CONTRACT.md, and the
   * difference between reading a document and guessing about freight.
   *
   * Null on almost everything else, which is correct rather than a gap.
   */
  miles: Maybe<number>
  pieces: Maybe<number>
  pallets: Maybe<number>
  equipmentType: Maybe<EquipmentType>
  tempF: Maybe<number>
  isHazmat: Maybe<boolean>
  isTeam: Maybe<boolean>
  sealNumber: Maybe<string>
  instructions: Maybe<string>
  stops: ExtractedStop[]
  money: ExtractedMoney
}

/**
 * The JSON Schema the model is held to.
 *
 * Written out rather than derived from the types, because it is the CONTRACT
 * with an outside system and a derivation would let a TypeScript refactor
 * silently change what the model is asked for. `tests/extraction.test.ts`
 * asserts the two agree field for field, which is the check a derivation would
 * have made unnecessary and a comment would not have made at all.
 */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'brokerName',
    'brokerReference',
    'bolNumber',
    'poNumber',
    'commodity',
    'weightLbs',
    'miles',
    'pieces',
    'pallets',
    'equipmentType',
    'tempF',
    'isHazmat',
    'isTeam',
    'sealNumber',
    'instructions',
    'stops',
    'money',
  ],
  properties: {
    brokerName: field('string'),
    brokerReference: field('string'),
    bolNumber: field('string'),
    poNumber: field('string'),
    commodity: field('string'),
    weightLbs: field('number'),
    miles: field('number'),
    pieces: field('number'),
    pallets: field('number'),
    equipmentType: field('string', [
      'DRY_VAN',
      'REEFER',
      'FLATBED',
      'STEP_DECK',
      'POWER_ONLY',
      'TANKER',
      'CONTAINER',
      'OTHER',
    ]),
    tempF: field('number'),
    isHazmat: field('boolean'),
    isTeam: field('boolean'),
    sealNumber: field('string'),
    instructions: field('string'),
    stops: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'type',
          'name',
          'addressLine1',
          'addressLine2',
          'city',
          'state',
          'postalCode',
          'scheduledAt',
          'windowStart',
          'windowEnd',
          'referenceNumber',
          'contactName',
          'contactPhone',
          'instructions',
        ],
        properties: {
          type: field('string', ['PICKUP', 'DELIVERY']),
          name: field('string'),
          addressLine1: field('string'),
          addressLine2: field('string'),
          city: field('string'),
          state: field('string'),
          postalCode: field('string'),
          scheduledAt: field('string'),
          windowStart: field('string'),
          windowEnd: field('string'),
          referenceNumber: field('string'),
          contactName: field('string'),
          contactPhone: field('string'),
          instructions: field('string'),
        },
      },
    },
    money: {
      type: 'object',
      additionalProperties: false,
      required: ['linehaul', 'fuelSurcharge', 'total', 'accessorials'],
      properties: {
        // STRINGS. The model reports what is printed; money.ts decides what it
        // means in cents. See the note at the top of this file.
        linehaul: field('string'),
        fuelSurcharge: field('string'),
        total: field('string'),
        accessorials: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['description', 'amount'],
            properties: {
              description: field('string'),
              amount: field('string'),
            },
          },
        },
      },
    },
  },
} as const

/** `{ value, confidence, note } | null` — the one shape every field takes. */
function field(type: 'string' | 'number' | 'boolean', options?: string[]) {
  return {
    // Nullable at the top: a field the document does not carry is absent, and
    // "" or 0 would be a value somebody has to notice is wrong.
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['value', 'confidence'],
    properties: {
      value: options ? { type, enum: options } : { type },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      note: { type: 'string' },
    },
  }
}

/** Every top-level field name, for the tests and the accuracy table (§5). */
export const EXTRACTED_FIELDS = Object.keys(
  EXTRACTION_SCHEMA.properties,
) as (keyof Extracted)[]

export const STOP_FIELDS = Object.keys(
  EXTRACTION_SCHEMA.properties.stops.items.properties,
) as (keyof ExtractedStop)[]
