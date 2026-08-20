// ---------------------------------------------------------------------------
// WHAT `zebra_app` MAY DO, AS A RULE RATHER THAN AS A LIST.
//
// FLAG 81: the schema is version-controlled and the GRANTS ARE NOT. Two
// databases can pass every other check in this repository while disagreeing
// about who may read what, and nothing compared them. On 2026-08-20 a probe
// run with a non-public `search_path` granted `zebra_app` on
// `public._prisma_migrations`; it was caught only because `structure.test.ts`
// happened to assert on that exact table, on the exact privilege the blanket
// grant included. A revoke or grant on any table nobody had thought to name
// would have been permanent and silent.
//
// SO THE EXPECTED STATE IS DERIVED, NOT MAINTAINED. A hand-kept allowlist of
// tables would rot exactly the way the ACLs did — it would be updated when
// somebody remembered, which is the failure mode being fixed. Everything below
// comes from `20260728224900_rls_and_isolation`, which says:
//
//     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
//     ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE
//     REVOKE ALL ON TABLE "_prisma_migrations"
//
// Four verbs on every table, none on the bookkeeping, and the default
// privileges mean a table added next year inherits the same four. So the rule
// is: every table in `public` carries exactly those four, except
// `_prisma_migrations`, which carries none. Anything else — a stray TRUNCATE,
// a GRANT ALL, a REVOKE somebody ran by hand at 2am — is a difference from the
// migration, and this names it.
//
// ONE RULE, TWO CALLERS, and that shape is deliberate. `tests/structure.test.ts`
// runs it against dev inside `npm run check`; `scripts/check-grants.mjs` runs
// it against production, where the connection string is fenced to an allowlist
// the test suite is not on. Two implementations of "what should the grants be"
// is how the two databases would come to disagree about the answer as well as
// about the state.
// ---------------------------------------------------------------------------

/** Exactly what the migration grants on every application table. */
export const APP_TABLE_PRIVILEGES = [
  'DELETE',
  'INSERT',
  'SELECT',
  'UPDATE',
] as const

/** Owner's business. The migration revokes everything here. */
export const BOOKKEEPING_TABLE = '_prisma_migrations'

/**
 * Every privilege Postgres can hold on a table.
 *
 * ASKED ABOUT IN FULL, because the interesting failures are the ones nobody
 * anticipated. The assertion this replaced looked at `SELECT` alone and would
 * have watched a `GRANT TRUNCATE` land without a word.
 */
export const ALL_TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
] as const

/**
 * The SQL that reports, for every table in `public`, exactly which privileges
 * `zebra_app` holds — as a sorted comma-separated string per table.
 *
 * A SINGLE QUERY rather than a loop, so both callers ask the database the same
 * question in the same round trip, and neither can drift into asking a subtly
 * different one.
 */
export const GRANT_AUDIT_SQL = `
  SELECT c.relname AS "table",
         COALESCE(
           (SELECT string_agg(p, ',' ORDER BY p)
              FROM unnest(ARRAY[${ALL_TABLE_PRIVILEGES.map((p) => `'${p}'`).join(',')}]) AS p
             WHERE has_table_privilege('zebra_app', c.oid, p)),
           ''
         ) AS "held"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
   ORDER BY c.relname
`

export interface GrantRow {
  table: string
  held: string
}

export interface GrantDifference {
  table: string
  expected: string
  actual: string
}

/** What the migration says this table should carry. */
export function expectedPrivileges(table: string): string {
  return table === BOOKKEEPING_TABLE ? '' : APP_TABLE_PRIVILEGES.join(',')
}

/**
 * Every table whose grants differ from what the migration established.
 *
 * Empty is the only acceptable answer. A difference is not necessarily an
 * attack or even a mistake — it is a change that happened outside a migration,
 * which is precisely the class of change nothing else in this repository can
 * see.
 */
export function findGrantDifferences(
  rows: readonly GrantRow[],
): GrantDifference[] {
  const differences: GrantDifference[] = []
  for (const row of rows) {
    const expected = expectedPrivileges(row.table)
    if (row.held !== expected) {
      differences.push({ table: row.table, expected, actual: row.held })
    }
  }
  return differences
}

/** One line per difference, for a human reading a failure. */
export function describeGrantDifferences(
  differences: readonly GrantDifference[],
): string {
  return differences
    .map(
      (d) =>
        `  ${d.table}: expected [${d.expected || 'none'}], found [${d.actual || 'none'}]`,
    )
    .join('\n')
}
