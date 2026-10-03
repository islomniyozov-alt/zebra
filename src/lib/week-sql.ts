import { Prisma } from '@/generated/prisma/client'
import type { Grain } from './rolling-period'

// ---------------------------------------------------------------------------
// A SETTLEMENT WEEK, IN SQL. One expression, every reporting query.
//
// `date_trunc('week', …)` IS MONDAY IN POSTGRES and a settlement week opens on
// a SUNDAY (MONEY-DESIGN §0) — the same boundary the settlement engine pays in.
// So the day is shifted in and back out, and getting that wrong moves a
// Sunday's freight into the week before or after the statement that paid it.
//
// ── WHY IT IS A FUNCTION OF THE COLUMN ───────────────────────────────────
//
// There were THREE copies of this expression, each hardcoded to a column
// called `d.del_date`: two in by-company.ts and one in dashboard-kpis.ts.
// §6.2.7 needs it over an invoice's issue date, a payment's received date and
// a settlement's period start — which would have made four, five and six, each
// free to disagree about where a week starts.
//
// NOT IN `rolling-period.ts`, deliberately: that module is imported by the
// period picker, which is a client component, and nothing that reaches the
// browser bundle should be dragging Prisma in behind it.
// ---------------------------------------------------------------------------

/**
 * The bucket a timestamp column falls in, for the grain on screen.
 *
 * TWO BRANCHES RATHER THAN ONE WITH A VARIABLE IN IT, because the week case has
 * to shift a day in and back out and the day case must not. Hiding that
 * difference behind an argument is how the Sunday boundary gets lost.
 */
export function bucketExprSql(column: Prisma.Sql, grain: Grain): Prisma.Sql {
  return grain === 'week'
    ? Prisma.sql`(date_trunc('week', ${column} + interval '1 day') - interval '1 day')`
    : Prisma.sql`date_trunc('day', ${column})`
}
