import type { Maybe } from './envelope'

// ---------------------------------------------------------------------------
// THE ANNUAL DOT INSPECTION, HEADER ONLY (TMS §7.8, v11.47; owner's ruling
// 2026-11-23).
//
// The periodic inspection of 49 CFR 396.17, recorded on a form whose printed
// layout varies by vendor but whose header always carries the same few facts.
// The first sample (`corpus/islom-2026-11-23/Annual-DOT-Inspection-02.18.26.jpg`)
// is a "Vehicle History Record" block: report number, fleet unit number, date,
// the inspector's name, and the vehicle's identification.
//
// ── SEVEN FIELDS, ALL TRANSCRIBED ────────────────────────────────────────
//
// Every value is a free string as printed. The date is converted after the
// reader by `us-dates.ts`; the VIN is checked by `vin.ts`; the result is
// accepted only when it says passed or failed in so many words. None of that
// is asked of the model, because a model asked for ISO or for a valid VIN will
// produce one.
//
// ── NO PER-ITEM CHECKLIST, AND THAT IS ASSERTED ───────────────────────────
//
// The form's body lists brakes, lights, tires and the rest, each OK or needs
// repair. The owner ruled header fields only. `tests/inspection-reader.test.ts`
// checks every name in `INSPECTION_FORBIDDEN_FIELDS` against the schema, the
// type and the prompt, so growing one is a failure that names it.
// ---------------------------------------------------------------------------

export interface ExtractedAnnualInspection {
  /** The report or inspection number, character for character. */
  reportNumber: Maybe<string>
  /** The inspection date exactly as printed. Converted by `parseUsDate`. */
  inspectionDate: Maybe<string>
  /** The fleet unit number as written. Proposes the truck; never decides it. */
  fleetUnit: Maybe<string>
  /** The VIN as written. Checked, never corrected. */
  vin: Maybe<string>
  /** The inspector's printed name. */
  inspectorName: Maybe<string>
  /** The inspecting agency, shop or location, if the form names one. */
  agency: Maybe<string>
  /**
   * What the form says about the outcome, as printed — a ticked "passed",
   * "THIS VEHICLE HAS PASSED", "failed". Read as passed or failed only when it
   * says so in words; anything else is unreadable.
   */
  result: Maybe<string>
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
 * `additionalProperties: false` is what makes a volunteered checklist a schema
 * violation rather than an extra key nobody notices.
 */
export const ANNUAL_INSPECTION_SCHEMA = {
  type: 'object',
  properties: {
    reportNumber: field({ type: 'string' }),
    inspectionDate: field({ type: 'string' }),
    fleetUnit: field({ type: 'string' }),
    vin: field({ type: 'string' }),
    inspectorName: field({ type: 'string' }),
    agency: field({ type: 'string' }),
    result: field({ type: 'string' }),
  },
  required: [
    'reportNumber',
    'inspectionDate',
    'fleetUnit',
    'vin',
    'inspectorName',
    'agency',
    'result',
  ],
  additionalProperties: false,
} as const

/** Every key the schema names, in order, for the tests and the form. */
export const ANNUAL_INSPECTION_FIELDS = Object.keys(
  ANNUAL_INSPECTION_SCHEMA.properties,
) as (keyof ExtractedAnnualInspection)[]

/** What the header-only contract must never grow a field for. */
export const INSPECTION_FORBIDDEN_FIELDS: readonly string[] = [
  'items',
  'checklist',
  'components',
  'defects',
  'brakes',
  'tires',
  'lights',
  'steering',
  'repairs',
  'repairedDate',
  'needsRepair',
]
