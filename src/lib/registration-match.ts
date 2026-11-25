import { sameVin } from './extraction/vin'
import type { RegistrationVerdicts } from './extraction/registration-fields'

// ---------------------------------------------------------------------------
// WHICH TRUCK A CAB CARD DROPPED ON THE SAFETY INTAKE BELONGS TO (TMS §7.8,
// v11.57; owner's ruling 2026-11-25).
//
// A WRITTEN ORDER — VIN, THEN UNIT NUMBER, THEN PLATE — and every rule an
// EXACT match. The VIN is the one identifier a truck cannot share, so it goes
// first; the unit number is the office's own name for the truck; the plate
// last, because plates move between trucks. The first rule that finds exactly
// one truck proposes it. Two on the same rule propose NONE and stop: a lower
// rule must not break a tie a higher one could not, or a shared plate would
// pick between two trucks with the same unit number.
//
// It PROPOSES; a person confirms on the screen. Nearest-match is refused for
// the reason `matchTruck` (the inspection's) gives — a wrong truck is a wrong
// legal record.
// ---------------------------------------------------------------------------

export interface RegistrationTruckCandidate {
  id: string
  unitNumber: string
  vin: string | null
  plate: string | null
  plateState: string | null
}

export type RegistrationTruckMatch =
  | {
      kind: 'one'
      truck: RegistrationTruckCandidate
      by: 'vin' | 'unit' | 'plate'
    }
  | {
      kind: 'several'
      trucks: RegistrationTruckCandidate[]
      by: 'vin' | 'unit' | 'plate'
    }
  | { kind: 'none' }

const fold = (text: string) => text.trim().toUpperCase()
const plateKey = (text: string) => text.toUpperCase().replace(/[\s-]+/g, '')

export function matchRegistrationTruck(
  verdicts: RegistrationVerdicts,
  trucks: readonly RegistrationTruckCandidate[],
): RegistrationTruckMatch {
  const decide = (
    found: RegistrationTruckCandidate[],
    by: 'vin' | 'unit' | 'plate',
  ): RegistrationTruckMatch | null =>
    found.length === 1
      ? { kind: 'one', truck: found[0]!, by }
      : found.length > 1
        ? { kind: 'several', trucks: found, by }
        : null

  if (verdicts.vin.read) {
    const vin = verdicts.vin.value
    const hit = decide(
      trucks.filter((truck) => sameVin(truck.vin, vin)),
      'vin',
    )
    if (hit) return hit
  }
  if (verdicts.unitNumber.read) {
    const unit = fold(verdicts.unitNumber.value)
    const hit = decide(
      trucks.filter((truck) => fold(truck.unitNumber) === unit),
      'unit',
    )
    if (hit) return hit
  }
  if (verdicts.plate.read) {
    const plate = plateKey(verdicts.plate.value)
    const state = verdicts.plateState.read ? verdicts.plateState.value : null
    const hit = decide(
      trucks.filter(
        (truck) =>
          truck.plate !== null &&
          plate !== '' &&
          plateKey(truck.plate) === plate &&
          // Both sides carry a state: they must agree. Either side blank:
          // the plate alone decides, still exactly.
          (state === null ||
            truck.plateState === null ||
            fold(truck.plateState) === state),
      ),
      'plate',
    )
    if (hit) return hit
  }
  return { kind: 'none' }
}
