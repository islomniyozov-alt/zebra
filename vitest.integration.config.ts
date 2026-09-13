import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { workerCount } from './tests/worker-db'

// These write to a real Neon branch and clean up after themselves. Separated
// so `npm run check` stays something you can run without thinking about what
// it will do to the database.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    // ORDER MATTERS. The routing file rewrites the connection strings; the
    // shared file then validates whatever it finds. Reversed, the shared file
    // would refuse the un-rewritten database or bless the wrong one.
    setupFiles: ['tests/setup-integration.ts', 'tests/setup.ts'],
    // ONE RUNNER PER DATABASE. `globalSetup` runs exactly once per run, in the
    // main process, before any worker — so a bare `vitest` pays it too, which
    // `setupFiles` (once per FILE, own process) could never enforce.
    globalSetup: ['tests/integration-lock.ts'],
    // PARALLEL, BECAUSE EACH WORKER OWNS A DATABASE. The old note here said
    // running these concurrently "invites the kind of interference that gets
    // blamed on the code under test", and it was right about the shared
    // database it was written for — one worker's unscoped cleanup deleting
    // another's rows is precisely the failure that voided the a8e0c9f gate.
    // Workers no longer share tables, so there is nothing left to interfere
    // with. See tests/worker-db.ts.
    fileParallelism: true,
    // ONE SOURCE OF TRUTH, IMPORTED RATHER THAN RESTATED. This used to read
    // `Number(process.env.ZEBRA_TEST_WORKERS ?? '8')` under a comment claiming
    // it agreed with tests/worker-db.ts — two literals, one claim. They agreed
    // only because nobody had changed one; a worker without its own database
    // silently shares slot 1's, and slot 1's cleanup then deletes its rows.
    maxWorkers: workerCount(),
    // ── ONE RETRY, ON A DROPPED SOCKET AND NOTHING ELSE ─────────────────
    //
    // MEASURED BEFORE IT WAS BUILT (owner's ruling, 2026-09-13). Five runs
    // lost sockets: two were the machine sleeping mid-run, 17 and 19 hours in,
    // killing 47 and 196 tests at once. The other three were a SINGLE socket
    // each — one test, one file, at t+39s, t+76s and t+481s — while the other
    // seven workers carried on.
    //
    // The dev compute reported `pg_postmaster_start_time` spanning both recent
    // drops, so no restart and therefore not autosuspend; one socket dying
    // while seven lived rules out a total network loss; 129 of 901 connections
    // rules out exhaustion. The cause is unidentified, which is why this is
    // ONE retry on ONE error rather than a blanket `retry: 1`.
    //
    // WHY HERE AND NOT DEEPER. `withSocketRetry` already retries a dropped
    // socket around ordinary queries and deliberately REFUSES to touch
    // `$transaction` — replaying an interactive transaction that may already
    // have committed can duplicate a write. Every drop catalogued was inside a
    // transaction. Re-running the whole TEST is the retry that is safe there:
    // the fixtures are built again from the start.
    //
    // THE CONDITION MATCHES `error.message` AND NOTHING ELSE, which is why
    // `retrying-client.ts` renames these errors on the way out: a dropped
    // socket arrives with an EMPTY message and the cause only in `stack`, so
    // the one error worth retrying on was the one this could not match.
    retry: { count: 1, condition: /dropped Neon socket/ },
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
})
