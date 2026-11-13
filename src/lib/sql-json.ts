// ---------------------------------------------------------------------------
// ONE PARSER FOR TWO TRANSPORTS (§6.1.1 v10.97).
//
// A card's rows arrive two ways: from its own `$queryRaw`, where Postgres
// `bigint` is a JS `bigint` and a timestamp is a `Date`; and from the
// dashboard's one-row statement, where the same rows come back inside a
// JSON column — `bigint` as a JSON number, a timestamp as a string. The
// parsers take either, through these two, so one parser serves both paths
// and the agreement test compares like with like.
//
// TIMESTAMPS ARE UTC. Every DateTime column in this schema is
// `timestamp(3) without time zone` holding UTC, which is how Prisma reads it;
// JSON renders it with no zone ("2026-11-09T00:00:00"), and a string with
// no zone would be read as LOCAL time by `Date`. So a zone-less string gets
// its `Z` before it is parsed — the column's own meaning, stated once here.
// ---------------------------------------------------------------------------

/** A count or a sum, as `bigint`, number or numeric string. Null is 0. */
export function asNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

/** A timestamp as a `Date` or a JSON string; null stays null. */
export function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  const text = String(value)
  const zoned = /(Z|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`
  const at = new Date(zoned)
  if (Number.isNaN(at.getTime()))
    throw new Error(`asDate: not a timestamp: ${JSON.stringify(text)}`)
  return at
}
