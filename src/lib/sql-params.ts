// ---------------------------------------------------------------------------
// BINDING AN INSTANT TO A `timestamp` COLUMN THAT HAS NO TIME ZONE.
//
// ── THE BUG THIS EXISTS BECAUSE OF ────────────────────────────────────────
//
// Every `occurredAt` in this schema is `TIMESTAMP(3)` — WITHOUT time zone — and
// Prisma writes UTC instants into it. That is consistent and fine until a script
// reaches for `pg` directly, because node-postgres serialises a JS `Date` in the
// PROCESS'S LOCAL ZONE. The parameter becomes a wall-clock string four or five
// hours away from the instant you meant, and Postgres compares it against
// columns written in UTC.
//
// On 2026-09-25 `settlement-week-preflight.ts` reported 177 loads reaching
// POD_RECEIVED in the week 2026-09-13..19. The real number was 181. Its window
// ended at 2026-09-19T19:59:59.999Z instead of 23:59:59.999Z, on a UTC-4
// machine, and the four loads delivered in that gap were invisible to the gate
// that exists to say whether the week is clear.
//
// THE FAILURE IS WORSE THAN A WRONG COUNT. It is machine-dependent: the same
// command on a laptop in another zone drops a different number of loads, and in
// UTC it drops none — so it passes for whoever writes it and fails for whoever
// runs it. And it fails at the END of the period, which is exactly where a
// week's freight clusters.
//
// ── THE FIX IS A STRING, NOT A DATE ───────────────────────────────────────
//
// Format the UTC components as the naive string Postgres will read literally.
// No zone conversion can then happen, because there is no zone left to convert.
// ---------------------------------------------------------------------------

/**
 * A UTC instant as the naive `timestamp` string Postgres will read literally.
 *
 * `2026-09-19T23:59:59.999Z` -> `2026-09-19 23:59:59.999`.
 *
 * PASS THIS, NEVER A `Date`, to any raw `pg` query comparing against a
 * `timestamp` column. A `Date` is serialised in the local zone and silently
 * shifts the comparison.
 */
export function utcTimestampParam(at: Date): string {
  if (Number.isNaN(at.getTime())) {
    throw new Error('utcTimestampParam: not a date')
  }
  // FROM THE ISO FORM, which is UTC by definition — not from the getUTC*
  // accessors assembled by hand, which is four more places to drop a zero.
  return at.toISOString().replace('T', ' ').replace('Z', '')
}
