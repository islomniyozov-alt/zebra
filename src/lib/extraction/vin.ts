// ---------------------------------------------------------------------------
// A VIN THIS SYSTEM READ OFF A DOCUMENT — CHECKED, NEVER CORRECTED.
//
// ── WHY A CHECK DIGIT IS WORTH THE FILE ───────────────────────────────────
//
// A VIN is 17 characters of which one is a checksum over the other sixteen
// (ISO 3779, mandatory in North America since 1981). That makes it the rare
// field where a misread character is DETECTABLE: swap the `0` in `…MM0761` for
// an `O` and the sum stops agreeing with itself.
//
// Every other transcription in this codebase can only be believed or doubted.
// This one can be tested — and a VIN is exactly the field where an undetected
// misread is expensive, because it becomes the key that joins a certificate to
// a truck, and a wrong key joins it to the wrong truck or to none.
//
// ── IT NEVER CORRECTS, AND THE MODEL IS NEVER TOLD THE RULE ──────────────
//
// The `cdl-codes.ts` rule, which this file follows exactly. Nothing here snaps
// an `O` to a `0` or a `I` to a `1`: a corrected VIN is indistinguishable from
// a read one by the time anything downstream looks at it, and the correction
// would be this file guessing which of two plausible characters the document
// printed. It reports `check_digit` and a person looks at the certificate.
//
// The prompt likewise does not mention that I, O and Q are excluded from the
// alphabet. Told the rule, a model applies the rule — and a VIN that comes
// back clean because the model fixed it is worse than one that comes back
// wrong, because nothing downstream can tell.
//
// ── AN OLD VIN IS NOT AN INVALID ONE ──────────────────────────────────────
//
// Vehicles built before 1981, and some trailers and imports, carry VINs that
// are shorter or that fail the North American check digit legitimately. So a
// failure here is a FLAG ON A VALUE THAT IS CARRIED THROUGH UNCHANGED, in the
// wording `cdl-codes.ts` uses: "not a VIN this check recognises", never "not a
// VIN". A tractor on an ACORD certificate will be a modern one; the wording
// still has to carry the distinction, or the flag becomes an accusation.
// ---------------------------------------------------------------------------

/** Position values for the check-digit sum. I, O and Q are not in the alphabet. */
const VALUES: Record<string, number> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
}

/** ISO 3779 positional weights. Position 9 is the check digit and weighs nothing. */
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

export type VinCheck =
  | { ok: true; vin: string }
  | {
      ok: false
      /** The VIN as read, upper-cased and de-spaced. Carried through unchanged. */
      vin: string
      reason: 'wrong_length' | 'illegal_character' | 'check_digit'
    }

/**
 * Whether a string is a VIN this check recognises.
 *
 * NORMALISATION IS WHITESPACE AND CASE ONLY. Certificates print `VIN:
 * 3AKJ HHDV6 MSMM0761` and lower case happens; neither changes which vehicle
 * is meant. Nothing else is touched — see the header.
 */
export function checkVin(raw: string | null | undefined): VinCheck | null {
  if (!raw) return null
  const vin = raw
    .toUpperCase()
    .replace(/^VIN[:# ]*/, '')
    .replace(/[\s-]/g, '')
  if (vin === '') return null

  if (vin.length !== 17) return { ok: false, vin, reason: 'wrong_length' }

  let sum = 0
  for (let i = 0; i < 17; i++) {
    const value = VALUES[vin[i]!]
    // I, O and Q are not in the VIN alphabet, and neither is anything else
    // outside it. A VIN carrying one was misread, or is not a VIN.
    if (value === undefined) {
      return { ok: false, vin, reason: 'illegal_character' }
    }
    sum += value * WEIGHTS[i]!
  }

  const remainder = sum % 11
  const expected = remainder === 10 ? 'X' : String(remainder)
  if (vin[8] !== expected) return { ok: false, vin, reason: 'check_digit' }

  return { ok: true, vin }
}

/** Two VINs, compared the way this file normalises them. */
export const sameVin = (a: string | null, b: string | null): boolean => {
  if (!a || !b) return false
  const fold = (text: string) => text.toUpperCase().replace(/[\s-]/g, '')
  return fold(a) === fold(b)
}
