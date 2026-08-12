// ---------------------------------------------------------------------------
// DATES A DISPATCHER CAN TYPE.
//
// `<input type="date">` looks like the right control and is wrong for this
// form. It holds THREE internal segments — month, day, year — and Tab moves
// between them, so one date costs three tab stops and two dates cost six.
// §9's tab order lists "dates" as one step, and the forty-second measurement
// found the difference the hard way: every keystroke after the first date
// landed in the wrong field, and the load saved with a delivery date in the
// year 1.
//
// So the fields are text, and this parses what a dispatcher actually types:
//
//   810        → the 10th of August, this year
//   8/10       → same
//   08/10/26   → same
//   08/10/2026 → same
//   2026-08-10 → same
//
// Two-digit years resolve to 2000+, which is wrong in 2100 and right for the
// next seventy-four years. The alternative is refusing them, and refusing
// what somebody just typed correctly is worse than a bounded assumption.
// ---------------------------------------------------------------------------

/** Parse a typed date to `yyyy-mm-dd`, or null if it is not one. */
export function normalizeTypedDate(
  typed: string,
  today: Date = new Date(),
): string | null {
  const text = typed.trim()
  if (text === '') return null

  // Already ISO.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (iso) return valid(+iso[1]!, +iso[2]!, +iso[3]!)

  const digits = text.replace(/\D/g, '')
  const year = today.getUTCFullYear()

  // mmdd — the shortest useful form, and the one worth optimising for.
  if (digits.length === 3 || digits.length === 4) {
    const month = Number(digits.slice(0, digits.length - 2))
    const day = Number(digits.slice(-2))
    return valid(year, month, day)
  }

  // mmddyy
  if (digits.length === 6) {
    return valid(
      2000 + Number(digits.slice(4, 6)),
      Number(digits.slice(0, 2)),
      Number(digits.slice(2, 4)),
    )
  }

  // mmddyyyy
  if (digits.length === 8) {
    return valid(
      Number(digits.slice(4, 8)),
      Number(digits.slice(0, 2)),
      Number(digits.slice(2, 4)),
    )
  }

  return null
}

function valid(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (year < 2000 || year > 2100) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  // Rejects the 31st of February rather than rolling it into March.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null

  return date.toISOString().slice(0, 10)
}

/** `yyyy-mm-dd` at UTC midnight. Date-only fields carry no timezone (§8). */
export function utcMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`)
}

/**
 * A typed time, normalised to `HH:MM` — or null.
 *
 * The same bargain `normalizeTypedDate` makes, for the same reason: a
 * dispatcher on the phone types `8`, `800` or `8:00` and means eight in the
 * morning, and a control that demands `08:00` costs the keystrokes §9 counts.
 *
 * 24-HOUR ONLY, and no am/pm. Every appointment on every document in the
 * corpus is printed 24-hour (`0800-1600`, `Appt: 02/12/2026 11:00`), the
 * driver's ELD is 24-hour, and a `7` that could mean seven in the evening is
 * the ambiguity this field exists to remove. `7` is 07:00; somebody who means
 * the evening types `19`.
 */
export function normalizeTypedTime(typed: string): string | null {
  const text = typed.trim()
  if (text === '') return null

  const digits = text.replace(/\D/g, '')
  if (digits.length === 0 || digits.length > 4) return null

  // 8 -> 08:00, 19 -> 19:00, 830 -> 08:30, 1830 -> 18:30
  const hour =
    digits.length <= 2
      ? Number(digits)
      : Number(digits.slice(0, digits.length - 2))
  const minute = digits.length <= 2 ? 0 : Number(digits.slice(-2))

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
