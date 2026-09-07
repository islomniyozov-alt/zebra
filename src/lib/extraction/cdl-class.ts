// ---------------------------------------------------------------------------
// WHAT THE CARD PRINTS AT FIELD 9, AND WHAT THIS SYSTEM OPERATES ON.
//
// TWO DIFFERENT QUESTIONS, AND CONFLATING THEM COST A SILENT DOWNGRADE.
//
// The schema used to declare `class` as `enum: ['A','B','C']` and the prompt
// used to say `9 class (A, B or C)`. A Georgia card printing `CLASS AM` came
// back as `"A"` with `confidence: "high"` — the model was told the answer had
// to be one of three, so it made it one of three by dropping the M. The parser
// never saw `AM`, so its `bad_enum` refusal never fired.
//
// THE REFUSAL WAS UNREACHABLE, WHICH IS WORSE THAN ABSENT. An absent check
// fails openly the first time somebody looks. A check that cannot be reached
// reports success, and the value it was guarding arrives stamped `high`.
//
// SO THE MODEL IS NO LONGER TOLD THE ANSWER. `class` is a free string, the
// prompt asks for it exactly as printed, and the judgement — what does `AM`
// mean operationally — happens HERE, in a table somebody can read and argue
// with, on a value that survives the trip.
//
// THE TABLE IS STATED, NEVER DERIVED. No prefix rule, no "first character
// wins", no stripping of trailing letters. Those all happen to produce A from
// AM and would also produce A from something nobody has thought about — which
// is the same silent-conformance failure moved from the model into our code.
// A class that is not written below refuses and says what it read.
// ---------------------------------------------------------------------------

/** The commercial classes this system understands operationally. */
export type OperationalClass = 'A' | 'B' | 'C'

/**
 * Printed class, exactly as the card shows it, to what it means for driving.
 *
 * `AM`, `BM`, `CM` are a commercial class plus a motorcycle qualifier — the M
 * says the holder may also ride a motorcycle and says nothing about what they
 * may drive for this carrier. Mapping it away is a judgement, which is why it
 * is written here rather than performed silently by a model that was never
 * told what the M was for.
 *
 * ADDING A ROW IS A DECISION, and it belongs to whoever knows what the code
 * means on that state's card. A code guessed at here is a driver filed under a
 * class they do not hold.
 */
export const CLASS_MAP: Readonly<Record<string, OperationalClass>> = {
  A: 'A',
  B: 'B',
  C: 'C',
  AM: 'A',
  BM: 'B',
  CM: 'C',
}

/**
 * The operational class for a printed one, or null if the table does not know.
 *
 * Case and surrounding space are normalised because those are TRANSCRIPTION
 * noise — `a` and `A ` are the same printed character. Nothing else is: the
 * letters themselves are never added to, removed from, or reordered.
 */
export function operationalClass(
  printed: string | null | undefined,
): OperationalClass | null {
  const key = (printed ?? '').trim().toUpperCase()
  if (key === '') return null
  return CLASS_MAP[key] ?? null
}
