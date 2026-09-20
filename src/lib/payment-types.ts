// ---------------------------------------------------------------------------
// HOW A LOAD IS BILLED AND PAID FOR — FOUR CODES, IN A LIST, NOT AN ENUM.
//
// Owner's ruling: TEXT validated against a code list, never a Postgres enum.
// Same reasoning as the deduction type — the vocabulary lives here, where
// adding a fifth arrangement is an edit somebody can read and review, rather
// than a migration, a deploy and a conversation about locking a table that
// holds 14,464 rows.
//
// ── IT IS A LABEL, NOT A SWITCH ──────────────────────────────────────────
//
// `Load.isFactored` still drives AR behaviour and is still what every query
// reads. This says what the desk agreed, which is the thing a person needs on
// a receivables list and cannot infer from a boolean: FACTORED and ACH are not
// opposites, and a factored load may well settle by ACH.
//
// ── AND IT IS NOT `PaymentMethod` ────────────────────────────────────────
//
// That enum is how money physically moves — cheque, wire, Zelle. The two
// overlap on ACH and mean different things, which is exactly why this is a
// separate vocabulary rather than three more members bolted onto that one.
//
// ── THIS LIST DOES REFUSE, UNLIKE THE DEDUCTION LIST ─────────────────────
//
// `deduction-types.ts` is explicitly "a list, never a closed set": it exists
// to offer labels and never to reject one, because `Other` plus a typed
// description is how a new kind of charge arrives. This one validates, by
// ruling — four arrangements, and a fifth is a decision somebody makes in this
// file rather than a string that appears in a column one afternoon.
// ---------------------------------------------------------------------------

/** The four arrangements, spelled as they are shown. */
export const PAYMENT_TYPES = ['Quickpay', 'Factored', 'ACH', 'Direct'] as const

export type PaymentType = (typeof PAYMENT_TYPES)[number]

/**
 * Is this one of the four?
 *
 * Null and empty are NOT payment types and are not errors either — a load
 * booked before anybody decided simply has none, which is why every column
 * holding one is nullable.
 */
export function isPaymentType(value: unknown): value is PaymentType {
  return (
    typeof value === 'string' &&
    (PAYMENT_TYPES as readonly string[]).includes(value)
  )
}

/**
 * Normalise what arrived, or refuse it.
 *
 * Returns null for absent — a load with no arrangement recorded — and throws
 * for a value that is present and not one of the four. The distinction is the
 * point: silence is allowed, nonsense is not. A column that quietly accepted
 * "quickpay " would split a receivables list in two without anybody seeing it.
 */
export function readPaymentType(value: unknown): PaymentType | null {
  if (value === null || value === undefined || value === '') return null

  // TRIMMED, THEN MATCHED EXACTLY. Case is not normalised on purpose: "ACH"
  // and "Ach" are the same arrangement but only one of them is the spelling
  // this system shows, and accepting both is how two spellings end up in one
  // column. A form that sends the wrong case has a bug worth seeing.
  const text = typeof value === 'string' ? value.trim() : value
  if (!isPaymentType(text)) {
    throw new TypeError(
      `${JSON.stringify(value)} is not a payment type. Expected one of: ${PAYMENT_TYPES.join(', ')}.`,
    )
  }
  return text
}
