import { asString, readField, type Json } from './envelope-parse'
import { ExtractionParseError, parseResponseText } from './parse'
import type { CoverageReading, ExtractedCoi, VehicleReading } from './coi-shape'

// ---------------------------------------------------------------------------
// PARSING WHAT THE MODEL SAID ABOUT A CERTIFICATE OF INSURANCE.
//
// THE ENVELOPE READERS ARE THE CDL'S, from `envelope-parse.ts`. Nothing about
// reading `{value, confidence}` is document-specific, and a second copy would
// be a second set of rules about when a value counts as measured.
//
// EVERY CELL IS A PLAIN STRING, INCLUDING THE DATES AND THE LIMITS. The dates
// arrive as the certificate prints them and `us-dates.ts` converts under a
// stated rule. The limits arrive as printed too — and on the first real
// certificate the physical-damage row's "limit" is a pair of deductibles,
// which is the whole reason this contract does not ask for a number.
//
// ── THE LISTS ARE NOT WRAPPED, AND THAT IS THE POINT ─────────────────────
//
// `coverages` and `vehicles` are arrays of OBJECTS OF ENVELOPES, not
// `Field<Coverage[]>`. Confidence lives on each cell — see `coi-shape.ts` for
// the certificate that forced it, and `cdl-shape.ts` for the ten runs that
// established the pattern.
// ---------------------------------------------------------------------------

/**
 * One element of a list, read cell by cell.
 *
 * A BARE STRING WHERE AN OBJECT BELONGS IS REFUSED, not promoted. Inventing a
 * confidence here is exactly the failure per-element envelopes exist to end,
 * and by the time the refusal rules weigh it an invented `high` looks like a
 * measured one.
 */
function readRow<T>(
  raw: unknown,
  where: string,
  cells: readonly string[],
  build: (row: Json, at: string) => T,
): T {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ExtractionParseError('bad_field_shape', where)
  }
  const row = raw as Json
  for (const cell of cells) {
    if (!Object.hasOwn(row, cell)) {
      throw new ExtractionParseError('missing_field', `${where}.${cell}`)
    }
  }
  return build(row, where)
}

/** An array of rows, or null. Anything else refuses. */
function readList<T>(
  parent: Json,
  key: string,
  read: (raw: unknown, where: string) => T,
): T[] | null {
  const at = `$.${key}`
  if (!Object.hasOwn(parent, key)) {
    throw new ExtractionParseError('missing_field', at)
  }
  const raw = parent[key]
  if (raw === null || raw === undefined) return null
  if (!Array.isArray(raw)) throw new ExtractionParseError('bad_value_type', at)
  return raw.map((entry, index) => read(entry, `${at}[${index}]`))
}

const COVERAGE_CELLS = [
  'type',
  'insurer',
  'policyNumber',
  'effectiveAt',
  'expiresAt',
  'limit',
] as const

const VEHICLE_CELLS = ['vin', 'description'] as const

export function parseCoiResponse(text: string): ExtractedCoi {
  const root = parseResponseText(text) as Json

  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new ExtractionParseError('not_an_object', '$')
  }

  return {
    insuredName: readField(root, 'insuredName', asString),
    insuredMc: readField(root, 'insuredMc', asString),
    insuredDot: readField(root, 'insuredDot', asString),
    coverages: readList(root, 'coverages', (raw, where) =>
      readRow<CoverageReading>(raw, where, COVERAGE_CELLS, (row, at) => ({
        type: readField(row, 'type', asString, at),
        insurer: readField(row, 'insurer', asString, at),
        policyNumber: readField(row, 'policyNumber', asString, at),
        effectiveAt: readField(row, 'effectiveAt', asString, at),
        expiresAt: readField(row, 'expiresAt', asString, at),
        limit: readField(row, 'limit', asString, at),
      })),
    ),
    vehicles: readList(root, 'vehicles', (raw, where) =>
      readRow<VehicleReading>(raw, where, VEHICLE_CELLS, (row, at) => ({
        vin: readField(row, 'vin', asString, at),
        description: readField(row, 'description', asString, at),
      })),
    ),
  }
}
