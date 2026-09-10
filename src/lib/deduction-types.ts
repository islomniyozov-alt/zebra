// ---------------------------------------------------------------------------
// THE DEDUCTION LABELS THIS SYSTEM KNOWS — A LIST, NEVER A CLOSED SET.
//
// Same posture as `cdl-codes.ts` and for the same reason: this is what the
// SIX real statements printed, offered to whoever is filling a form. It is not
// a validation and nothing refuses a label that is missing from it.
//
// `Other` IS THE ESCAPE HATCH AND THE WHOLE POINT. Adding a kind of charge is
// choosing it and typing a description — never a migration, never a deploy.
// That is what the original "no deduction type enum" ruling was protecting,
// and it survives intact even though the artefact turned out to print a type
// column after all.
//
// TWO OF THESE CARRY BEHAVIOUR and the rest are labels: `Escrow` has a target
// and a held balance, `Fuel` takes its figure from the transaction import.
// `deductions.ts` branches on exactly those two strings and on nothing else.
// ---------------------------------------------------------------------------

/** Every type the six statements in `corpus/datatruck` printed. */
export const KNOWN_DEDUCTION_TYPES = [
  'Fuel',
  'Insurance',
  'Ifta',
  'Admin Fee',
  'Tolls',
  'Other',
  'Escrow',
] as const

export type KnownDeductionType = (typeof KNOWN_DEDUCTION_TYPES)[number]

/** The two the engine branches on. Named so the branch is greppable. */
export const BEHAVIOURAL_DEDUCTION_TYPES = ['Escrow', 'Fuel'] as const

/**
 * Is this a label this system has seen before?
 *
 * NEVER USED TO REFUSE. It exists so a screen can say "this is a new kind of
 * charge" beside a value somebody typed, the way `cdl-codes.ts` flags an
 * unrecognised endorsement without touching it.
 */
export const isKnownDeductionType = (type: string): boolean =>
  (KNOWN_DEDUCTION_TYPES as readonly string[]).includes(type)
