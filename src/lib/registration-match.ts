import { sameVin } from './extraction/vin'
import type { RegistrationVerdicts } from './extraction/registration-fields'

// ---------------------------------------------------------------------------
// WHICH UNIT A CAB CARD DROPPED ON THE SAFETY INTAKE BELONGS TO (TMS §7.8,
// v11.57 trucks, v11.58 trailers; owner's rulings 2026-11-25).
//
// A WRITTEN ORDER — VIN, THEN UNIT NUMBER, THEN PLATE — and every rule an
// EXACT match, over the trucks AND the trailers together. The VIN is the one
// identifier a unit cannot share, so it goes first; the unit number is the
// office's own name for it; the plate last, because plates move. The first
// rule that finds exactly one unit proposes it, whichever kind it is. Two on
// the same rule propose NONE and stop: a lower rule must not break a tie a
// higher one could not — and truck 524 beside trailer 524 is such a tie.
//
// It PROPOSES; a person confirms on the screen. Nearest-match is refused for
// the reason `matchTruck` (the inspection's) gives — a wrong unit is a wrong
// legal record.
// ---------------------------------------------------------------------------

export type UnitKind = 'truck' | 'trailer'

export interface RegistrationUnitCandidate {
  kind: UnitKind
  id: string
  unitNumber: string
  vin: string | null
  plate: string | null
  plateState: string | null
}

export type MatchRule = 'vin' | 'unit' | 'plate'

export type RegistrationUnitMatch =
  | { kind: 'one'; unit: RegistrationUnitCandidate; by: MatchRule }
  | { kind: 'several'; units: RegistrationUnitCandidate[]; by: MatchRule }
  | { kind: 'none' }

const fold = (text: string) => text.trim().toUpperCase()
const plateKey = (text: string) => text.toUpperCase().replace(/[\s-]+/g, '')

/** The value the confirm step's select posts: `truck:<id>` or `trailer:<id>`. */
export const unitKey = (unit: { kind: UnitKind; id: string }) =>
  `${unit.kind}:${unit.id}`

/** The select's value back to a subject, or null when it is neither kind. */
export function readUnitKey(
  value: string,
): { kind: UnitKind; id: string } | null {
  const match = /^(truck|trailer):(\S+)$/.exec(value.trim())
  return match ? { kind: match[1] as UnitKind, id: match[2]! } : null
}

export function matchRegistrationUnit(
  verdicts: RegistrationVerdicts,
  units: readonly RegistrationUnitCandidate[],
): RegistrationUnitMatch {
  const decide = (
    found: RegistrationUnitCandidate[],
    by: MatchRule,
  ): RegistrationUnitMatch | null =>
    found.length === 1
      ? { kind: 'one', unit: found[0]!, by }
      : found.length > 1
        ? { kind: 'several', units: found, by }
        : null

  if (verdicts.vin.read) {
    const vin = verdicts.vin.value
    const hit = decide(
      units.filter((unit) => sameVin(unit.vin, vin)),
      'vin',
    )
    if (hit) return hit
  }
  if (verdicts.unitNumber.read) {
    const number = fold(verdicts.unitNumber.value)
    const hit = decide(
      units.filter((unit) => fold(unit.unitNumber) === number),
      'unit',
    )
    if (hit) return hit
  }
  if (verdicts.plate.read) {
    const plate = plateKey(verdicts.plate.value)
    const state = verdicts.plateState.read ? verdicts.plateState.value : null
    const hit = decide(
      units.filter(
        (unit) =>
          unit.plate !== null &&
          plate !== '' &&
          plateKey(unit.plate) === plate &&
          // Both sides carry a state: they must agree. Either side blank:
          // the plate alone decides, still exactly.
          (state === null ||
            unit.plateState === null ||
            fold(unit.plateState) === state),
      ),
      'plate',
    )
    if (hit) return hit
  }
  return { kind: 'none' }
}

/**
 * THE CARD'S TYPE CODES THAT MEAN A TRAILER (v11.58). A written list; any
 * other code, or none, is a truck — the default the owner named.
 *
 * TT IS NOT HERE, AND THAT IS FLAGGED. The ruling listed it with the trailer
 * codes, but the first real card — truck 524, a Volvo tractor — prints TYPE
 * TT, the IRP truck-tractor code. Reading it as a trailer would send every
 * tractor's card to Add trailer.
 */
export const TRAILER_TYPE_CODES: readonly string[] = [
  'SE',
  'ST',
  'SEMI',
  'SEMITRAILER',
  'SM',
  'TL',
  'TLR',
  'TRL',
  'TRLR',
  'TRAILER',
  'FT',
]

/** Which Add form "add it" opens, from the card's type. */
export function addFormFor(verdicts: RegistrationVerdicts): UnitKind {
  if (!verdicts.vehicleType.read) return 'truck'
  const code = verdicts.vehicleType.value.toUpperCase().replace(/[^A-Z]/g, '')
  return TRAILER_TYPE_CODES.includes(code) ? 'trailer' : 'truck'
}
