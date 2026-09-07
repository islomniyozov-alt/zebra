// ---------------------------------------------------------------------------
// CODES THIS SYSTEM RECOGNISES — A VALIDATION, NEVER AN ENUM.
//
// ── THE DISTINCTION IS THE WHOLE FILE, AND IT IS NOT PEDANTRY ─────────────
//
// An ENUM in the JSON Schema tells the model what answers exist, and the model
// obliges. That is exactly how a Georgia card printing `CLASS AM` came back as
// `"A"` at high confidence: told there were three classes, it produced one of
// three, and the `bad_enum` refusal written for that case could never fire
// because the offending value was destroyed upstream. See `cdl-class.ts`.
//
// A VALIDATION runs AFTERWARDS, on whatever the card actually said. It cannot
// change what was read; it can only say "this is not a code I know" and put
// that in front of a dispatcher. The model is never told the list.
//
// SO NOTHING HERE IS EVER USED TO CORRECT A READING. Not to snap `5` to `S`,
// not to drop an unknown code, not to reorder anything. `recognised: false` is
// a flag on a value that is carried through unchanged.
//
// ── UNRECOGNISED IS NOT INVALID ───────────────────────────────────────────
//
// The federal codes are below; states add their own and change them. A code
// missing from this list means THIS LIST does not know it — which is worth
// showing somebody, and is not evidence the card is wrong. The wording on the
// screen has to carry that distinction or the flag becomes an accusation.
// ---------------------------------------------------------------------------

/**
 * Federal endorsement codes (AAMVA `9a`).
 *
 * H hazardous materials · N tank vehicle · P passenger · S school bus ·
 * T double/triple trailers · X tank + hazmat combined.
 */
export const KNOWN_ENDORSEMENTS: readonly string[] = [
  'H',
  'N',
  'P',
  'S',
  'T',
  'X',
]

/**
 * Federal restriction codes (AAMVA `12`).
 *
 * L no air brakes · Z no full air brakes · E no manual transmission ·
 * O no tractor-trailer · M no Class A passenger · N no Class A/B passenger ·
 * V medical variance · K intrastate only.
 *
 * THE MEASURED CASE THAT MOTIVATED THIS. Ten runs of one card returned five
 * different first codes: `A`, `B`, `E`, `O`, `5`. Three of those (`E`, `O`,
 * `M`) are real restrictions and three (`A`, `B`, `5`) are not — so a
 * recognition check separates a plausible misreading from an impossible one,
 * which is information a dispatcher can act on. It does not say which is
 * right, and it must never pick.
 */
export const KNOWN_RESTRICTIONS: readonly string[] = [
  'L',
  'Z',
  'E',
  'O',
  'M',
  'N',
  'V',
  'K',
]

export type CodeKind = 'endorsement' | 'restriction'

/** Whether a code is one this system knows. Never used to change a value. */
export function isKnownCode(kind: CodeKind, code: string): boolean {
  const known = kind === 'endorsement' ? KNOWN_ENDORSEMENTS : KNOWN_RESTRICTIONS
  return known.includes(code.trim().toUpperCase())
}
