// ---------------------------------------------------------------------------
// ONE DATABASE PER WORKER, AND WHY IT IS A DATABASE RATHER THAN A SCHEMA.
//
// SCHEMA-PER-WORKER IS PERMANENTLY RULED OUT FOR THIS CODEBASE. Finding, by
// name: THE PINNED SECURITY DEFINER SEARCH_PATH. `20260728224900_rls_and_isolation`
// creates eight trigger functions as
//
//     LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
//
// and the pin is a deliberate privilege-escalation control — the comment beside
// it says so. Under schema-per-worker those triggers would resolve their tables
// in `public` rather than in the worker's schema, so the layer that ENFORCES
// tenant isolation would be the layer leaking across workers, silently. The
// migration is applied and applied migrations are closed to edits, and
// unpinning a live security control to speed up a test suite is not a trade
// anybody should take. So: separate databases, each with its own `public`,
// where the pin resolves correctly and is never touched.
//
// THE TEMPLATE PERSISTS BETWEEN RUNS. That is the whole win — a migration chain
// costs 155 seconds (measured, 30 migrations, 55 tables) and cannot be
// parallelised, because `prisma migrate deploy` takes a database-wide advisory
// lock: three concurrent chains produced one success and two failures. Paying
// it once and copying is the difference between a 13-minute suite and a
// 15-minute setup.
//
// WHICH MEANS IT CAN GO STALE, and a stale template is a suite going green
// against last week's schema. `ensureTemplate` compares what the template has
// applied against the migrations folder on every run and says out loud which
// branch it took.
// ---------------------------------------------------------------------------

/** Databases this suite creates. Anything matching is ours to drop. */
export const WORKER_DB_PREFIX = 'zebra_w'

/** Migrated once, copied per worker, kept between runs. */
export const TEMPLATE_DB = 'zebra_template'

/**
 * The database a connection string points at, swapped.
 *
 * THE ROLE IS UNTOUCHED, which is what keeps `db.ts`'s zebra_app guard
 * meaningful: the app's URL still authenticates as zebra_app, still through the
 * pooled endpoint, and only the database name differs from the shared one.
 */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

/** `zebra_w3` for pool slot 3. */
export function workerDatabase(poolId: string | number): string {
  return `${WORKER_DB_PREFIX}${poolId}`
}

/**
 * How many worker databases to build.
 *
 * ONE SOURCE OF TRUTH for the count: the Vitest config reads the same variable
 * for `maxWorkers`, so the number of databases and the number of workers cannot
 * drift apart into workers sharing a database.
 *
 * NOT `os.cpus().length`, which is Vitest's default and the wrong heuristic
 * here. This suite is latency-bound — roughly 200ms per statement to
 * us-east-2 — so its workers spend their lives waiting rather than computing,
 * and the useful count is above the core count rather than equal to it.
 */
export function workerCount(): number {
  const raw = Number(process.env.ZEBRA_TEST_WORKERS ?? '8')
  return Number.isInteger(raw) && raw > 0 ? raw : 8
}
