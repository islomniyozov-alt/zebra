import { hostname } from 'node:os'
import { installSocketCrashGuard } from './socket-crash-guard'

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

// ---------------------------------------------------------------------------
// THE SOCKET GUARD IS ARMED HERE, ON IMPORT, AND THAT PLACEMENT IS THE POINT.
//
// It used to be installed in `setup-integration.ts`, which vitest loads through
// `setupFiles` — IN THE TEST WORKERS ONLY. `globalSetup` runs in the main
// process, opens its own pools to take the run lock and copy the template, and
// had no guard at all. A dropped socket there killed the run before a test
// existed to fail, twice, with the containment sitting one process away.
//
// "THE MECHANISM WORKS" AND "THE MECHANISM IS PRESENT" ARE DIFFERENT CLAIMS.
// The guard had a test that spawned a real process, threw a real socket error
// at it and watched it survive — proof of the first, and no evidence at all for
// the second.
//
// SO IT LIVES IN THE MODULE BOTH ENTRY POINTS ALREADY IMPORT. `integration-lock`
// (globalSetup) and `setup-integration` (workers) both need worker database
// names, so both load this file, so both are armed — including any context
// added later that touches a worker database, which is every context that could
// drop one of these sockets.
// ---------------------------------------------------------------------------
installSocketCrashGuard()

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

/**
 * The `application_name` every connection this suite opens to the TEMPLATE
 * carries, so a session can be recognised as ours rather than assumed to be.
 *
 * IT IS AN IDENTIFIER, NOT A LABEL FOR LOGS. `awaitTemplateIdle` terminates
 * backends, and the only thing standing between that and somebody else's run
 * is being able to tell the two apart. See the note there.
 *
 * The host is in it because two runners on different machines against the same
 * branch is precisely the case that matters, and `pid` alone is meaningless
 * across them.
 */
export const TEMPLATE_APPLICATION_NAME = `zebra-integration-${hostname()}`

/**
 * The same URL, stamped so sessions opened with it can be identified.
 *
 * A QUERY PARAMETER because that is the one channel that reaches a CHILD
 * PROCESS. `prisma migrate deploy` gets a connection string and nothing else;
 * we cannot run `SET application_name` inside a connection we never hold.
 *
 * AND IT IS BEST-EFFORT ON PURPOSE. If the client ignores the parameter the
 * session is simply unidentified, and `awaitTemplateIdle` then WAITS for it
 * instead of terminating it — which is the correct behaviour for a session we
 * cannot prove is ours, and costs only the moment it takes a winding-down
 * backend to close.
 */
export function withApplicationName(url: string, name: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set('application_name', name)
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
 *
 * CONFIRMED 2026-09-04 (`scripts/measure-neon.mjs`): the round trip is 193–203ms
 * at 1, 4 AND 8 concurrent connections — flat, not degrading — and
 * max_connections on the branch is 901 against the single digits this opens.
 * So eight workers is not what makes runs unstable, and lowering the count
 * would trade suite time for nothing. The instability is a compute resume; see
 * the note on LOAD_WRITE_TIMEOUT_MS in src/lib/loads.ts.
 */
export function workerCount(): number {
  const raw = Number(process.env.ZEBRA_TEST_WORKERS ?? '8')
  return Number.isInteger(raw) && raw > 0 ? raw : 8
}
